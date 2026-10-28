"""Run:  python -m unittest discover -s tests -v
Builds a synthetic, perspective-warped, noisy, gamma-encoded plate photo with KNOWN ODs
and checks the pipeline recovers them."""
import base64
import json
import sys
import threading
import unittest
import urllib.request
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import analysis as A  # noqa: E402
import server  # noqa: E402

ROWS, COLS, PITCH, LIGHT = 8, 12, 90, 0.75


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * x ** (1 / 2.4) - 0.055)


def make_plate(od, seed=0):
    """od: (8,12) true blue-channel OD. Returns (jpeg data url, corner points in image px)."""
    rng = np.random.default_rng(seed)
    W, H = COLS * PITCH + 60, ROWS * PITCH + 60
    yy, xx = np.mgrid[:H, :W]
    img = np.zeros((H, W, 3), np.float32)
    img[:] = LIGHT * 0.9                                         # plastic/background
    img *= (1 + 0.04 * (xx / W - 0.5))[..., None]               # mild uneven lighting
    for r in range(ROWS):
        for c in range(COLS):
            cx, cy = 30 + PITCH / 2 + c * PITCH, 30 + PITCH / 2 + r * PITCH
            m = (xx - cx) ** 2 + (yy - cy) ** 2 <= (PITCH * 0.36) ** 2
            t = 10.0 ** -od[r, c]
            col = np.array([0.97, 10 ** (-0.15 * od[r, c]), t], np.float32) * LIGHT
            img[m] = col
            hl = (xx - cx - 10) ** 2 + (yy - cy + 12) ** 2 <= 5 ** 2   # specular glint
            img[hl & m] = 1.0
    out = (srgb(img) * 255).astype(np.float32) + rng.normal(0, 1.5, img.shape)
    out = np.clip(out, 0, 255).astype(np.uint8)
    src = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    dst = np.float32([[15, 25], [W - 30, 5], [W - 5, H - 20], [30, H - 5]])      # perspective tilt
    M = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(out, M, (W, H), borderValue=(200, 200, 200))
    ctr = np.float32([[30 + PITCH / 2, 30 + PITCH / 2], [30 + PITCH / 2 + (COLS - 1) * PITCH, 30 + PITCH / 2],
                      [30 + PITCH / 2 + (COLS - 1) * PITCH, 30 + PITCH / 2 + (ROWS - 1) * PITCH],
                      [30 + PITCH / 2, 30 + PITCH / 2 + (ROWS - 1) * PITCH]]).reshape(-1, 1, 2)
    corners = cv2.perspectiveTransform(ctr, M).reshape(4, 2)
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(warped, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92])
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode(), corners.tolist()


def truth(seed=1):
    rng = np.random.default_rng(seed)
    od = rng.uniform(0.25, 1.5, (ROWS, COLS))
    od[0:2, 0] = 1.6          # positive controls A1,B1
    od[2:4, 0] = 0.15         # negative controls C1,D1
    od[4:8, 0] = 0.0          # blanks E1-H1
    return od


CFG = dict(rows=ROWS, cols=COLS, radius=0.28, channel="B", linearize=True, pos="A1-B1", neg="C1-D1",
           blank="E1-H1", mode="PP", cutoff=40)


