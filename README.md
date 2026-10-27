# ELISA Plate OD Analyzer

Plate photo -> linearised, blank-referenced OD -> PP (indirect) or PI (competitive) -> classification.

## Run
    python -m venv .venv
    # Windows: .venv\Scripts\activate      macOS/Linux: source .venv/bin/activate
    pip install -r requirements.txt
    python -m unittest discover -s tests    # should end with OK
    python server.py                        # open http://127.0.0.1:8000

## Use
1. Upload the plate photo.
2. Drag the 4 orange handles onto the centres of A1, A12, H12, H1. Green circles = measured areas.
3. Set Positive / Negative / **Blank** wells to match your plate map (blank = substrate only or empty wells).
4. Pick channel B (G if wells are very dark), mode PP or PI (SPCE = PI), cutoff. Run.
5. Optional: paste plate-reader ODs and press "Fit slope from reader" to calibrate.

## QC rules (the run is marked FAIL and nothing is classified when violated)
- blank wells must be brighter than the sample wells
- PP: positive control OD must exceed negative control OD by >= 0.05
- PI: negative (max-signal) control OD >= 0.05 and positive control PI >= cutoff

## Files
analysis.py (all maths) | server.py (stdlib HTTP API) | static/index.html (UI) | tests/ (synthetic-plate tests)

## Frontend

### File Structure
- `static/index.html`: Semantic, offline HTML markup with accessible landmarks, SVG icons, numbered stepper, interactive grid stage, and dashboard layout.
- `static/css/styles.css`: Design tokens, dark/light theme systems, responsive media queries (360px, 768px, 1024px, 1440px), and print stylesheet (`@media print`).
- `static/js/app.js`: Vanilla JavaScript module managing grid placement (perspective homography, magnifier loupe, keyboard nudging), API interactions, heatmaps, and results table.

### Design Tokens & Customization
All styling is centralized at the top of `static/css/styles.css`:
- **Theme Palette**: The app defaults to a laboratory dark theme (`color-scheme: dark`) with background `#0A0F16` to `#0F1620`, cards `#141B25`, raised surfaces `#1A2331`, and inputs `#0D131B`.
- **Brand Colors**: Modify `--amber-primary` (`#F5A524`) and `--amber-end` (`#FF7A18`) for buttons, active tabs, and focus rings.
- **Brand Name**: Located in `static/index.html` inside `<span class="brand-name">PlateOD</span>` and the `<title>` tag.
- **Assay Classes**: Color-blind safe palette tuned for dark backgrounds: `--col-pos` (`#F0714F`), `--col-neg` (`#3CB8A8`), `--col-dbt` (`#EBCB6B`), `--col-ctl` (`#6C97C4`), `--col-blk` (`#9AA1AB`), and `--col-inv` (`#C47DB6`).
- **Semantic Accents**: Success (`#34D399`), Danger (`#F87171`), Warning (`#FBBF24`), Info (`#60A5FA`).
- **Print**: Dedicated `@media print` generates a crisp white-background laboratory report.
