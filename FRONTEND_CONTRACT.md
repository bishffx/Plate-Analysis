# FRONTEND CONTRACT

This document formalizes the complete contract between the frontend (`static/`) and the backend (`server.py`, `analysis.py`).
**RULE**: Never rename or remove any element ID, API endpoint, request field, response field, localStorage key, or assay default value listed here.

---

## 1. Assay Default Values (Copied Directly from Source)

### Frontend Presets (`static/js/presets.js`)
```javascript
  SPCE: {
    name: "SPCE",
    description: "Solid Phase Competition ELISA (PI mode)",
    mode: "PI",
    cutoff: 65.0,
    pos: "",
    neg: "A1-D1",
    blank: "E1-F1",
    cutlow: "",
    wavelength: "492nm",
    channel_param: "492nm"
  }
```

```javascript
  DIVA: {
    name: "DIVA",
    description: "Differentiating Infected from Vaccinated Animals (PP mode)",
    mode: "PP",
    cutoff: 40.0,
    pos: "H7-H8",
    neg: "H9-H10",
    blank: "H11-H12",
    cutlow: "",
    wavelength: "492nm",
    channel_param: "492nm"
  }
```

### Backend Presets (`analysis.py`)
```python
ASSAYS = {
    "SPCE": {
        "name": "SPCE",
        "description": "Solid Phase Competition ELISA (PI mode)",
        "mode": "PI",
        "cutoff": 65.0,
        "wavelength": "492nm",
        "channel_param": "492nm",
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
        "wavelength": "492nm",
        "channel_param": "492nm",
        "pos": "H7-H8",
        "neg": "H9-H10",
        "blank": "H11-H12",
        "pos_role": "Positive ctrl",
        "neg_role": "Negative ctrl",
        "blank_role": "Blank",
    },
}
```

---

## 2. API Endpoints & Network Contracts

Every fetch call executed from `static/js/` (`api.js`, `live-preview.js`):

### 1. `GET /`
- **Method**: `GET`
- **Caller**: `checkServerHealth()` in `api.js`
- **Headers**: `{ "cache": "no-store" }`
- **Request Fields**: None
- **Response Fields Read**: `response.ok` (boolean) to determine server online/offline state.

### 2. `POST /api/presets`
- **Method**: `POST`
- **Caller**: `fetchPresets()` in `api.js`
- **Request Fields**: `{}`
- **Response Fields Read**:
  - Map of assay keys (`SPCE`, `DIVA`) to assay preset objects:
    - `name` (string)
    - `description` (string)
    - `mode` ("PI" | "PP")
    - `cutoff` (float)
    - `wavelength` (string, e.g. "492nm")
    - `channel_param` (string, e.g. "492nm")
    - `pos` (string well address)
    - `neg` (string well address)
    - `blank` (string well address)
    - `neg_role`, `neg_label`, `pos_role`, `blank_role`

### 3. `POST /api/upload`
- **Method**: `POST`
- **Caller**: `uploadImage(dataUrl)` in `api.js`
- **Request Fields**:
  - `image` (string): Base64 data URL of downscaled plate photo
- **Response Fields Read**:
  - `id` (string): Server-side in-memory cache token
  - `width` (int): Image width in pixels
  - `height` (int): Image height in pixels

### 4. `POST /api/prepare`
- **Method**: `POST`
- **Caller**: `prepareImage(dataUrl)` in `api.js`
- **Request Fields**:
  - `image` (string): Base64 data URL
- **Response Fields Read**:
  - `id` (string): In-memory cache token
  - `width` (int): Image width
  - `height` (int): Image height

### 5. `POST /api/grid`
- **Method**: `POST`
- **Caller**: `fetchGrid(params, signal)` in `api.js`
- **Request Fields**:
  - `image_id` (string, optional): Cached image ID
  - `image` (string, optional): Base64 data URL fallback
  - `corners` (array of 4 [x, y] coordinates): Corner well centres
  - `rows` (int): Number of plate rows (default 8)
  - `cols` (int): Number of plate columns (default 12)
  - `radius` (float): Well radius fraction (default 0.28)
