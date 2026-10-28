"""ELISA plate photo -> blank-referenced OD -> PP / PI.  Pure functions, no web code."""
from __future__ import annotations

import base64
import math
import re
import threading
import uuid
from collections import OrderedDict

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


class ImageExpiredError(AnalysisError):
    """The cached image has expired or was evicted from memory; reported as HTTP 410."""


class ImageCache:
    """Thread-safe in-memory LRU cache holding decoded RGB images."""

    def __init__(self, max_size: int = 8):
        self.max_size = max_size
        self._cache: OrderedDict[str, np.ndarray] = OrderedDict()
        self._lock = threading.Lock()

    def put(self, rgb: np.ndarray) -> str:
        with self._lock:
            img_id = uuid.uuid4().hex
            self._cache[img_id] = rgb
            if len(self._cache) > self.max_size:
                self._cache.popitem(last=False)
            return img_id

    def get(self, img_id: str) -> np.ndarray:
        with self._lock:
            if not isinstance(img_id, str) or img_id not in self._cache:
                raise ImageExpiredError("image expired, please re-upload")
            self._cache.move_to_end(img_id)
            return self._cache[img_id]

    def contains(self, img_id: str) -> bool:
        with self._lock:
            return isinstance(img_id, str) and img_id in self._cache

    def clear(self):
        with self._lock:
            self._cache.clear()

    def __len__(self):
        with self._lock:
            return len(self._cache)


IMAGE_CACHE = ImageCache(max_size=8)


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


def upload(image_data) -> dict:
    rgb = decode_image(data_url_to_bytes(image_data))
    img_id = IMAGE_CACHE.put(rgb)
    return {
        "id": img_id,
        "width": rgb.shape[1],
        "height": rgb.shape[0],
        "preview": _jpeg_url(rgb, 92),
    }


def prepare(image_data_url) -> dict:
    return upload(image_data_url)


# ------------------------------------------------------------------- grid
def is_convex_quad(pts: np.ndarray) -> bool:
    """True if 4 points form a non-degenerate, strictly convex, non-self-intersecting quad."""
    if len(pts) != 4:
        return False
    cross_products = []
    for i in range(4):
        p0 = pts[i]
        p1 = pts[(i + 1) % 4]
        p2 = pts[(i + 2) % 4]
        dx1, dy1 = p1[0] - p0[0], p1[1] - p0[1]
        dx2, dy2 = p2[0] - p1[0], p2[1] - p1[1]
        cp = dx1 * dy2 - dy1 * dx2
        cross_products.append(cp)
    all_pos = all(cp > 1e-4 for cp in cross_products)
    all_neg = all(cp < -1e-4 for cp in cross_products)
    return all_pos or all_neg


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
    if area < 100 or not is_convex_quad(corners):
        raise AnalysisError("The four grid corners are crossed or collapsed. Spread them over the plate.")
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
    if body.get("image_id"):
        IMAGE_CACHE.get(body.get("image_id"))
    rows = _int(body, "rows", 8, 2, 16)
    cols = _int(body, "cols", 12, 2, 24)
    radius = _num(body, "radius", 0.28, 0.05, 0.5)
    ctr, rad = grid_geometry(parse_corners(body.get("corners")), rows, cols, radius)
    return {"wells": [[ctr[r, c, 0], ctr[r, c, 1], rad[r, c]] for r in range(rows) for c in range(cols)]}


