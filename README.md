# ELISA Plate OD Analyzer

Fast, offline, and laboratory-grade image analysis tool for 96-well (and custom) ELISA plates. Converts standard smartphone or camera plate photos into linearized, blank-referenced Optical Density (OD), Percentage Positivity (PP) or Percentage Inhibition (PI), and diagnostic classifications.

---

## 1. Setup & Installation

### Requirements
- **Python 3.10+**
- Standard-library Python + **NumPy** + **OpenCV** (`opencv-python`).
- No external CDNs, fonts, or third-party web frameworks required.

### Quick Start
```bash
# 1. Clone repository & create virtual environment
git clone https://github.com/bishffx/Plate-Analysis.git
cd Plate-Analysis
python -m venv .venv

# 2. Activate virtual environment
# Windows (PowerShell / cmd):
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Verify test suite (all 30 tests should pass)
python -m unittest discover -s tests -v

# 5. Start the local server
python server.py --host 127.0.0.1 --port 8000
```
Open your web browser at **`http://127.0.0.1:8000`**.

---

## 2. Usage Guide

### Single Plate Analysis
1. **Upload Photo**:
   - Supports JPG, PNG, and WebP (export HEIC/HEIF to JPG/PNG before uploading).
   - In-browser client downscales images to a maximum of 2400 px long-edge before upload.
   - Single-upload LRU memory cache avoids re-uploading large payloads for subsequent operations.
2. **Grid Alignment**:
   - **Auto-detect grid**: Click **"Auto-detect grid"** to locate wells via circular Hough transforms and regular perspective RANSAC.
   - **Manual adjustment**: Drag the 4 corner handles (A1, A12, H12, H1) onto the corner well centers. Magnifier loupe and arrow-key nudging provide sub-pixel accuracy.
3. **Assay Configuration**:
   - Choose a preset: **DIVA** (Indirect PP, cutoff 0.3) or **SPCE** (Competitive PI, cutoff 50%).
   - Or configure **Custom**: specify rows, columns, positive/negative control wells, blank wells, and cutoff thresholds.
4. **Measurement Options**:
   - **Channel**: Select `Auto (recommended)` to automatically choose between Blue (B, 492 nm standard), Green (G), or Grayscale based on dynamic range.
   - **Flat-Field Correction**: Recommended checkbox enabled by default. Estimates and compensates for uneven field illumination across the microplate.
   - **Calibration**: Option to enter reader OD values and fit either a **Linear** ($OD = m \cdot x + c$) or **Quadratic** ($OD = a \cdot x^2 + b \cdot x + c$) curve.
5. **Run & Inspect**:
   - View results across 4 synchronized tabs: **OD Matrix**, **Annotations**, **Heatmap**, and **Results Table**.
   - Download results as CSV or generate a clean, print-optimized laboratory report (`Ctrl+P` / Print button).

### Batch Processing
1. Open the **Batch Mode** card in the dashboard.
2. Select multiple plate photos simultaneously.
3. Select configuration source: current interactive settings or a saved configuration file.
4. Enable **"Use auto-detect for each plate"** for automated per-plate perspective fitting. Plates failing confidence threshold are flagged for manual review.
5. Process all plates sequentially with live progress feedback, view the summary table, and download the combined CSV.

### Configuration Save & Load
- Export named configurations (assay layout, controls, cutoffs, calibration parameters) as versioned JSON files.
- Import saved configuration files with automated schema and range validation.

---

## 3. Quality Control (QC) Rules

When any QC validation rule fails, the run is flagged as **QC: FAIL** with a clear diagnostic explanation:

1. **Blank Reference Integrity**:
   - Blank wells (substrate or buffer only) must be brighter than sample and control wells.
2. **Dynamic Range & Exposure QC**:
   - Blank saturation warning if raw blank intensity exceeds 250 (8-bit scale).
   - Underexposure warning if > 25% of wells fall below raw intensity 20. Suggests switching to Green (G) channel or reshooting with brighter light.
3. **Flat-Field Plastic Sampling**:
   - Samples clear plastic at the 4-well midpoints across the plate.
   - Requires at least 20 valid plastic samples; if sample points are occluded or unstable, automatically falls back to raw intensities with an explicit advisory.
4. **Assay Control QC**:
   - **PP Mode (Indirect)**: Positive control OD must exceed Negative control OD by at least $0.05$ ($OD_{pos} - OD_{neg} \ge 0.05$).
   - **PI Mode (Competitive / SPCE)**: Negative control OD (maximum signal) must be $\ge 0.05$, and Positive control PI must meet or exceed the cutoff ($PI_{pos} \ge Cutoff$).
5. **Calibration Fit QC**:
   - Fit requires at least 10 valid calibration wells.
   - Displays $R^2$, RMSE, and number of wells $n$. Flags warning if $R^2 < 0.95$.
6. **Geometry & Perspective QC**:
   - Corners must define a non-degenerate, strictly convex quad. Crossed or inverted corners are rejected before analysis.

---

## 4. Validation Procedure

PlateOD includes an automated unit and integration test suite with synthetic plate generation:

### Running Verification Tests
```bash
python -m unittest discover -s tests -v
```

### What the Test Suite Verifies:
- **OD Recovery**: Validates Beer-Lambert optical density extraction ($OD = -\log_{10}(I_{well} / I_{blank})$) against synthetic ground truth.
- **Dynamic Range QC**: Tests dark plates triggering warnings and auto-channel switching from B to G.
- **Flat-Field Correction**: Applies a 15% brightness gradient to synthetic plates and verifies reduction in OD root-mean-square error.
- **Quadratic & Linear Calibration**: Tests coefficient recovery on synthetic linear and parabolic reader OD series.
- **Perspective Grid Auto-Detection**: Confirms corner recovery within 3 pixels on perspective-distorted plates and rejection on blank noise.
- **Batch Processing**: Verifies multi-plate execution, error isolation (failed plates do not halt the batch), and combined CSV output.
- **Server Concurrency & Resilience**:
  - Tests 5 concurrent analysis requests without race conditions or deadlocks.
  - Validates LRU cache eviction and expiry handling (HTTP 410).
  - Validates rejection of empty requests, malformed JSON, and oversized bodies.
- **Performance Benchmarks**:
  - 12-Megapixel image ($4000 \times 3000$): Upload, decode, and analysis in $\le 1.12\text{ s}$ (target $< 2.0\text{ s}$).
  - Batch of 6 plates: Average $\le 0.24\text{ s}$ per plate (target $< 2.0\text{ s}$).

---

## 5. File Structure
```
plate-od/
├── AGENT_RULES.md          # Architectural invariants and project rules
├── README.md               # User manual and technical reference
├── requirements.txt        # Python dependencies (numpy, opencv-python)
├── analysis.py             # Pure mathematical core and computer vision pipeline
├── server.py               # Stdlib HTTP API server and routing
├── static/
│   ├── index.html          # Accessible, offline HTML5 UI
│   ├── css/
│   │   └── styles.css      # Dark/light design tokens and responsive styles
│   └── js/
│       └── app.js          # Interactive canvas, loupe, batch, and API client
└── tests/
    └── test_analysis.py    # 30 comprehensive unit and integration tests
```

---

## 6. License
Laboratory open source tool for microplate optical density research.