- **Response Fields Read**:
  - `centers` (array of [x, y]): Matrix of calculated well centres
  - `radii` (array of float): Matrix of calculated well radii
  - `corners` (array of 4 [x, y]): Normalised corners

### 6. `POST /api/detect_grid`
- **Method**: `POST`
- **Caller**: `detectGrid(params, signal)` in `api.js`
- **Request Fields**:
  - `image_id` (string, optional)
  - `image` (string, optional)
  - `config` (object, optional): `{ rows, cols, radius }`
- **Response Fields Read**:
  - `suggested` (array of 4 [x, y]): Auto-detected corners
  - `corners` (array of 4 [x, y]): Same as suggested
  - `confidence` (float): Detection confidence score (0.0 to 1.0)
  - `inliers` (int): Number of circle inliers found
  - `total` (int): Total expected wells
  - `message` (string): User-facing status message
  - `success` (bool): Detection success status

### 7. `POST /api/analyze`
- **Method**: `POST`
- **Caller**: `analyzePlate(params, signal)` in `api.js`, `live-preview.js`
- **Request Fields**:
  - `image_id` (string, optional)
  - `image` (string, optional)
  - `config` (object):
    - `rows` (int)
    - `cols` (int)
    - `radius` (float)
    - `channel` ("AUTO" | "B" | "G" | "R" | "GRAY" | "CYAN")
    - `linearize` (bool)
    - `dark_level` (float)
    - `assay` ("SPCE" | "DIVA" | "CUSTOM")
    - `mode` ("PI" | "PP")
    - `cutoff` (float)
    - `cutoff_low` (float, optional)
    - `pos` (string well address)
    - `neg` (string well address)
    - `blank` (string well address)
    - `model` ("linear" | "quadratic")
    - `slope` (float)
    - `intercept` (float)
    - `a`, `b`, `c` (float, quadratic calibration)
    - `flat_field` (bool)
    - `blank_correction` (bool)
    - `reader` (string, reader raw text)
    - `use_reader` (bool)
    - `reader_ods` (object, optional parsed reader matrix)
    - `corners` (array of 4 [x, y] coordinates)
- **Response Fields Read**:
  - `valid` (bool): QC pass or fail
  - `errors` (array of string): Fatal QC errors
  - `warnings` (array of string): Non-fatal QC warnings
  - `mode` ("PI" | "PP")
  - `cutoff` (float)
  - `assay` (string)
  - `channel` (string)
  - `channel_used` (string)
  - `wavelength` (string)
  - `channel_param` (string)
  - `reason` (string)
  - `channel_info` (object)
  - `auto_channel` (object)
  - `flat_field` (object: `{ applied, range_percent }`)
  - `flat_field_applied` (bool)
  - `illumination_range_percent` (float)
  - `model` (string)
  - `slope`, `intercept`, `cal_a`, `cal_b`, `cal_c` (float)
  - `reference` (object: `{ name, formula, pos_od, neg_od, blank_od, blank_intensity, cutoff_percent, cutoff_od, used_reader_ods }`)
  - `summary` (object: `{ blank_intensity, pos_od, neg_od, blank_od, delta_od, positive, negative, doubtful, invalid }`)
  - `wells` (array of objects):
    - `well` (string, e.g. "A1")
    - `row` (int), `col` (int)
    - `role` (string)
    - `intensity` (float)
    - `od` (float)
    - `od_cal` (float)
    - `value` (float, PI % or PP %)
    - `class` (string: "Positive" | "Negative" | "Doubtful" | "Invalid" | "Blank" | "Control")
    - `flag` (string note)
  - `annotated` (string: Base64 JPEG data URL)

### 8. `POST /api/calibrate`
- **Method**: `POST`
- **Caller**: `calibrateFit(params)` in `api.js`
- **Request Fields**:
  - `rows` (int), `cols` (int)
  - `image_od` (object: `{ "A1": 0.123, ... }`)
  - `reader` (string: multi-line raw reader matrix)
  - `model` ("linear" | "quadratic")