def detect_grid(image_or_id, cfg: dict | None = None) -> dict:
    """Detect wells with HoughCircles, fit a perspective regular grid using RANSAC,
    and return suggested corner positions or a low-confidence notice.
    """
    if cfg is None:
        cfg = {}
    if image_or_id is None:
        image_or_id = cfg.get("image_id") or cfg.get("image")
    if not image_or_id and not isinstance(image_or_id, np.ndarray):
        raise AnalysisError("No image supplied.")
    if isinstance(image_or_id, np.ndarray):
        rgb = image_or_id
    elif isinstance(image_or_id, str):
        if image_or_id.startswith("data:") or len(image_or_id) > 256:
            rgb = decode_image(data_url_to_bytes(image_or_id))
        else:
            rgb = IMAGE_CACHE.get(image_or_id)
    else:
        raise AnalysisError("Invalid image parameter.")

    rows = _int(cfg, "rows", 8, 2, 16)
    cols = _int(cfg, "cols", 12, 2, 24)
    total_wells = rows * cols

    H, W = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    pitch_est = min(W / (cols + 0.8), H / (rows + 0.8))
    min_r = int(max(6, pitch_est * 0.16))
    max_r = int(min(H, W, pitch_est * 0.48))
    min_dist = int(max(10, pitch_est * 0.65))

    blurred = cv2.GaussianBlur(gray, (5, 5), 1.5)
    circles = cv2.HoughCircles(
        blurred, cv2.HOUGH_GRADIENT, dp=1.2, minDist=min_dist,
        param1=50, param2=26, minRadius=min_r, maxRadius=max_r
    )
    if circles is None or len(circles[0]) < 10:
        circles = cv2.HoughCircles(
            blurred, cv2.HOUGH_GRADIENT, dp=1.2, minDist=min_dist,
            param1=38, param2=20, minRadius=min_r, maxRadius=max_r
        )

    if circles is None or len(circles[0]) < 10:
        return {
            "success": False,
            "confidence": 0.0,
            "message": "Low grid detection confidence: too few circular wells identified. Please place corners manually.",
            "corners": None,
        }

    detected = circles[0]
    med_r = float(np.median(detected[:, 2]))
    keep = (detected[:, 2] >= med_r * 0.60) & (detected[:, 2] <= med_r * 1.40)
    pts = detected[keep][:, :2].astype(np.float32)

    if len(pts) < 10:
        return {
            "success": False,
            "confidence": 0.0,
            "message": "Low grid detection confidence: insufficient uniform wells detected. Please place corners manually.",
            "corners": None,
        }

    # Bounding box of well center points
    hull = cv2.convexHull(pts)
    rect = cv2.minAreaRect(hull)
    box = cv2.boxPoints(rect).astype(np.float32)

    # Sort 4 box vertices: top-left, top-right, bottom-right, bottom-left
    box_sorted = box[np.argsort(box[:, 1])]
    top = box_sorted[:2][np.argsort(box_sorted[:2, 0])]
    bottom = box_sorted[2:][np.argsort(box_sorted[2:, 0])]
    c_tl, c_tr = top[0], top[1]
    c_bl, c_br = bottom[0], bottom[1]
    candidate_corners = np.array([c_tl, c_tr, c_br, c_bl], dtype=np.float32)

    lattice = np.array([[float(c), float(r)] for r in range(rows) for c in range(cols)], dtype=np.float32)
    src_grid = np.float32([[0, 0], [cols - 1, 0], [cols - 1, rows - 1], [0, rows - 1]])

    best_inliers = 0
    best_corners = candidate_corners.copy()
    inlier_thresh = pitch_est * 0.35

    rng = np.random.default_rng(42)
    for it in range(40):
        if it == 0:
            c_test = candidate_corners
        else:
            jitter = rng.uniform(-0.15, 0.15, (4, 2)).astype(np.float32) * pitch_est
            c_test = candidate_corners + jitter

        try:
            M = cv2.getPerspectiveTransform(src_grid, c_test)
            pred = cv2.perspectiveTransform(lattice.reshape(-1, 1, 2), M).reshape(-1, 2)
        except Exception:
            continue

        dists = np.linalg.norm(pred[:, None, :] - pts[None, :, :], axis=2)
        min_d = np.min(dists, axis=1)
        inliers = int(np.sum(min_d < inlier_thresh))

        if inliers > best_inliers:
            best_inliers = inliers
            best_corners = c_test

    confidence = float(best_inliers) / float(total_wells)
    if confidence < 0.35 or best_corners is None:
        return {
            "success": False,
            "confidence": round(confidence, 3),
            "message": f"Low grid detection confidence ({round(confidence * 100)}%). Please position corners manually.",
            "corners": None,
        }

    return {
        "success": True,
        "confidence": round(confidence, 3),
        "inliers": best_inliers,
        "total": total_wells,
        "corners": [[_f(pt[0], 1), _f(pt[1], 1)] for pt in best_corners],
        "message": f"Grid auto-detected with {round(confidence * 100)}% confidence ({best_inliers}/{total_wells} wells matched). You can drag corner handles to adjust.",
    }


