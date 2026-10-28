"""ELISA plate photo -> blank-referenced OD -> PP / PI.  Pure functions, no web code."""
from __future__ import annotations

import base64
import math
import re

import cv2
import numpy as np

MAX_SIDE = 2400          # larger photos are shrunk (INTER_AREA) before analysis
LETTERS = "ABCDEFGHIJKLMNOP"
CHANNELS = {"R": 0, "G": 1, "B": 2, "GRAY": None}
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
MIN_SEP = 0.05           # minimum usable control OD separation / level
cv2.setNumThreads(2)

ASSAYS = {
    "SPCE": {
        "name": "SPCE",
        "description": "Solid Phase Competition ELISA (PI mode)",
        "mode": "PI",
        "cutoff": 65.0,
        "pos": "",
        "neg": "A1-D1",
        "blank": "E1-F1",
        "neg_role": "Antigen (max-signal) control",
        "neg_label": "Antigen (max-signal) control",
        "pos_role": "Positive ctrl",
        "blank_role": "Blank",
    },
    "DIVA": {
        "name": "DIVA",
        "description": "Differentiating Infected from Vaccinated Animals (PP mode)",
        "mode": "PP",
        "cutoff": 40.0,
        "pos": "H7-H8",
        "neg": "H9-H10",
        "blank": "H11-H12",
        "pos_role": "Positive ctrl",
        "neg_role": "Negative ctrl",
        "blank_role": "Blank",
    },
}


class AnalysisError(ValueError):
    """A problem the user can fix (bad input); reported as HTTP 400."""


# ----------------------------------------------------------------- helpers
def _srgb_lut() -> np.ndarray:
    x = np.arange(256, dtype=np.float32) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)


LUT = _srgb_lut()


def _num(cfg, key, default, lo, hi):
    v = cfg.get(key)
    if v is None or v == "":
        return default
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise AnalysisError(f"'{key}' must be a number.")
    if not math.isfinite(f) or f < lo or f > hi:
        raise AnalysisError(f"'{key}' must be between {lo} and {hi}.")
    return f


def _int(cfg, key, default, lo, hi):
    return int(round(_num(cfg, key, default, lo, hi)))


def _f(x, nd=4):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, nd) if math.isfinite(x) else None