class Core(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.od = truth()
        cls.url, cls.corners = make_plate(cls.od)

    def run_cfg(self, **kw):
        return A.analyze(self.url, {**CFG, "corners": self.corners, **kw})

    def test_recovers_od(self):
        r = self.run_cfg()
        self.assertTrue(r["valid"], r["errors"])
        err = [abs(w["od"] - self.od[w["row"], w["col"]]) for w in r["wells"]]
        self.assertLess(max(err), 0.06, f"max OD error {max(err):.3f}")
        self.assertLess(float(np.mean(err)), 0.02)

    def test_pp_classification(self):
        r = self.run_cfg()
        pos_od, neg_od = 1.6, 0.15
        for w in r["wells"]:
            if w["role"] != "Sample":
                continue
            pp = 100 * (self.od[w["row"], w["col"]] - neg_od) / (pos_od - neg_od)
            if abs(pp - 40) > 4:       # ignore wells right on the cutoff
                self.assertEqual(w["class"], "Positive" if pp >= 40 else "Negative", w["well"])

    def test_wrong_blank_is_caught(self):          # the bug from the original app: blank = coloured wells
        od = np.full((ROWS, COLS), 1.0); od[0:2, 0] = 1.6; od[2:4, 0] = 0.15; od[4:8, 0] = 0.0
        url, corners = make_plate(od, seed=3)
        r = A.analyze(url, {**CFG, "corners": corners, "blank": "A5-D5"})   # amber wells, not real blanks
        self.assertFalse(r["valid"])
        self.assertTrue(any("Blank" in e for e in r["errors"]))
        self.assertTrue(all(w["class"] in ("Invalid", "Control", "Blank", "No data") for w in r["wells"]))
        self.assertTrue(A.analyze(url, {**CFG, "corners": corners})["valid"])   # correct blank passes

    def test_swapped_controls_flagged(self):
        r = self.run_cfg(pos="C1-D1", neg="A1-B1")
        self.assertFalse(r["valid"])
        self.assertTrue(any("PI mode" in e for e in r["errors"]))

    def test_pi_mode(self):
        od = truth(); od[0:2, 0] = 0.15; od[2:4, 0] = 1.6      # competitive: pos ctrl = low signal
        url, corners = make_plate(od, seed=5)
        r = A.analyze(url, {**CFG, "corners": corners, "mode": "PI", "cutoff": 50})
        self.assertTrue(r["valid"], r["errors"])
        for w in r["wells"]:
            if w["role"] == "Sample":
                pi = 100 * (1 - od[w["row"], w["col"]] / 1.6)
                if abs(pi - 50) > 5:
                    self.assertEqual(w["class"], "Positive" if pi >= 50 else "Negative", w["well"])

    def test_calibration(self):
        r = self.run_cfg()
        od = {w["well"]: w["od"] for w in r["wells"]}
        lines = "\n".join(f"{k},{2.0 * v + 0.05:.4f}" for k, v in od.items())
        f = A.fit_calibration({"rows": ROWS, "cols": COLS, "image_od": od, "reader": lines})
        self.assertAlmostEqual(f["slope"], 2.0, places=2)
        self.assertAlmostEqual(f["intercept"], 0.05, places=2)

    def test_reader_matrix(self):
        txt = "\n".join("\t".join("0.5" for _ in range(COLS)) for _ in range(ROWS))
        self.assertEqual(len(A.parse_reader(txt, ROWS, COLS)), ROWS * COLS)

    def test_input_validation(self):
        for bad in (dict(pos="Z9"), dict(pos="A1", neg="A1"), dict(channel="X"), dict(mode="??"),
                    dict(slope=0), dict(cutoff="abc"), dict(corners=[[0, 0]] * 4), dict(blank="")):
            with self.assertRaises(A.AnalysisError, msg=str(bad)):
                self.run_cfg(**bad)
        with self.assertRaises(A.AnalysisError):
            A.analyze("data:image/jpeg;base64,AAAA", {**CFG, "corners": self.corners})

    def test_speed(self):
        import time
        t = time.time(); self.run_cfg(); self.assertLess(time.time() - t, 3.0)

    def test_spce_preset(self):
        od = np.random.default_rng(10).uniform(0.3, 1.4, (ROWS, COLS))
        od[0:4, 0] = 1.6    # A1-D1 neg (max-signal) control
        od[4:6, 0] = 0.0    # E1-F1 blank
        od[0:6, 1] = 0.4    # A2-F2 positive (low OD in competitive assay)
        od[0:6, 2] = 1.2    # A3-F3 negative (high OD in competitive assay)
        url, corners = make_plate(od, seed=10)
        r = A.analyze(url, {"corners": corners, "assay": "SPCE"})
        self.assertTrue(r["valid"], r["errors"])
        self.assertEqual(r["mode"], "PI")
        self.assertEqual(r["assay"], "SPCE")
        self.assertEqual(r["cutoff"], 65.0)
        ref = r["reference"]
        self.assertIsNotNone(ref)
        self.assertAlmostEqual(ref["max_od"], 1.6, delta=0.08)
        self.assertEqual(ref["cutoff_percent"], 65.0)
        self.assertAlmostEqual(ref["cutoff_od"], 1.6 * (1.0 - 0.65), delta=0.05)
        self.assertGreater(ref["blank_intensity"], 0.5)
        # Check custom role label and classes
        for w in r["wells"]:
            if w["well"] in ("A1", "B1", "C1", "D1"):
                self.assertEqual(w["role"], "Antigen (max-signal) control")
                self.assertEqual(w["class"], "Control")
            elif w["well"] in ("E1", "F1"):
                self.assertEqual(w["role"], "Blank")
                self.assertEqual(w["class"], "Blank")
            elif w["col"] == 1 and w["row"] <= 5:
                self.assertEqual(w["class"], "Positive", w["well"])
            elif w["col"] == 2 and w["row"] <= 5:
                self.assertEqual(w["class"], "Negative", w["well"])
        self.assertTrue(any("SPCE preset has no positive control" in w for w in r["warnings"]))

    def test_diva_preset(self):
        od = np.random.default_rng(20).uniform(0.3, 1.4, (ROWS, COLS))
        od[7, 6:8] = 1.6    # H7-H8 pos
        od[7, 8:10] = 0.15  # H9-H10 neg
        od[7, 10:12] = 0.0  # H11-H12 blank
        od[1, 0:6] = 1.2    # B1-B6 positive (high OD in PP assay)
        od[2, 0:6] = 0.3    # C1-C6 negative (low OD in PP assay)
        url, corners = make_plate(od, seed=20)
        r = A.analyze(url, {"corners": corners, "assay": "DIVA"})
        self.assertTrue(r["valid"], r["errors"])
        self.assertEqual(r["mode"], "PP")
        self.assertEqual(r["assay"], "DIVA")
        self.assertEqual(r["cutoff"], 40.0)
        ref = r["reference"]
        self.assertIsNotNone(ref)
        self.assertAlmostEqual(ref["pos_od"], 1.6, delta=0.08)
        self.assertAlmostEqual(ref["neg_od"], 0.15, delta=0.08)
        self.assertEqual(ref["cutoff_percent"], 40.0)
        self.assertAlmostEqual(ref["cutoff_od"], 0.15 + 0.4 * (1.6 - 0.15), delta=0.05)
        for w in r["wells"]:
            if w["well"] in ("H7", "H8"):
                self.assertEqual(w["role"], "Positive ctrl")
                self.assertEqual(w["class"], "Control")
            elif w["well"] in ("H9", "H10"):
                self.assertEqual(w["role"], "Negative ctrl")
                self.assertEqual(w["class"], "Control")
            elif w["well"] in ("H11", "H12"):
                self.assertEqual(w["role"], "Blank")
                self.assertEqual(w["class"], "Blank")
            elif w["well"].startswith("B") and int(w["well"][1:]) <= 6:
                self.assertEqual(w["class"], "Positive", w["well"])
            elif w["well"].startswith("C") and int(w["well"][1:]) <= 6:
                self.assertEqual(w["class"], "Negative", w["well"])

    def test_preset_override_and_case_insensitive(self):
        od = np.random.default_rng(20).uniform(0.3, 1.4, (ROWS, COLS))
        od[7, 6:8] = 1.6; od[7, 8:10] = 0.15; od[7, 10:12] = 0.0
        url, corners = make_plate(od, seed=20)
        # Custom cutoff overrides preset default, mode is forced from preset, case-insensitive assay
        r = A.analyze(url, {"corners": corners, "assay": "diva", "cutoff": 35.0, "mode": "PI"})
        self.assertTrue(r["valid"], r["errors"])
        self.assertEqual(r["mode"], "PP")  # forced from preset despite user mode="PI"
        self.assertEqual(r["cutoff"], 35.0)
        self.assertEqual(r["reference"]["cutoff_percent"], 35.0)

        # Non-empty user field overrides preset wells
        r2 = A.analyze(url, {"corners": corners, "assay": "DIVA", "pos": "B1-B2"})
        b_wells = [w for w in r2["wells"] if w["well"] in ("B1", "B2")]
        self.assertTrue(all(w["role"] == "Positive ctrl" for w in b_wells))
        h_wells = [w for w in r2["wells"] if w["well"] in ("H7", "H8")]
        self.assertTrue(all(w["role"] == "Sample" for w in h_wells))

    def test_unknown_assay_and_dimensions(self):
        with self.assertRaises(A.AnalysisError):
            A.analyze(self.url, {**CFG, "corners": self.corners, "assay": "NONEXISTENT"})
        with self.assertRaises(A.AnalysisError):
            A.analyze(self.url, {**CFG, "corners": self.corners, "assay": "SPCE", "rows": 6, "cols": 12})
        with self.assertRaises(A.AnalysisError):
            A.analyze(self.url, {**CFG, "corners": self.corners, "assay": "DIVA", "rows": 8, "cols": 10})

    def test_spce_no_positive_wells_logic(self):
        od = np.random.default_rng(10).uniform(0.3, 1.4, (ROWS, COLS))
        od[0:4, 0] = 1.6; od[4:6, 0] = 0.0
        url, corners = make_plate(od, seed=10)
        # Without positive wells: valid, has warning
        r = A.analyze(url, {"corners": corners, "assay": "spce", "pos": ""})
        self.assertTrue(r["valid"])
        self.assertIsNone(r["summary"]["pos_od"])
        self.assertTrue(any("SPCE preset has no positive control" in w for w in r["warnings"]))

        # With user-provided positive wells: no warning
        od[6:8, 0] = 0.2  # positive controls (low OD in competitive assay)
        url2, corners2 = make_plate(od, seed=11)
        r2 = A.analyze(url2, {"corners": corners2, "assay": "spce", "pos": "G1-H1"})
        self.assertTrue(r2["valid"])
        self.assertIsNotNone(r2["summary"]["pos_od"])
        self.assertFalse(any("SPCE preset has no positive control" in w for w in r2["warnings"]))


    def test_crossed_corners_rejected(self):
        # Bowtie / crossed corners
        crossed = [self.corners[0], self.corners[2], self.corners[1], self.corners[3]]
        with self.assertRaises(A.AnalysisError):
            A.grid_geometry(A.parse_corners(crossed), 8, 12, 0.28)

    def test_image_cache_eviction_and_expiry(self):
        cache = A.ImageCache(max_size=8)
        img = np.zeros((10, 10, 3), dtype=np.uint8)
        ids = [cache.put(img.copy()) for _ in range(8)]
        self.assertEqual(len(cache), 8)
        for img_id in ids:
            self.assertTrue(cache.contains(img_id))
            self.assertIsNotNone(cache.get(img_id))

        # 9th image should evict the 1st
        id9 = cache.put(img.copy())
        self.assertEqual(len(cache), 8)
        self.assertFalse(cache.contains(ids[0]))
        with self.assertRaises(A.ImageExpiredError):
            cache.get(ids[0])
        self.assertTrue(cache.contains(id9))



    def test_dynamic_range_qc_warnings(self):
        # 1. Well-exposed plate triggers no warning
        r = self.run_cfg(channel="B")
        self.assertFalse(any("below 20" in w or "> 250" in w for w in r["warnings"]))

        # 2. Plate with saturated blanks (> 250)
        W, H = COLS * PITCH + 60, ROWS * PITCH + 60
        sat_img = np.full((H, W, 3), 255, dtype=np.uint8)
        import cv2, base64
        ok, buf = cv2.imencode(".jpg", sat_img)
        sat_url = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()
        r_sat = A.analyze(sat_url, {**CFG, "corners": self.corners, "channel": "B"})
        self.assertTrue(any("Blank well raw 8-bit value is" in w and "> 250" in w for w in r_sat["warnings"]))

        # 3. Synthetic plate with very dark wells must trigger warning in channel B
        dark_od = np.full((ROWS, COLS), 2.2)
        dark_od[4:8, 0] = 0.0  # blanks
        dark_od[2:4, 0] = 0.15 # negs
        dark_url, dark_corners = make_plate(dark_od, seed=77)
        r_dark_b = A.analyze(dark_url, {**CFG, "corners": dark_corners, "channel": "B"})
        self.assertTrue(any("below 20" in w and "Use the G channel, or reshoot with a brighter light" in w for w in r_dark_b["warnings"]))

    def test_auto_channel_selection(self):
        # 1. Dark plate: AUTO must pick G
        dark_od = np.full((ROWS, COLS), 2.2)
        dark_od[4:8, 0] = 0.0
        dark_od[2:4, 0] = 0.15
        dark_url, dark_corners = make_plate(dark_od, seed=77)
        r_dark_auto = A.analyze(dark_url, {**CFG, "corners": dark_corners, "channel": "AUTO"})
        self.assertEqual(r_dark_auto["channel_used"], "G")
        self.assertIn("reason", r_dark_auto)
        self.assertIn("G", r_dark_auto["reason"])

        # 2. Well-exposed plate: AUTO must trigger no warning and give valid result
        r_norm_auto = A.analyze(self.url, {**CFG, "corners": self.corners, "channel": "AUTO"})
        self.assertTrue(r_norm_auto["valid"])
        self.assertEqual(r_norm_auto["channel_used"], "B")
        self.assertFalse(any("below 20" in w for w in r_norm_auto["warnings"]))

    def test_flat_field_correction_gradient(self):
        # Add 15% brightness gradient to synthetic plate and check recovered ODs improve
        W, H = COLS * PITCH + 60, ROWS * PITCH + 60
        yy, xx = np.mgrid[:H, :W]
        img = np.zeros((H, W, 3), np.float32)
        img[:] = LIGHT * 0.9
        grad_field = 1.0 + 0.15 * (xx / W - 0.5)
        img *= grad_field[..., None]
        for r in range(ROWS):
            for c in range(COLS):
                cx, cy = 30 + PITCH / 2 + c * PITCH, 30 + PITCH / 2 + r * PITCH
                m = (xx - cx) ** 2 + (yy - cy) ** 2 <= (PITCH * 0.36) ** 2
                t = 10.0 ** -self.od[r, c]
                col = np.array([0.97, 10 ** (-0.15 * self.od[r, c]), t], np.float32) * LIGHT * grad_field[int(cy), int(cx)]
                img[m] = col
                hl = (xx - cx - 10) ** 2 + (yy - cy + 12) ** 2 <= 5 ** 2
                img[hl & m] = 1.0
        out = (srgb(img) * 255).astype(np.float32) + np.random.default_rng(7).normal(0, 1.0, img.shape)
        out = np.clip(out, 0, 255).astype(np.uint8)
        ctr = np.float32([[30 + PITCH / 2, 30 + PITCH / 2], [30 + PITCH / 2 + (COLS - 1) * PITCH, 30 + PITCH / 2],
                          [30 + PITCH / 2 + (COLS - 1) * PITCH, 30 + PITCH / 2 + (ROWS - 1) * PITCH],
                          [30 + PITCH / 2, 30 + PITCH / 2 + (ROWS - 1) * PITCH]]).reshape(4, 2)
        import cv2, base64
        ok, buf = cv2.imencode(".jpg", cv2.cvtColor(out, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 95])
        grad_url = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()

        r_no_ff = A.analyze(grad_url, {**CFG, "corners": ctr.tolist(), "flat_field": False})
        r_ff = A.analyze(grad_url, {**CFG, "corners": ctr.tolist(), "flat_field": True})
        self.assertFalse(r_no_ff["flat_field_applied"])
        self.assertTrue(r_ff["flat_field_applied"])
        self.assertGreater(r_ff["illumination_range_percent"], 5.0)
        err_no_ff = float(np.mean([abs(w["od"] - self.od[w["row"], w["col"]]) for w in r_no_ff["wells"]]))
        err_ff = float(np.mean([abs(w["od"] - self.od[w["row"], w["col"]]) for w in r_ff["wells"]]))
        self.assertLess(err_ff, err_no_ff, f"Flat-field error {err_ff} should be lower than uncorrected {err_no_ff}")
        improvement = (err_no_ff - err_ff) / err_no_ff
        self.assertGreater(improvement, 0.20, f"Expected at least 20% improvement, got {improvement*100:.1f}%")

        # Fallback path test: plastic samples are unusable (blacked out)
        fallback_img = out.copy()
        for r in range(ROWS - 1):
            for c in range(COLS - 1):
                cx = int(30 + PITCH / 2 + (c + 0.5) * PITCH)
                cy = int(30 + PITCH / 2 + (r + 0.5) * PITCH)
                fallback_img[cy - 6 : cy + 7, cx - 6 : cx + 7] = 0
        ok, buf_fb = cv2.imencode(".jpg", cv2.cvtColor(fallback_img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 95])
        fb_url = "data:image/jpeg;base64," + base64.b64encode(buf_fb.tobytes()).decode()
        r_fb = A.analyze(fb_url, {**CFG, "corners": ctr.tolist(), "flat_field": True})
        self.assertFalse(r_fb["flat_field_applied"])
        self.assertEqual(r_fb["illumination_range_percent"], 0.0)
        self.assertTrue(any("Flat-field correction skipped" in w for w in r_fb["warnings"]))

    def test_calibration_quadratic_fit_and_warning(self):
        # 1. Non-linear calibration data
        img_ods = {f"A{i+1}": 0.1 * (i + 1) for i in range(10)}
        reader_text = "\n".join(f"A{i+1}, {0.2 * (0.1 * (i + 1))**2 + 0.8 * (0.1 * (i + 1)) + 0.05:.4f}" for i in range(10))
        cal = A.fit_calibration({"rows": 8, "cols": 12, "image_od": img_ods, "reader": reader_text})
        self.assertIsNotNone(cal["quadratic"])
        self.assertGreaterEqual(cal["quadratic"]["r2"], 0.99)
        self.assertLess(cal["quadratic"]["rmse"], cal["rmse"])
        self.assertIn("points", cal)
        self.assertEqual(len(cal["points"]), 10)

        # 2. Warning when R2 < 0.95
        noisy_reader = "\n".join(f"A{i+1}, {float(np.random.default_rng(i).uniform(0.1, 1.5)):.3f}" for i in range(8))
        noisy_cal = A.fit_calibration({"rows": 8, "cols": 12, "image_od": img_ods, "reader": noisy_reader})
        self.assertIsNotNone(noisy_cal["warning"])
        self.assertIn("below 0.95", noisy_cal["warning"])

        # 3. Analyze with quadratic calibration
        r_quad = A.analyze(self.url, {
            **CFG, "corners": self.corners, "cal_mode": "quadratic",
            "cal_a": 0.1, "cal_b": 1.0, "cal_c": 0.02
        })
        self.assertEqual(r_quad["cal_mode"], "quadratic")
        for w in r_quad["wells"]:
            if w["od"] is not None:
                expected = round(0.1 * (w["od"] ** 2) + 1.0 * w["od"] + 0.02, 4)
                self.assertAlmostEqual(w["od_cal"], expected, places=3)

    def test_auto_detect_grid(self):
        # Synthetic plate should be auto-detected with high confidence
        res = A.detect_grid(self.url, {"rows": 8, "cols": 12})
        self.assertTrue(res["success"], res.get("message"))
        self.assertGreaterEqual(res["confidence"], 0.5)
        self.assertIsNotNone(res["corners"])
        self.assertEqual(len(res["corners"]), 4)

        # Blank/noise image should report low confidence without crashing
        blank_img = np.full((600, 800, 3), 200, dtype=np.uint8)
        import cv2, base64
        ok, buf = cv2.imencode(".jpg", blank_img)
        blank_url = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()
        res_blank = A.detect_grid(blank_url, {"rows": 8, "cols": 12})
        self.assertFalse(res_blank["success"])
        self.assertIn("Low grid detection confidence", res_blank["message"])


class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = server.make_server("127.0.0.1", 0)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url, cls.corners = make_plate(truth())

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def post(self, path, body):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", json.dumps(body).encode(),
                                     {"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_endpoints(self):
        s, j = self.post("/api/prepare", {"image": self.url}); self.assertEqual(s, 200); self.assertIn("preview", j)
        s, j = self.post("/api/grid", {"corners": self.corners, "rows": 8, "cols": 12, "radius": 0.28})
        self.assertEqual((s, len(j["wells"])), (200, 96))
        s, j = self.post("/api/analyze", {"image": self.url, "config": {**CFG, "corners": self.corners}})
        self.assertEqual(s, 200); self.assertTrue(j["valid"]); self.assertTrue(j["annotated"].startswith("data:image/jpeg"))
        s, j = self.post("/api/analyze", {"image": self.url, "config": {**CFG, "corners": self.corners, "pos": "Q1"}})
        self.assertEqual(s, 400); self.assertIn("error", j)
        s, j = self.post("/api/presets", {})
        self.assertEqual(s, 200)
        self.assertIn("SPCE", j)
        self.assertIn("DIVA", j)
        self.assertEqual(j["SPCE"]["mode"], "PI")
        self.assertEqual(j["DIVA"]["mode"], "PP")
        s, j = self.post("/api/nope", {}); self.assertEqual(s, 404)

    def test_static_and_traversal(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/") as r:
            self.assertEqual(r.status, 200); self.assertIn(b"ELISA Plate OD Analyzer", r.read())
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{self.port}/../analysis.py")
            self.fail("traversal allowed")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 404)



    def test_upload_and_image_id_flow(self):
        # 1. Upload returns {id, width, height, preview}
        s, j = self.post("/api/upload", {"image": self.url})
        self.assertEqual(s, 200)
        self.assertIn("id", j)
        self.assertIn("width", j)
        self.assertIn("height", j)
        self.assertIn("preview", j)
        image_id = j["id"]

        # 2. Analyze with image_id
        s, j = self.post("/api/analyze", {"image_id": image_id, "config": {**CFG, "corners": self.corners}})
        self.assertEqual(s, 200)
        self.assertTrue(j["valid"])

        # 3. Nonexistent / expired image_id returns 410 "image expired, please re-upload"
        s, j = self.post("/api/analyze", {"image_id": "nonexistent_expired_id", "config": {**CFG, "corners": self.corners}})
        self.assertEqual(s, 410)
        self.assertEqual(j.get("error"), "image expired, please re-upload")

        # 4. Grid and Calibrate accept image_id and return 410 on expired
        s, j = self.post("/api/grid", {"image_id": image_id, "corners": self.corners, "rows": 8, "cols": 12, "radius": 0.28})
        self.assertEqual(s, 200)
        s, j = self.post("/api/grid", {"image_id": "bad_id", "corners": self.corners, "rows": 8, "cols": 12, "radius": 0.28})
        self.assertEqual(s, 410)

    def test_detect_grid_endpoint(self):
        s, j = self.post("/api/detect_grid", {"image": self.url, "config": {"rows": 8, "cols": 12}})
        self.assertEqual(s, 200)
        self.assertTrue(j["success"])
        self.assertIn("corners", j)

    def test_concurrent_analyze_requests(self):
        from concurrent.futures import ThreadPoolExecutor
        s, j = self.post("/api/upload", {"image": self.url})
        self.assertEqual(s, 200)
        image_id = j["id"]

        def do_analyze(_):
            return self.post("/api/analyze", {"image_id": image_id, "config": {**CFG, "corners": self.corners}})

        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(do_analyze, range(5)))

        self.assertEqual(len(results), 5)
        for s, res in results:
            self.assertEqual(s, 200)
            self.assertTrue(res["valid"])
            self.assertEqual(len(res["wells"]), 96)


if __name__ == "__main__":
    unittest.main()
