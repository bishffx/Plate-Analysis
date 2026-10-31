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
│   ├── index.html          # Semantic HTML5 instrument workbench UI
│   ├── css/
│   │   ├── tokens.css      # Design tokens (colors, gradients, motion, radii)
│   │   ├── base.css        # Reset, typography, focus rings, reduced motion
│   │   ├── layout.css      # Responsive grid, header, status bar, drawer
│   │   ├── components.css  # Cards, buttons, tabs, tables, tooltips, dialogs
│   │   └── styles.css      # Main CSS bundle entry
│   └── js/
│       ├── main.js         # Application bootstrap & lifecycle orchestrator
│       ├── api.js          # Resilient Fetch API client with AbortController
│       ├── state.js        # Lightweight reactive observable store
│       ├── dom.js          # Safe DOM construction helpers (strict textContent)
│       ├── plate-canvas.js # Perspective hero, 4x magnifier loupe, grid canvas
│       ├── effects.js      # Spring animations, count-up numbers, spotlit cards
│       ├── navigation.js   # Tab routing, smooth scroll, hero typewriter
│       ├── results.js      # WOW results, donut charts, linked views, inspector
│       ├── ambient-aurora.js# Low-overhead fixed aurora canvas background
│       ├── batch.js        # Multi-plate batch runner with progress bar
│       ├── calibration.js  # Standard curve fitting & regression view
│       └── presets.js      # Assay configuration presets & custom curves
└── tests/
    └── test_analysis.py    # 30 comprehensive unit and integration tests
```

---

## 6. Frontend Architecture & Customization

The PlateOD frontend is built with pure vanilla web standards (HTML5, modular ES2022 JavaScript, and modern CSS custom properties). It runs **100% offline** with zero external CDN dependencies, conforms to WCAG AA accessibility standards ($\ge 4.5:1$ contrast ratio), and strictly enforces data-safe DOM rendering (`textContent` exclusively).

### Design Tokens (`static/css/tokens.css`)

All visual styling is governed by design tokens defined as CSS variables:
* **Ink Backgrounds**: `--bg-page-start: #070B12`, `--bg-page-end: #0E1622` (deep dark theme default).
* **TMB Palette**: `--tmb-start: #FFD166`, `--tmb-mid: #F5A524`, `--tmb-end: #E8590C` (mimicking chromogenic ELISA peroxidase reactions).
* **Aurora Accents**: `--aurora-teal: #2DD4BF`, `--aurora-violet: #8B5CF6`.
* **Class Colours**: Positive `#F0714F`, Negative `#3CB8A8`, Doubtful `#EBCB6B`, Control `#6C97C4`, Blank `#8CA0B8`, Invalid `#C47DB6`.
* **Motion Tokens**: `--duration-instant: 120ms`, `--duration-fast: 200ms`, `--duration-normal: 400ms`, `--duration-slow: 800ms`.

### How to Change Colours
Edit `static/css/tokens.css`:
1. Change the primary amber accent by altering `--amber-primary: #F5A524;` and `--gradient-tmb`.
2. Modify plate well classification colors under `/* Class Colours */` (`--col-pos`, `--col-neg`, `--col-dbt`, `--col-ctl`).
3. For light theme overrides, modify variables within the `[data-theme="light"] { ... }` block.

### How to Change Brand Name
1. Update the logo text and document title in `static/index.html` (e.g. `<span class="brand-name">PlateOD</span>` and `<title>PlateOD - Microplate Photometry</title>`).
2. Update the brand name string in `static/js/main.js` and `static/js/navigation.js`.

### How to Adjust Animation Intensity
1. **Reduce Duration**: Adjust motion duration tokens in `static/css/tokens.css` (e.g., set `--duration-normal: 200ms;` instead of `400ms`).
2. **Instant / Minimal Motion**: Turn on reduced-motion preference in your OS or browser. The application automatically detects `prefers-reduced-motion: reduce` and sets all animation/transition durations to `0.01ms`, pauses the background ambient aurora canvas, and disables spring physics.

---

## 7. License
Laboratory open source tool for microplate optical density research.
