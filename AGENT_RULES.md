# AGENT_RULES.md

This document defines mandatory safeguards and engineering rules for all development on the PlateOD project. Every agent and contributor must follow these rules strictly for the whole project:

1. **FRONTEND ONLY**:
   - Never modify `analysis.py`, `server.py`, `tests/`, any API endpoint, request payload, response field, or any calculation (OD, PP, PI, calibration, QC, channel logic).

2. **DOM ID PRESERVATION**:
   - Never remove or rename an element `id` used by the analyzer or its scripts. Add new `id`s instead.

3. **OFFLINE & ZERO EXTERNAL CDNs**:
   - No CDNs or remote assets. Everything works offline from `static/`.
   - Three.js is loaded from `static/vendor/three/` (MIT).

4. **DOM SECURITY & DYNAMIC TEXT**:
   - Dynamic text goes in with `textContent`, never `innerHTML` with data.

5. **AESTHETIC & TYPOGRAPHIC RULES**:
   - No `text-shadow` anywhere in stylesheets or inline styles.
   - No decorative numbering (e.g. "01 /", "Step 1", "1.", "2.").
   - No emojis.
   - Real data numbers (e.g. OD values, "8 x 12", "96 wells") stay.

6. **FACTUAL DESCRIPTIONS ONLY**:
   - Do not invent accuracy or performance claims (no "98%", "0.001 OD", "100% concordance", "validated", "within 2% of a spectrophotometer").
   - Describe what the tool does clearly and factually.
   - Mark demo values explicitly as demo.

7. **TEST INTEGRITY & COMMIT GATE**:
   - After every task: run `python -m unittest discover -s tests`.
   - Commit only if all tests are green (passing).
