# Payload Snapshot Guide

This document explains how to capture, verify, and compare the exact JSON payload sent to `/api/analyze` for SPCE and DIVA runs using standard browser developer tools or automated testing.

---

## 1. Capturing Payloads via Browser DevTools (Chrome / Edge / Firefox)

1. Open the application at `http://127.0.0.1:8000/`.
2. Open Developer Tools (`F12` or `Ctrl+Shift+I` / `Cmd+Option+I`).
3. Switch to the **Network** tab.
4. Filter by **Fetch/XHR** or type `/api/analyze` into the filter box.
5. Check **Preserve log** to keep requests across reloads and runs.
6. **Capture SPCE**:
   - Click **"Try a sample plate"** (or upload your plate photo and select **SPCE**).
   - In the Network list, click the `analyze` POST request.
   - Go to the **Payload** (or **Request**) tab.
   - Click **"View source"** or right-click the JSON object and select **"Copy object"** / **"Copy value"**.
   - Save the JSON to `frontend_checks/payload_before_spce.json`.
7. **Capture DIVA**:
   - On the same plate, switch the assay preset to **DIVA**.
   - Click **"Run analysis"** (`#run`).
   - In the Network list, select the new `analyze` POST request.
   - Under the **Payload** tab, copy the request JSON.
   - Save the JSON to `frontend_checks/payload_before_diva.json`.

---

## 2. Automated Capture Reference

Automated snapshot capture uses Playwright to route and intercept `**/api/analyze`, extracting `request.post_data_json`:

```python
async def handle_request(route, request):
    if "/api/analyze" in request.url and request.method == "POST":
        payload = request.post_data_json
        # save payload to json
    await route.continue_()

page.route("**/api/analyze", handle_request)
```

---

## 3. Baseline Captured Payloads

Pre-redesign baseline snapshots captured on the 96-well synthetic demo plate:
- **SPCE Baseline**: `frontend_checks/payload_before_spce.json`
  - `assay`: `"SPCE"`
  - `mode`: `"PI"`
  - `cutoff`: `65`
  - `pos`: `""`
  - `neg`: `"A1-D1"`
  - `blank`: `"E1-F1"`
- **DIVA Baseline**: `frontend_checks/payload_before_diva.json`
  - `assay`: `"DIVA"`
  - `mode`: `"PP"`
  - `cutoff`: `40`
  - `pos`: `"H7-H8"`
  - `neg`: `"H9-H10"`
  - `blank`: `"H11-H12"`

---

## 4. Post-Redesign Comparison Verification

To verify that the 3D redesign introduced zero payload regressions:
1. Capture the new SPCE and DIVA payloads under the redesigned UI (`payload_after_spce.json` and `payload_after_diva.json`).
2. Run a deep JSON key/value diff against the baseline payloads:
   - Ensure `config` structure and keys match identically.
   - Ensure well coordinates, control wells, modes, and numerical parameters are preserved.