# ------------------------------------------------------------- extraction
def extract(rgb, ctr, rad, channel, linearize, return_raw: bool = False):
    """Robust per-well intensity (0..1 linear light if linearize). Returns (I, flags) or (I, flags, raw_I)."""
    rows, cols = ctr.shape[:2]
    H, W = rgb.shape[:2]
    idx = CHANNELS[channel] if channel in CHANNELS else CHANNELS["B"]
    I = np.full((rows, cols), np.nan)
    raw_I = np.full((rows, cols), np.nan)
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
            raw_vals = sel @ LUMA if idx is None else sel[:, idx]
            raw_I[r, c] = float(np.median(raw_vals))
    if return_raw:
        return I, flags, raw_I
    return I, flags


def fit_illumination_surface(
    rgb: np.ndarray,
    ctr: np.ndarray,
    rad: np.ndarray,
    channel: str = "B",
    linearize: bool = True,
) -> tuple[np.ndarray | None, bool, float, str | None]:
    """Sample small patches of clear plastic at the midpoint of every four neighbouring wells,
    fit a smooth 2D degree-2 polynomial surface in linear light, and evaluate at well centres.
    Returns (F_normalized_at_wells, applied, illumination_range_percent, warning_msg).
    """
    rows, cols = ctr.shape[:2]
    H, W = rgb.shape[:2]
    idx = CHANNELS.get(channel, 2)

    # 1. Sample midpoints of every four neighbouring wells
    midpoints = []
    for r in range(rows - 1):
        for c in range(cols - 1):
            p = 0.25 * (ctr[r, c] + ctr[r + 1, c] + ctr[r, c + 1] + ctr[r + 1, c + 1])
            midpoints.append(p)

    all_ctr = ctr.reshape(-1, 2)
    all_rad = rad.reshape(-1)

    xs, ys, intensities = [], [], []
    for pt in midpoints:
        x, y = float(pt[0]), float(pt[1])
        if not (6 <= x < W - 6 and 6 <= y < H - 6):
            continue
        dists = np.hypot(all_ctr[:, 0] - x, all_ctr[:, 1] - y)
        min_idx = int(np.argmin(dists))
        if dists[min_idx] < all_rad[min_idx] * 1.15:
            continue  # inside or too close to a well edge

        ix, iy = int(round(x)), int(round(y))
        # Small patch of clear plastic (5x5 px)
        patch = rgb[max(0, iy - 2):min(H, iy + 3), max(0, ix - 2):min(W, ix + 3)]
        if patch.size == 0:
            continue
        # Convert to linear light
        lin = LUT[patch] if linearize else patch.astype(np.float32) / 255.0
        vals = lin @ LUMA if idx is None else lin[:, :, idx]
        v = float(np.median(vals))
        # Valid sample check: must not be pitch black or blown specular highlight
        if 0.04 <= v <= 0.99:
            xs.append(x)
            ys.append(y)
            intensities.append(v)

    if len(xs) < 20:
        return (
            None,
            False,
            0.0,
            f"Flat-field correction skipped: only {len(xs)} valid plastic samples found (< 20 required).",
        )

    xs = np.array(xs, dtype=np.float64)
    ys = np.array(ys, dtype=np.float64)
    vals = np.array(intensities, dtype=np.float64)

    # Filter outlier plastic scratches / markings
    q25, q75 = np.percentile(vals, [25, 75])
    iqr = max(q75 - q25, 0.01)
    keep = (vals >= q25 - 2.0 * iqr) & (vals <= q75 + 2.0 * iqr)
    if keep.sum() < 20:
        return (
            None,
            False,
            0.0,
            f"Flat-field correction skipped: fewer than 20 non-outlier plastic samples found ({keep.sum()}).",
        )

    xs, ys, vals = xs[keep], ys[keep], vals[keep]

    cx_mid, cy_mid = 0.5 * W, 0.5 * H
    s_scale = max(W, H)
    xn = (xs - cx_mid) / s_scale
    yn = (ys - cy_mid) / s_scale

    A_mat = np.column_stack([
        np.ones_like(xn),
        xn, yn,
        xn ** 2, xn * yn, yn ** 2,
    ])

    try:
        coeff, _, _, _ = np.linalg.lstsq(A_mat, vals, rcond=None)
    except Exception:
        return (
            None,
            False,
            0.0,
            "Flat-field correction skipped: illumination surface fit is unstable (lstsq failure).",
        )

    # Evaluate fitted surface at well centres
    wx = (ctr[:, :, 0] - cx_mid) / s_scale
    wy = (ctr[:, :, 1] - cy_mid) / s_scale

    surface = (
        coeff[0] +
        coeff[1] * wx + coeff[2] * wy +
        coeff[3] * (wx ** 2) + coeff[4] * (wx * wy) + coeff[5] * (wy ** 2)
    )

    # Stability checks on the fitted surface
    if not np.isfinite(surface).all() or np.min(surface) <= 0.02 or np.max(surface) / np.min(surface) > 3.0:
        return (
            None,
            False,
            0.0,
            "Flat-field correction skipped: illumination surface fit is unstable (divergent values).",
        )

    # Illumination range percent across well centres
    range_pct = round(float((np.max(surface) - np.min(surface)) / np.min(surface) * 100.0), 1)

    mean_s = float(np.mean(surface))
    F = surface / mean_s
    return F, True, range_pct, None


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


