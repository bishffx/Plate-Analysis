# AGENT_RULES.md

This document defines mandatory safeguards and engineering rules for all development on the PlateOD project. Every agent and contributor must follow these rules strictly.

---

### Core Safeguards & Operating Rules

1. **Analysis Maths Integrity**:
   - Never change analysis maths (formulas, thresholds, QC rules, absorbance calculation, standard error equations) unless a user task explicitly requests it.
   - Always add a dedicated test in `tests/test_analysis.py` for any mathematical or algorithmic modification.

2. **DOM & API Stability**:
   - Never remove or rename an existing HTML element `id` in `static/index.html`.
   - Never remove or rename any existing API endpoint, request parameter, or response field.
   - Always add new elements or optional parameters instead of altering existing contracts.

3. **Offline & Dependency Constraints**:
   - Backend: Standard-library Python plus `numpy` and `opencv-python` (`cv2`) only.
   - Frontend: Vanilla modern JavaScript, HTML5, and CSS3 only.
   - Absolutely no external CDNs, remote fonts, or external JavaScript/CSS libraries; the application must operate completely offline in air-gapped environments.

4. **DOM Security & Dynamic Rendering**:
   - All dynamic text and user/file-provided content must be injected into the DOM using `textContent` or `document.createElement()`, never `innerHTML`.

5. **Test-Driven Rigor & UI Verification**:
   - Every new analytical or server feature requires at least one automated unit test in `tests/`.
   - Every new UI control or user workflow requires an end-to-end browser verification.
   - After completing any task, execute:
     ```bash
     python -m unittest discover -s tests
     ```
     and only commit when all tests pass.

6. **Failure Safeguard**:
   - If an automated test fails and cannot be fixed in two attempts, stop and report the issue to the user immediately instead of weakening or disabling the test assertion.