- **Response Fields Read**:
  - `model` (string)
  - `slope`, `intercept` (float, linear)
  - `a`, `b`, `c` (float, quadratic)
  - `r2` (float): Coefficient of determination
  - `rmse` (float): Root mean square error
  - `n` (int): Number of calibration wells matched
  - `points` (array of `{ well, x, y }`): Calibration scatter points

### 9. `POST /api/config/validate`
- **Method**: `POST`
- **Caller**: `validateConfigFile(config)` in `api.js`
- **Request Fields**:
  - `version` (string, e.g. "2.0")
  - `config` (object with full assay configuration)
- **Response Fields Read**:
  - `valid` (bool)
  - `config` (validated cleaned configuration object)
  - `errors` (array of string)

### 10. `POST /api/batch`
- **Method**: `POST`
- **Caller**: `runBatch(plates, config, autoDetect)` in `api.js`
- **Request Fields**:
  - `plates` (array of objects: `{ name, image, image_id, corners? }`)
  - `config` (object: configuration dictionary)
  - `auto_detect` (bool)
- **Response Fields Read**:
  - `summary` (object: `{ total, success, failed, valid_count, invalid_count, elapsed_seconds }`)
  - `results` (array of objects: `{ name, status, error, valid, summary, wells, corners, detection_confidence }`)


---

## 3. LocalStorage Keys

The following localStorage keys are used across `static/js/`:
1. `plateod_theme_pref`: User theme mode preference (`"dark"` | `"light"` | `"system"`) in `static/js/theme.js`.
2. `plateod_aesthetic`: Selected aesthetic movement style ID in `static/js/aesthetics.js`.
3. `plateod_recent_actions`: JSON array of up to 5 recently used command IDs in `static/js/command-palette.js`.
4. `plateod_tour_completed`: Flag (`"true"`) indicating if onboarding tour has been viewed in `static/js/tour.js`.
5. `plateod_assay_edits_spce`: JSON object storing user-customized field overrides for SPCE in `static/js/presets.js`.
6. `plateod_assay_edits_diva`: JSON object storing user-customized field overrides for DIVA in `static/js/presets.js`.

---

## 4. Complete Inventory of Element IDs

Total IDs: 373 elements.
Every ID listed below MUST remain present and unaltered in name in `static/index.html` or script queries:

- `3d-inflated`
- `accordion-container`
- `aesthetics-grid`
- `aesthetics-lab`
- `aesthetics-lab-heading`
- `ambient-aurora-cv`
- `analyzer`
- `anti-design`
- `art-nouveau`
- `assay-info`
- `assay-inputs-container`
- `assay-selector`
- `assays`
- `assays-heading`
- `badge-assay-status`
- `badge-customised`
- `banner`
- `batch-cfg-input`
- `batch-cfg-name`
- `batch-config-select`
- `batch-dropzone`
- `batch-file-input`
- `batch-heading`
- `batch-mode`
- `batch-pct-text`
- `batch-progress-bar`
- `batch-progress-wrap`
- `batch-results-wrap`
- `batch-status-text`
- `batch-summary-table`
- `batch-tbody`
- `bauhaus`
- `blank`
- `blank-correction`
- `blank-err`
- `blank-wrap`
- `brutalism`
- `btn-accordion-assay`
- `btn-accordion-cal`
- `btn-accordion-measure`
- `btn-accordion-plate`
- `btn-accordion-roles`
- `btn-accordion-toggle-all`
- `btn-assay-custom`
- `btn-assay-diva`
- `btn-assay-spce`
- `btn-auto-grid`
- `btn-batch-cfg-upload`
- `btn-batch-csv`
- `btn-cal-linear`
- `btn-cal-quad`
- `btn-change-file`
- `btn-clear-all-roles`
- `btn-clear-compare`
- `btn-copy-table`
- `btn-cta-open`
- `btn-download-heatmap-png`
- `btn-fit-grid`
- `btn-hero-open`
- `btn-load-cfg`
- `btn-mobile-menu`
- `btn-print-report`
- `btn-redo`
- `btn-rerun`
- `btn-reset-assay-defaults`
- `btn-reset-grid`
- `btn-sample-dropzone`
- `btn-sample-empty-state`
- `btn-save-cfg`
- `btn-select-batch`
- `btn-tips-next`
- `btn-tips-prev`
- `btn-toggle-circles`
- `btn-toggle-style-menu`
- `btn-try-sample`
- `btn-try-sample-cta`
- `btn-undo`
- `btn-use-diva-hero`
- `btn-use-reader`
- `btn-use-spce-hero`
- `btn-zoom-in`
- `btn-zoom-out`
- `cal-a`
- `cal-alert`
- `cal-b`
- `cal-c`
- `cal-model`
- `cal-scatter-cv`
- `cal-stats`
- `capabilities-marquee`
- `card-assay`
- `card-proto-custom`
- `card-proto-diva`
- `card-proto-spce`
- `cfg-file-input`
- `channel`
- `chip-status-assay`
- `chip-status-cal`
- `chip-status-measure`
- `chip-status-plate`
- `chip-status-roles`
- `chk-batch-auto-detect`
- `chk-edit-values`
- `chk-flat-field`
- `chk-use-reader`
- `col-settings`
- `col-workbench`
- `cols`
- `command-palette-backdrop`
- `command-palette-close`
- `command-palette-input`
- `command-palette-list`
- `command-palette-modal`
- `command-palette-trigger`
- `compare-bar`
- `compare-diff`
- `compare-well-1`
- `compare-well-2`
- `csv`
- `cta-heading`
- `current-aesthetic-name`
- `customise-wells`
- `cutlow`
- `cutlow-err`
- `cutlow-wrap`
- `cutoff`
- `cutoff-err`
- `cutoff-wrap`
- `cv`
- `dark`
- `de-stijl`
- `detect-grid`
- `diva-blank`
- `diva-controls-wrap`
- `diva-cutoff`
- `diva-neg`
- `diva-pos`
- `donut-center-label`
- `donut-chart-cv`
- `download`
- `faq`
- `faq-btn-1`
- `faq-btn-2`
- `faq-btn-3`
- `faq-btn-4`
- `faq-btn-5`
- `faq-btn-6`
- `faq-heading`
- `faq-panel-1`
- `faq-panel-2`
- `faq-panel-3`
- `faq-panel-4`
- `faq-panel-5`
- `faq-panel-6`
- `features`
- `features-heading`
- `file`
- `file-chip`
- `file-chip-name`
- `file-chip-size`
- `fit`
- `fitnote`
- `ghost-plate-wrap`
- `glitch`
- `grid-readout`
- `grunge`
- `header-current-style-label`
- `header-style-menu`
- `heat-tooltip`
- `hero-canvas-wrap`
- `hero-demo-meter`
- `hero-heading`
- `hero-live-preview`
- `hero-mini-heatmap`
- `hero-plate-canvas`
- `hero-preview-blank`
- `hero-preview-pos`
- `hero-preview-qc`
- `hero-stat-strip`
- `hero-typewriter`
- `hero-well-tooltip`
- `hint-blank`
- `hint-neg`
- `hint-pos`
- `history-chip`
- `home`
- `how-heading`
- `how-it-works`
- `icpt`
- `infPuff`
- `inspector-btn-next`
- `inspector-btn-pin`
- `inspector-btn-prev`
- `inspector-close-btn`
- `inspector-crop-cv`
- `inspector-gauge-cutoff`
- `inspector-gauge-cutoff-line`
- `inspector-gauge-fill`
- `inspector-gauge-hi`
- `inspector-gauge-lo`
- `inspector-gauge-needle`
- `inspector-lbl-value`
- `inspector-val-intensity`
- `inspector-val-od`
- `inspector-val-od-cal`
- `inspector-val-role`
- `inspector-val-value`
- `inspector-well-class`
- `inspector-well-id`
- `isometric`
- `lbl-blank`
- `lbl-neg`
- `lbl-pos`
- `lightbox`
- `lightbox-close`
- `lightbox-img`
- `lin`
- `linear-params`
- `liquid-chrome`
- `live-preview-strip`
- `lqCr`
- `mbCrystA`
- `mbCrystB`
- `mbGlow`
- `mbOrbGrad`
- `mbOrbRim`
- `memphis`
- `meter-qc`
- `meter-time`
- `meter-wells`
- `mid-century-modern`
- `mobile-nav`
- `mod-blank`
- `mod-cutlow`
- `mod-cutoff`
- `mod-neg`
- `mod-pos`
- `mode`
- `moon-mask`
- `nav-toggle`
- `neg`
- `neg-err`
- `neg-wrap`
- `neumorphism`
- `nmDrop`
- `paint-btn-blank`
- `paint-btn-clear`
- `paint-btn-neg`
- `paint-btn-pos`
- `painter-grid`
- `panel-assay`
- `panel-cal`
- `panel-measure`
- `panel-plate`
- `panel-roles`
- `paper-cutout`
- `pcSh`
- `ph`
- `photo-tips`
- `pos`
- `pos-err`
- `pos-wrap`
- `preview-error-hint`
- `preview-heatmap-cv`
- `preview-meta-strip`
- `preview-pulse-status`
- `preview-quick-summary`
- `preview-tag-blank`
- `preview-tag-controls`
- `preview-tag-qc`
- `print-bundle`
- `problems-card`
- `psychedelic`
- `qc-pill`
- `qc-pill-text`
- `quad-params`
- `radius`
- `reader`
- `readout-dims`
- `readout-handle`
- `readout-radius`
- `reference-panel`
- `reset-field-blank`
- `reset-field-cutlow`
- `reset-field-cutoff`
- `reset-field-neg`
- `reset-field-pos`
- `results`
- `results-empty-state`
- `results-meta-assay`
- `results-meta-channel`
- `results-meta-time`
- `rows`
- `run`
- `run-summary-assay`
- `run-summary-channel`
- `run-summary-line`
- `run-summary-wells`
- `rv`
- `sb-assay-info`
- `sb-btn-shortcuts`
- `sb-image-info`
- `sb-latency-info`
- `sb-status-dot`
- `sb-status-text`
- `scroll-progress-bar`
- `scroll-story-container`
- `server-offline-banner`
- `server-retry-btn`
- `server-status`
- `shortcuts-list`
- `shortcuts-modal`
- `shortcuts-modal-backdrop`
- `shortcuts-modal-close`
- `site-header`
- `site-nav`
- `skChas`
- `skWell`
- `skeleton-loader`
- `skeuomorphism`
- `slope`
- `spce-antigen`
- `spce-blank`
- `spce-controls-wrap`
- `spce-cutoff`
- `spce-pos`
- `stage`
- `stat-qc`
- `stat-res`
- `stat-time`
- `stat-wells`
- `stats`
- `status-bar`
- `status-dot`
- `status-text`
- `steampunk`
- `step-card-1`
- `step-card-3`
- `step-card-4`
- `step-roles`
- `sticky-run-bar`
- `story-narrative-col`
- `story-pinned-card`
- `story-plate-canvas`
- `story-status-indicator`
- `story-status-label`
- `story-step-1`
- `story-step-2`
- `story-step-3`
- `story-step-4`
- `story-visual-col`
- `summary-strip`
- `tab-od`
- `tab-table`
- `tab-val`
- `tabs`
- `theme-toggle-morph`
- `tips-carousel-track`
- `tips-carousel-wrap`
- `tips-heading`
- `toast-container`
- `tour-card`
- `tour-overlay`
- `tour-spotlight`
- `txt-accordion-toggle-all`
- `ukiyo-e`
- `vaporwave`
- `view`
- `well-inspector-drawer`
- `well-painter-widget`
- `zoom-100`
- `zoom-150`
- `zoom-fit`