def analyze(image_or_id, cfg) -> dict:
    if not isinstance(cfg, dict):
        raise AnalysisError("Missing configuration.")
    if image_or_id is None:
        image_or_id = cfg.get("image_id") or cfg.get("image")
    if not image_or_id and not isinstance(image_or_id, np.ndarray):
        raise AnalysisError("No image supplied.")
    if isinstance(image_or_id, np.ndarray):
        rgb = image_or_id
    elif isinstance(image_or_id, str):
        if image_or_id.startswith("data:") or len(image_or_id) > 256:
            rgb = decode_image(data_url_to_bytes(image_or_id))
        else:
            rgb = IMAGE_CACHE.get(image_or_id)
    else:
        raise AnalysisError("Invalid image parameter.")
    rows = _int(cfg, "rows", 8, 2, 16)
    cols = _int(cfg, "cols", 12, 2, 24)
    radius = _num(cfg, "radius", 0.28, 0.05, 0.5)
    raw_channel = str(cfg.get("channel") or "B").strip().upper()
    if raw_channel not in CHANNELS and raw_channel != "AUTO":
        raise AnalysisError("Channel must be R, G, B, GRAY or AUTO.")
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

    auto_channel_info = None
    if raw_channel == "AUTO":
        best_ch = "B"
        best_score = -1e9
        channel_stats = {}
        for cand in ["B", "G", "GRAY"]:
            _, _, cand_raw = extract(rgb, ctr, rad, cand, linearize=False, return_raw=True)
            bl_vals = [cand_raw[r, c] for r, c in blank if np.isfinite(cand_raw[r, c])]
            bl_raw = float(np.mean(bl_vals)) if bl_vals else 200.0

            finite_raw = cand_raw[np.isfinite(cand_raw)]
            if len(finite_raw) > 0:
                k = max(1, int(math.ceil(len(finite_raw) * 0.10)))
                darkest_10 = float(np.mean(np.sort(finite_raw)[:k]))
            else:
                darkest_10 = 0.0

            usable_range = bl_raw - darkest_10
            under_20 = int(np.sum(cand_raw < 20))
            under_share = under_20 / (rows * cols)
            under_pct = 100.0 * under_share
            sat_blank = bl_raw > 250.0

            # Score each by usable range between blank and darkest 10% of wells; penalise > 25% below 20
            score = usable_range
            if under_share > 0.25:
                score -= 1000.0 * (under_share + 1.0)
            if sat_blank:
                score -= 500.0

            channel_stats[cand] = {
                "blank_raw": round(bl_raw, 1),
                "darkest_10": round(darkest_10, 1),
                "usable_range": round(usable_range, 1),
                "under_pct": round(under_pct, 1),
                "sat_blank": sat_blank,
                "score": round(score, 1),
            }
            if score > best_score:
                best_score = score
                best_ch = cand

        b_stat = channel_stats["B"]
        if best_ch == "B":
            best_reason = f"Channel B selected: widest usable range ({b_stat['usable_range']}) without excessive underexposure."
        elif b_stat["under_pct"] > 25.0:
            best_reason = f"Channel B had {b_stat['under_pct']:.1f}% wells below 20. Channel {best_ch} selected with usable range {channel_stats[best_ch]['usable_range']}."
        elif b_stat["sat_blank"]:
            best_reason = f"Channel B blank was saturated (> 250). Channel {best_ch} selected with usable range {channel_stats[best_ch]['usable_range']}."
        else:
            best_reason = f"Channel {best_ch} selected with usable range {channel_stats[best_ch]['usable_range']}."

        channel = best_ch
        auto_channel_info = {
            "channel_used": best_ch,
            "chosen": best_ch,
            "reason": best_reason,
            "stats": channel_stats,
        }
    else:
        channel = raw_channel

    I, flags, raw_I = extract(rgb, ctr, rad, channel, linearize, return_raw=True)

    errors, warnings = [], []

    flat_field_opt = bool(cfg.get("flat_field", True))
    flat_field_applied = False
    illum_range_pct = 0.0
    if flat_field_opt:
        F, applied, range_pct, ff_warn = fit_illumination_surface(
            rgb, ctr, rad, channel, linearize
        )
        if applied and F is not None:
            I = I / F
            flat_field_applied = True
            illum_range_pct = range_pct
        elif ff_warn:
            warnings.append(ff_warn)

    pos_role = preset.get("pos_role", "Positive ctrl") if preset else "Positive ctrl"
    neg_role = preset.get("neg_role", "Negative ctrl") if preset else "Negative ctrl"
    blank_role = preset.get("blank_role", "Blank") if preset else "Blank"

    role = np.full((rows, cols), "Sample", dtype=object)
    for lst, name in ((pos, pos_role), (neg, neg_role), (blank, blank_role)):
        for r, c in lst:
            role[r, c] = name
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

    under_count = int(np.sum(raw_I < 20))
    under_share = under_count / (rows * cols)
    under_pct = 100.0 * under_share
    if under_share > 0.25:
        warnings.append(
            f"{under_count} of {rows * cols} wells ({under_pct:.1f}%) have a raw 8-bit value below 20. "
            "Use the G channel, or reshoot with a brighter light."
        )
    blank_raw = float(np.nanmean([raw_I[r, c] for r, c in blank]))
    if blank_raw > 250.0:
        warnings.append(
            f"Blank well raw 8-bit value is {blank_raw:.1f}/255 (> 250, saturated). "
            "Reduce exposure or illumination to avoid clipping."
        )
    if auto_channel_info:
        warnings.append(f"Auto channel: {auto_channel_info['reason']}")

    cal_mode = str(cfg.get("cal_mode") or "linear").lower()
    if cal_mode == "quadratic" and cfg.get("cal_a") is not None:
        qa = _num(cfg, "cal_a", 0.0, -1e6, 1e6)
        qb = _num(cfg, "cal_b", 1.0, -1e6, 1e6)
        qc = _num(cfg, "cal_c", 0.0, -1e6, 1e6)
        od_cal = qa * (od ** 2) + qb * od + qc
    else:
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
        "channel": channel,
        "channel_used": channel,
        "reason": (auto_channel_info["reason"] if auto_channel_info else f"Manual channel selection: {channel}"),
        "channel_info": {
            "channel_used": channel,
            "reason": (auto_channel_info["reason"] if auto_channel_info else f"Manual channel selection: {channel}")
        },
        "auto_channel": auto_channel_info,
        "flat_field": {
            "applied": flat_field_applied,
            "range_percent": illum_range_pct,
        },
        "flat_field_applied": flat_field_applied,
        "illumination_range_percent": illum_range_pct,
        "cal_mode": cal_mode,
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
    if body.get("image_id"):
        IMAGE_CACHE.get(body.get("image_id"))
    rows = _int(body, "rows", 8, 2, 16)
    cols = _int(body, "cols", 12, 2, 24)
    reader = parse_reader(body.get("reader"), rows, cols)
    img = body.get("image_od")
    if not isinstance(img, dict):
        raise AnalysisError("Run the analysis first so image ODs exist.")
    xs, ys, well_names = [], [], []
    for w, y in reader.items():
        x = img.get(w)
        if isinstance(x, (int, float)) and math.isfinite(x) and math.isfinite(y):
            xs.append(float(x))
            ys.append(float(y))
            well_names.append(w)
    if len(xs) < 3:
        raise AnalysisError("Need at least 3 wells with both an image OD and a reader OD.")
    xs, ys = np.array(xs, dtype=np.float64), np.array(ys, dtype=np.float64)
    if np.ptp(xs) < 1e-6:
        raise AnalysisError("All image ODs are identical - fix the analysis (blank/controls) before calibrating.")

    # 1. Linear fit: y = slope * x + icpt
    slope, icpt = np.polyfit(xs, ys, 1)
    pred_lin = slope * xs + icpt
    ss_res_lin = float(np.sum((ys - pred_lin) ** 2))
    ss_tot = float(np.sum((ys - ys.mean()) ** 2))
    r2_lin = 1.0 - ss_res_lin / ss_tot if ss_tot > 0 else None
    rmse_lin = math.sqrt(ss_res_lin / len(xs))

    # 2. Quadratic fit: y = a * x^2 + b * x + c
    quad_data = None
    r2_quad = None
    rmse_quad = None
    if len(xs) >= 4:
        p_quad = np.polyfit(xs, ys, 2)
        pred_quad = np.polyval(p_quad, xs)
        ss_res_quad = float(np.sum((ys - pred_quad) ** 2))
        r2_quad = 1.0 - ss_res_quad / ss_tot if ss_tot > 0 else None
        rmse_quad = math.sqrt(ss_res_quad / len(xs))
        quad_data = {
            "a": _f(p_quad[0], 5),
            "b": _f(p_quad[1], 5),
            "c": _f(p_quad[2], 5),
            "r2": _f(r2_quad, 4),
            "rmse": _f(rmse_quad, 4),
        }

    best_r2 = max(r2_lin if r2_lin is not None else 0.0, r2_quad if r2_quad is not None else 0.0)
    warning = None
    if best_r2 < 0.95:
        warning = f"Calibration R² ({best_r2:.3f}) is below 0.95 - correlation between image and reader is weak."

    points = [
        {"well": well_names[i], "image_od": _f(xs[i]), "reader_od": _f(ys[i])}
        for i in range(len(xs))
    ]
    points.sort(key=lambda p: p["image_od"] if p["image_od"] is not None else 0.0)

    return clean({
        "slope": slope, "intercept": icpt, "r2": r2_lin, "n": len(xs),
        "rmse": rmse_lin,
        "quadratic": quad_data,
        "points": points,
        "warning": warning,
    })