def clean(o):
    """Make any structure JSON-safe (numpy -> python, NaN/inf -> None)."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return _f(o, 6)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


def well_name(r: int, c: int) -> str:
    return f"{LETTERS[r]}{c + 1}"


def parse_wells(text, rows, cols):
    """'A1, A2, B1-B3, E1-H1' -> [(r, c), ...]. Ranges are rectangles."""
    out, seen = [], set()
    for tok in re.split(r"[,\s;]+", str(text or "").strip().upper()):
        if not tok:
            continue
        m = re.fullmatch(r"([A-Z])(\d{1,2})(?:-([A-Z])?(\d{1,2}))?", tok)
        if not m:
            raise AnalysisError(f"Cannot read well '{tok}'. Use e.g. A1, A2, B1-B3.")
        r1, c1 = ord(m.group(1)) - 65, int(m.group(2)) - 1
        if m.group(4):
            r2 = ord(m.group(3)) - 65 if m.group(3) else r1
            c2 = int(m.group(4)) - 1
        else:
            r2, c2 = r1, c1
        for r in (r1, r2):
            if not 0 <= r < rows:
                raise AnalysisError(f"Well '{tok}' is outside the {rows}x{cols} plate.")
        for c in (c1, c2):
            if not 0 <= c < cols:
                raise AnalysisError(f"Well '{tok}' is outside the {rows}x{cols} plate.")
        for r in range(min(r1, r2), max(r1, r2) + 1):
            for c in range(min(c1, c2), max(c1, c2) + 1):
                if (r, c) not in seen:
                    seen.add((r, c))
                    out.append((r, c))
    return out


# ------------------------------------------------------------------ image
def data_url_to_bytes(s) -> bytes:
    if not isinstance(s, str) or not s:
        raise AnalysisError("No image supplied.")
    if s.startswith("data:"):
        if "," not in s:
            raise AnalysisError("Malformed image data.")
        s = s.split(",", 1)[1]
    try:
        return base64.b64decode(s)
    except Exception:
        raise AnalysisError("Image data is not valid base64.")


def decode_image(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)  # honours EXIF rotation
    if img is None:
        raise AnalysisError("Could not read the image (use JPG, PNG, BMP, TIFF or WebP).")
    h, w = img.shape[:2]
    s = MAX_SIDE / max(h, w)
    if s < 1:
        img = cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def _jpeg_url(rgb: np.ndarray, quality=90, max_w=None) -> str:
    if max_w and rgb.shape[1] > max_w:
        s = max_w / rgb.shape[1]
        rgb = cv2.resize(rgb, (max_w, max(1, round(rgb.shape[0] * s))), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise AnalysisError("Could not encode preview image.")
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


def prepare(image_data_url) -> dict:
    rgb = decode_image(data_url_to_bytes(image_data_url))
    return {"width": rgb.shape[1], "height": rgb.shape[0], "preview": _jpeg_url(rgb, 92)}


# ------------------------------------------------------------------- grid
def parse_corners(c):
    try:
        pts = np.array(c, dtype=np.float64).reshape(4, 2)
    except Exception:
        raise AnalysisError("Four corner points (A1, top-right, bottom-right, bottom-left) are required.")
    if not np.isfinite(pts).all():
        raise AnalysisError("Corner points must be finite numbers.")
    return pts


def grid_geometry(corners, rows, cols, radius):
    """Perspective-correct well centres (rows, cols, 2) and per-well ROI radii (rows, cols)."""
    x, y = corners[:, 0], corners[:, 1]
    area = 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
    if area < 100:
        raise AnalysisError("The four grid corners are collapsed or in a line. Spread them over the plate.")
    src = np.float32([[0, 0], [1, 0], [1, 1], [0, 1]])
    M = cv2.getPerspectiveTransform(src, corners.astype(np.float32))
    uu, vv = np.meshgrid(np.linspace(0, 1, cols), np.linspace(0, 1, rows))
    pts = np.stack([uu, vv], -1).reshape(-1, 1, 2).astype(np.float32)
    ctr = cv2.perspectiveTransform(pts, M).reshape(rows, cols, 2).astype(np.float64)
    dx = np.zeros((rows, cols))
    dy = np.zeros((rows, cols))
    for c in range(cols):
        c0, c1 = max(c - 1, 0), min(c + 1, cols - 1)
        dx[:, c] = np.linalg.norm(ctr[:, c1] - ctr[:, c0], axis=-1) / (c1 - c0)
    for r in range(rows):
        r0, r1 = max(r - 1, 0), min(r + 1, rows - 1)
        dy[r, :] = np.linalg.norm(ctr[r1] - ctr[r0], axis=-1) / (r1 - r0)
    rad = radius * np.minimum(dx, dy)
    if not np.isfinite(rad).all() or rad.min() < 2:
        raise AnalysisError("Wells would be smaller than 2 px - the grid corners look wrong.")
    return ctr, rad


def grid_api(body: dict) -> dict:
    rows = _int(body, "rows", 8, 2, 16)
    cols = _int(body, "cols", 12, 2, 24)
    radius = _num(body, "radius", 0.28, 0.05, 0.5)
    ctr, rad = grid_geometry(parse_corners(body.get("corners")), rows, cols, radius)
    return {"wells": [[ctr[r, c, 0], ctr[r, c, 1], rad[r, c]] for r in range(rows) for c in range(cols)]}


# ------------------------------------------------------------- extraction
def extract(rgb, ctr, rad, channel, linearize):
    """Robust per-well intensity (0..1 linear light if linearize). Returns (I, flags)."""
    rows, cols = ctr.shape[:2]
    H, W = rgb.shape[:2]
    idx = CHANNELS[channel]
    I = np.full((rows, cols), np.nan)
    flags = {}
    for r in range(rows):
        for c in range(cols):
            cx, cy = ctr[r, c]
            rr = float(rad[r, c])
            x0, x1 = int(max(0, math.floor(cx - rr - 1))), int(min(W, math.ceil(cx + rr + 2)))
            y0, y1 = int(max(0, math.floor(cy - rr - 1))), int(min(H, math.ceil(cy + rr + 2)))
            if x1 - x0 < 3 or y1 - y0 < 3:
                flags[(r, c)] = "outside image"
                continue
            mask = np.zeros((y1 - y0, x1 - x0), np.uint8)
            cv2.circle(mask, (int(round(cx - x0)), int(round(cy - y0))), max(1, int(round(rr))), 1, -1)
            px = rgb[y0:y1, x0:x1][mask.astype(bool)]
            if len(px) < 30:
                flags[(r, c)] = "too few pixels"
                continue
            if len(px) < 0.8 * math.pi * rr * rr:
                flags[(r, c)] = "partly outside image"
            sat = px.max(axis=1) >= 252                  # specular highlights / blown pixels
            if sat.mean() > 0.5:
                flags[(r, c)] = "overexposed"
                keep = np.ones(len(px), bool)
            else:
                keep = ~sat
            g = px.astype(np.float32) @ LUMA
            if keep.sum() < 20:
                flags[(r, c)] = "too few pixels"
                continue
            lo, hi = np.percentile(g[keep], [10, 90])    # drop dark rim / bright glints
            keep &= (g >= lo) & (g <= hi)
            if keep.sum() < 10:
                flags[(r, c)] = "too few pixels"
                continue
            sel = px[keep]
            lin = LUT[sel] if linearize else sel.astype(np.float32) / 255.0
            vals = lin @ LUMA if idx is None else lin[:, idx]
            v_lo, v_hi = np.percentile(vals, [12, 88])
            v_sel = vals[(vals >= v_lo) & (vals <= v_hi)]
            I[r, c] = float(np.median(v_sel) if len(v_sel) >= 5 else np.median(vals))
    return I, flags


def annotate(rgb, ctr, rad, names, colors):
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    mr = float(np.median(rad))
    fs, th = max(0.3, mr / 40.0), max(1, int(round(mr / 18.0)))
    rows, cols = ctr.shape[:2]
    for r in range(rows):
        for c in range(cols):
            p = (int(round(ctr[r, c, 0])), int(round(ctr[r, c, 1])))
            cv2.circle(bgr, p, int(round(rad[r, c])), colors[r][c], th, cv2.LINE_AA)
            (tw, thh), _ = cv2.getTextSize(names[r][c], cv2.FONT_HERSHEY_SIMPLEX, fs, 1)
            org = (p[0] - tw // 2, p[1] + thh // 2)
            cv2.putText(bgr, names[r][c], org, cv2.FONT_HERSHEY_SIMPLEX, fs, (0, 0, 0), th + 2, cv2.LINE_AA)
            cv2.putText(bgr, names[r][c], org, cv2.FONT_HERSHEY_SIMPLEX, fs, (255, 255, 255), 1, cv2.LINE_AA)
    return _jpeg_url(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), 88, max_w=1600)


# --------------------------------------------------------------- analysis
CLASS_COLORS = {  # BGR
    "Positive": (40, 40, 235), "Negative": (60, 190, 60), "Doubtful": (0, 165, 255),
    "Control": (230, 130, 20), "Blank": (190, 190, 190), "Invalid": (255, 0, 255), "No data": (255, 0, 255),
}


def analyze(image_data_url, cfg) -> dict:
    if not isinstance(cfg, dict):
        raise AnalysisError("Missing configuration.")
    rgb = decode_image(data_url_to_bytes(image_data_url))
    rows = _int(cfg, "rows", 8, 2, 16)
    cols = _int(cfg, "cols", 12, 2, 24)
    radius = _num(cfg, "radius", 0.28, 0.05, 0.5)
    channel = str(cfg.get("channel") or "B").upper()
    if channel not in CHANNELS:
        raise AnalysisError("Channel must be R, G, B or GRAY.")
    linearize = bool(cfg.get("linearize", True))
    dark_level = _num(cfg, "dark_level", 0, 0, 100)

    assay_name = cfg.get("assay")
    assay_key = None
    preset = None
    if assay_name is not None and str(assay_name).strip() != "":
        raw_assay = str(assay_name).strip()
        assay_key = raw_assay.upper()
        if assay_key not in ASSAYS:
            raise AnalysisError(f"Unknown assay preset '{raw_assay}'.")
        preset = ASSAYS[assay_key]
        if rows < 8 or cols < 12:
            raise AnalysisError(f"{assay_key} preset requires at least 8 rows and 12 columns.")

    if preset is not None:
        mode = preset["mode"]
    else:
        mode = str(cfg.get("mode") or "PP").upper()
        if mode not in ("PP", "PI"):
            raise AnalysisError("Mode must be PP or PI.")

    default_cutoff = preset["cutoff"] if preset is not None else (40.0 if mode == "PP" else 65.0)
    cutoff = _num(cfg, "cutoff", default_cutoff, -1000, 1000)
    cut_low = _num(cfg, "cutoff_low", None, -1000, 1000)
    if cut_low is not None and cut_low >= cutoff:
        raise AnalysisError("The doubtful lower cutoff must be below the main cutoff.")
    slope = _num(cfg, "slope", 1.0, -1e6, 1e6)
    icpt = _num(cfg, "intercept", 0.0, -1e6, 1e6)
    if slope == 0:
        raise AnalysisError("Calibration slope cannot be 0.")

    def _get_wells_spec(key):
        val = cfg.get(key)
        if val is not None and str(val).strip() != "":
            return str(val).strip()
        if preset is not None:
            return preset.get(key, "")
        return ""

    pos = parse_wells(_get_wells_spec("pos"), rows, cols)
    neg = parse_wells(_get_wells_spec("neg"), rows, cols)
    blank = parse_wells(_get_wells_spec("blank"), rows, cols)

    if not blank:
        raise AnalysisError("Blank wells are required.")
    if not neg:
        raise AnalysisError("Negative control wells are required.")
    if not pos and assay_key != "SPCE":
        raise AnalysisError("Positive control wells are required.")

    both = (set(pos) & set(neg)) | (set(pos) & set(blank)) | (set(neg) & set(blank))
    if both:
        raise AnalysisError("A well cannot have two roles: " + ", ".join(well_name(*w) for w in sorted(both)))

    ctr, rad = grid_geometry(parse_corners(cfg.get("corners")), rows, cols, radius)
    I, flags = extract(rgb, ctr, rad, channel, linearize)

    pos_role = preset.get("pos_role", "Positive ctrl") if preset else "Positive ctrl"
    neg_role = preset.get("neg_role", "Negative ctrl") if preset else "Negative ctrl"
    blank_role = preset.get("blank_role", "Blank") if preset else "Blank"

    role = np.full((rows, cols), "Sample", dtype=object)
    for lst, name in ((pos, pos_role), (neg, neg_role), (blank, blank_role)):
        for r, c in lst:
            role[r, c] = name

    errors, warnings = [], []
    if assay_key == "SPCE" and not pos:
        warnings.append("SPCE preset has no positive control, so plate validity cannot be checked against inhibition.")

    reader_data = cfg.get("reader_ods")
    if not reader_data and cfg.get("use_reader") and cfg.get("reader"):
        try:
            reader_data = parse_reader(cfg.get("reader"), rows, cols)
        except Exception:
            reader_data = None

    dark = float(LUT[int(round(dark_level))]) if linearize else dark_level / 255.0

    bl = np.array([I[r, c] for r, c in blank])
    bl = bl[np.isfinite(bl)]
    if bl.size == 0:
        raise AnalysisError("No usable pixels in the blank wells - check grid placement and blank wells.")
    Ib = float(bl.mean())
    num = Ib - dark
    if num <= 1e-6:
        raise AnalysisError("Blank intensity is not above the dark level.")
    others = np.array([I[r, c] for r in range(rows) for c in range(cols) if role[r, c] != "Blank"])
    others = others[np.isfinite(others)]
    if not reader_data and others.size and np.median(others) >= Ib * 0.97:
        errors.append("Blank wells are not brighter than the sample wells, so every OD would be about 0. "
                      "Pick wells that contain only substrate/stop solution (or are empty) as the blank.")
    if bl.size > 1 and bl.std(ddof=1) / bl.mean() > 0.15:
        warnings.append("Blank wells differ by more than 15% - uneven lighting or a wrong blank well.")

    den = I - dark
    with np.errstate(all="ignore"):
        od = np.maximum(0.0, np.log10(num / np.maximum(den, 1e-4)))
    floor_hits = int(np.sum(np.isfinite(I) & (den <= 1e-4)))
    if floor_hits:
        warnings.append(f"{floor_hits} well(s) are darker than the camera can resolve; their OD is capped. "
                        "Use the G channel or reduce exposure.")
    od_cal = slope * od + icpt

    if reader_data and isinstance(reader_data, dict):
        for r in range(rows):
            for c in range(cols):
                wn = well_name(r, c)
                if wn in reader_data and reader_data[wn] is not None:
                    try:
                        val_num = float(reader_data[wn])
                        if math.isfinite(val_num):
                            od_cal[r, c] = val_num
                    except (ValueError, TypeError):
                        pass

    def vals(lst):
        v = np.array([od_cal[r, c] for r, c in lst])
        return v[np.isfinite(v)]

    pv, nv, bv = vals(pos), vals(neg), vals(blank)
    value = np.full((rows, cols), np.nan)
    pos_od = float(pv.mean()) if pv.size > 0 else None
    neg_od = float(nv.mean()) if nv.size > 0 else None
    blank_od = float(bv.mean()) if bv.size > 0 else 0.0
    blank_correction = bool(cfg.get("blank_correction", True))

    if nv.size == 0 or (pos and pv.size == 0):
        errors.append("Positive or negative control wells have no usable pixels.")
    else:
        if mode == "PP":
            d = pos_od - neg_od
            if d < MIN_SEP:
                hint = " (controls look swapped, or this is a competitive assay - use PI mode)" if d < 0 else ""
                errors.append(f"Positive control OD {pos_od:.3f} is not clearly above negative control OD "
                              f"{neg_od:.3f}; PP cannot be computed{hint}.")
            else:
                value = 100.0 * (od_cal - neg_od) / d
        else:
            use_blank_sub = blank_correction and abs(blank_od) > 1e-4
            net_neg = (neg_od - blank_od) if use_blank_sub else neg_od
            if net_neg < MIN_SEP:
                errors.append(f"Negative (maximum-signal) control OD {neg_od:.3f} is too low for PI.")
            else:
                if use_blank_sub:
                    value = 100.0 * (1.0 - (od_cal - blank_od) / net_neg)
                else:
                    value = 100.0 * (1.0 - od_cal / neg_od)
                if pos and pv.size > 0:
                    pv_val = float(np.nanmean([value[r, c] for r, c in pos]))
                    if pv_val < cutoff:
                        errors.append(f"Positive control inhibition {pv_val:.1f}% is below the cutoff {cutoff:g}% - "
                                      "the plate fails QC.")
    for label, v in (("positive", pv), ("negative", nv)):
        if v.size > 1 and abs(v.mean()) > 1e-6 and v.std(ddof=1) / abs(v.mean()) > 0.2:
            warnings.append(f"The {label} control replicates vary by more than 20% (CV).")
    for rc, fl in flags.items():
        if fl in ("outside image", "too few pixels", "overexposed"):
            warnings.append(f"Well {well_name(*rc)}: {fl}.")
            if len(warnings) > 12:
                warnings.append("...more well warnings omitted.")
                break

    valid = not errors
    cls = np.full((rows, cols), "", dtype=object)
    for r in range(rows):
        for c in range(cols):
            if role[r, c] == blank_role:
                cls[r, c] = "Blank"
            elif role[r, c] != "Sample":
                cls[r, c] = "Control"
            elif not np.isfinite(I[r, c]):
                cls[r, c] = "No data"
            elif not valid or not np.isfinite(value[r, c]):
                cls[r, c] = "Invalid"
            elif value[r, c] >= cutoff:
                cls[r, c] = "Positive"
            elif cut_low is not None and value[r, c] >= cut_low:
                cls[r, c] = "Doubtful"
            else:
                cls[r, c] = "Negative"

    formula_str = (
        "PI = 100 × (1 - (OD - OD_blank) / (OD_neg - OD_blank))"
        if (mode == "PI" and abs(blank_od) > 1e-4 and blank_correction)
        else ("PI = 100 × (1 - OD / OD_neg)" if mode == "PI" else "PP = 100 × (OD - OD_neg) / (OD_pos - OD_neg)")
    )
    if assay_key == "SPCE":
        cutoff_od = (neg_od * (1.0 - cutoff / 100.0)) if neg_od is not None else None
        reference = {
            "name": "SPCE",
            "formula": formula_str,
            "max_od": neg_od,
            "pos_od": pos_od,
            "neg_od": neg_od,
            "blank_od": blank_od,
            "blank_intensity": Ib,
            "cutoff_percent": cutoff,
            "cutoff_od": cutoff_od,
            "used_reader_ods": bool(reader_data),
        }
    elif assay_key == "DIVA":
        cutoff_od = (neg_od + (cutoff / 100.0) * (pos_od - neg_od)) if (pos_od is not None and neg_od is not None) else None
        reference = {
            "name": "DIVA",
            "formula": formula_str,
            "pos_od": pos_od,
            "neg_od": neg_od,
            "blank_od": blank_od,
            "blank_intensity": Ib,
            "cutoff_percent": cutoff,
            "cutoff_od": cutoff_od,
            "used_reader_ods": bool(reader_data),
        }
    else:
        cutoff_od = (neg_od + (cutoff / 100.0) * (pos_od - neg_od)) if (mode == "PP" and pos_od is not None and neg_od is not None) else ((neg_od * (1.0 - cutoff / 100.0)) if neg_od is not None else None)
        reference = {
            "name": mode,
            "formula": formula_str,
            "pos_od": pos_od,
            "neg_od": neg_od,
            "blank_od": blank_od,
            "blank_intensity": Ib,
            "cutoff_percent": cutoff,
            "cutoff_od": cutoff_od,
            "used_reader_ods": bool(reader_data),
        }

    names = [[well_name(r, c) for c in range(cols)] for r in range(rows)]
    colors = [[CLASS_COLORS[cls[r][c]] for c in range(cols)] for r in range(rows)]
    wells = [{
        "well": names[r][c], "row": r, "col": c, "role": role[r, c],
        "intensity": _f(I[r, c], 5), "od": _f(od[r, c]), "od_cal": _f(od_cal[r, c]),
        "value": _f(value[r, c], 2) if valid else None, "class": cls[r, c], "flag": flags.get((r, c), ""),
    } for r in range(rows) for c in range(cols)]
    count = lambda k: int(sum(1 for w in wells if w["class"] == k))  # noqa: E731
    return clean({
        "valid": valid, "errors": errors, "warnings": warnings, "mode": mode, "cutoff": cutoff,
        "assay": assay_key,
        "reference": reference,
        "image": {"width": rgb.shape[1], "height": rgb.shape[0]},
        "summary": {
            "blank_intensity": Ib, "pos_od": pos_od, "neg_od": neg_od, "blank_od": blank_od,
            "delta_od": None if (pos_od is None or neg_od is None) else pos_od - neg_od,
            "positive": count("Positive"), "negative": count("Negative"),
            "doubtful": count("Doubtful"), "invalid": count("Invalid") + count("No data"),
        },
        "wells": wells,
        "annotated": annotate(rgb, ctr, rad, names, colors),
    })


# ------------------------------------------------------------ calibration
def _isnum(s):
    try:
        float(s)
        return True
    except ValueError:
        return False


def parse_reader(text, rows, cols) -> dict:
    lines = [ln.strip() for ln in str(text or "").strip().splitlines() if ln.strip()]
    if not lines:
        raise AnalysisError("Paste the plate-reader ODs first.")
    toks = [[t for t in re.split(r"[,\t; ]+", ln) if t] for ln in lines]
    out = {}
    if len(lines) == rows and all(len(t) == cols and all(_isnum(x) for x in t) for t in toks):
        for r in range(rows):
            for c in range(cols):
                out[well_name(r, c)] = float(toks[r][c])          # 8x12 matrix pasted from Excel
        return out
    for ln, t in zip(lines, toks):
        if len(t) != 2 or not _isnum(t[1]):
            raise AnalysisError(f"Cannot read line '{ln}'. Use 'A1,0.123' per line or a {rows}x{cols} grid of numbers.")
        wl = parse_wells(t[0], rows, cols)
        if len(wl) != 1:
            raise AnalysisError(f"Line '{ln}' must name exactly one well.")
        r, c = wl[0]
        out[well_name(r, c)] = float(t[1])
    return out


def fit_calibration(body: dict) -> dict:
    rows = _int(body, "rows", 8, 2, 16)
    cols = _int(body, "cols", 12, 2, 24)
    reader = parse_reader(body.get("reader"), rows, cols)
    img = body.get("image_od")
    if not isinstance(img, dict):
        raise AnalysisError("Run the analysis first so image ODs exist.")
    xs, ys = [], []
    for w, y in reader.items():
        x = img.get(w)
        if isinstance(x, (int, float)) and math.isfinite(x) and math.isfinite(y):
            xs.append(float(x))
            ys.append(float(y))
    if len(xs) < 3:
        raise AnalysisError("Need at least 3 wells with both an image OD and a reader OD.")
    xs, ys = np.array(xs), np.array(ys)
    if np.ptp(xs) < 1e-6:
        raise AnalysisError("All image ODs are identical - fix the analysis (blank/controls) before calibrating.")
    slope, icpt = np.polyfit(xs, ys, 1)
    pred = slope * xs + icpt
    ss_res, ss_tot = float(np.sum((ys - pred) ** 2)), float(np.sum((ys - ys.mean()) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else None
    return clean({"slope": slope, "intercept": icpt, "r2": r2, "n": len(xs),
                  "rmse": math.sqrt(ss_res / len(xs))})
