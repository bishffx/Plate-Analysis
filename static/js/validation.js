"use strict";

/**
 * PlateOD Validation Module (validation.js)
 * 
 * - Circular SVG progress rings for steps 1-4 with animated checkmarks
 * - Inline well address validation with smart auto-suggestions
 * - Dynamic gradient range slider with tracking value bubble
 * - Live preview triggering upon valid parameter updates
 */

import { S } from "./state.js";
import { $, $$, el, clearChildren } from "./dom.js";
import { scheduleLivePreview } from "./live-preview.js";

const CIRCUMFERENCE = 81.68; // 2 * PI * 13

export function updateProgressRing(stepNum, percent) {
  const ring = $(`ring-fill-${stepNum}`);
  const badge = $(`step-badge-${stepNum}`);
  const numText = $(`step-num-${stepNum}`);
  const checkIcon = $(`step-check-${stepNum}`);

  const p = Math.max(0, Math.min(100, percent));
  const offset = CIRCUMFERENCE * (1 - p / 100);

  if (ring) {
    ring.style.strokeDasharray = `${CIRCUMFERENCE}`;
    ring.style.strokeDashoffset = `${offset.toFixed(2)}`;
  }

  if (p >= 100) {
    if (badge) badge.classList.add("step-complete");
    if (numText) numText.classList.add("hidden");
    if (checkIcon) checkIcon.classList.add("visible");
  } else {
    if (badge) badge.classList.remove("step-complete");
    if (numText) numText.classList.remove("hidden");
    if (checkIcon) checkIcon.classList.remove("visible");
  }
}

/**
 * Validates a single well token (e.g. "A1" or "A1-B12").
 * If invalid, returns a suggested replacement if one can be inferred.
 */
export function analyzeWellToken(token, maxRows = 16, maxCols = 24) {
  token = token.trim();
  if (!token) return { valid: false, suggestion: null, reason: "empty" };

  const rowLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const maxRowLetter = rowLetters[maxRows - 1] || "H";

  if (token.includes("-")) {
    const parts = token.split("-");
    if (parts.length !== 2) {
      return { valid: false, suggestion: null, reason: "Malformed range" };
    }
    const [p1, p2] = parts.map((p) => p.trim());
    const m1 = p1.match(/^([A-Za-z])([0-9]+)$/);
    const m2 = p2.match(/^([A-Za-z])([0-9]+)$/);

    if (!m1 || !m2) {
      return { valid: false, suggestion: null, reason: "Invalid range endpoints" };
    }

    const r1 = m1[1].toUpperCase().charCodeAt(0) - 65;
    const c1 = parseInt(m1[2], 10);
    const r2 = m2[1].toUpperCase().charCodeAt(0) - 65;
    const c2 = parseInt(m2[2], 10);

    // Reversed range check (e.g. C1-A1)
    if (c1 === c2 && r1 > r2) {
      const fixed = `${m2[1].toUpperCase()}${c2}-${m1[1].toUpperCase()}${c1}`;
      return { valid: false, suggestion: fixed, reason: "Reversed row order" };
    }
    if (r1 === r2 && c1 > c2) {
      const fixed = `${m1[1].toUpperCase()}${c2}-${m2[1].toUpperCase()}${c1}`;
      return { valid: false, suggestion: fixed, reason: "Reversed column order" };
    }

    if (r1 >= maxRows || r2 >= maxRows) {
      return { valid: false, suggestion: `A1-${maxRowLetter}1`, reason: `Row exceeds limit (${maxRowLetter})` };
    }
    if (c1 > maxCols || c2 > maxCols) {
      return { valid: false, suggestion: `A1-A${maxCols}`, reason: `Column exceeds limit (${maxCols})` };
    }

    return { valid: true, suggestion: null };
  }

  // Single well token
  const m = token.match(/^([A-Za-z])([0-9]+)$/);
  if (!m) {
    if (/^[A-Za-z]$/.test(token)) {
      return { valid: false, suggestion: `${token.toUpperCase()}1`, reason: "Missing column number" };
    }
    if (/^[0-9]+$/.test(token)) {
      return { valid: false, suggestion: `A${token}`, reason: "Missing row letter" };
    }
    return { valid: false, suggestion: null, reason: "Invalid well address format" };
  }

  const rChar = m[1].toUpperCase();
  const r = rChar.charCodeAt(0) - 65;
  const c = parseInt(m[2], 10);

  if (r >= maxRows) {
    return { valid: false, suggestion: `${maxRowLetter}${Math.min(c, maxCols)}`, reason: `Row ${rChar} exceeds plate limit (${maxRowLetter})` };
  }
  if (c > maxCols || c < 1) {
    return { valid: false, suggestion: `${rChar}${maxCols}`, reason: `Column ${c} exceeds plate limit (${maxCols})` };
  }

  // Suggest uppercase if lowercase was typed
  if (m[1] !== rChar) {
    return { valid: true, suggestion: `${rChar}${c}` };
  }

  return { valid: true, suggestion: null };
}

export function validateWellField(inputEl, errorEl, allowEmpty = false) {
  if (!inputEl) return true;
  const maxRows = +($("rows")?.value) || 8;
  const maxCols = +($("cols")?.value) || 12;
  const raw = inputEl.value.trim();

  if (!raw) {
    if (allowEmpty) {
      if (errorEl) errorEl.hidden = true;
      inputEl.classList.remove("input-error");
      return true;
    } else {
      if (errorEl) {
        clearChildren(errorEl);
        errorEl.textContent = "This field cannot be empty";
        errorEl.hidden = false;
      }
      inputEl.classList.add("input-error");
      return false;
    }
  }

  const tokens = raw.split(",");
  for (const rawToken of tokens) {
    const analysis = analyzeWellToken(rawToken, maxRows, maxCols);
    if (!analysis.valid) {
      inputEl.classList.add("input-error");
      if (errorEl) {
        clearChildren(errorEl);
        const reasonSpan = document.createElement("span");
        reasonSpan.textContent = `Invalid well "${rawToken.trim()}": ${analysis.reason || "format error"}. `;
        errorEl.appendChild(reasonSpan);

        if (analysis.suggestion) {
          const suggBtn = document.createElement("button");
          suggBtn.type = "button";
          suggBtn.className = "error-suggestion-btn";
          suggBtn.textContent = `Use ${analysis.suggestion}?`;
          suggBtn.onclick = (e) => {
            e.preventDefault();
            inputEl.value = inputEl.value.replace(rawToken.trim(), analysis.suggestion);
            inputEl.dispatchEvent(new Event("input", { bubbles: true }));
          };
          errorEl.appendChild(suggBtn);
        }
        errorEl.hidden = false;
      }
      return false;
    }
  }

  if (errorEl) errorEl.hidden = true;
  inputEl.classList.remove("input-error");
  return true;
}

export function updateRadiusSliderUI() {
  const slider = $("radius");
  const bubble = $("rv");
  if (!slider || !bubble) return;

  const min = parseFloat(slider.min) || 0.1;
  const max = parseFloat(slider.max) || 0.45;
  const val = parseFloat(slider.value) || 0.28;
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));

  slider.style.setProperty("--val-percent", `${pct.toFixed(1)}%`);
  bubble.textContent = val.toFixed(2);
  bubble.style.left = `${pct.toFixed(1)}%`;
}

export function updateStepperValidation() {
  const rowsEl = $("rows");
  const colsEl = $("cols");
  const radEl = $("radius");

  // Step 1: Plate & image progress calculation
  let s1Score = 0;
  if (S.img) s1Score += 40;
  if (+(rowsEl?.value || 0) >= 2 && +(colsEl?.value || 0) >= 2) s1Score += 30;
  if (+(radEl?.value || 0) >= 0.1) s1Score += 30;
  updateProgressRing(1, s1Score);

  // Step 2: Well roles
  const isSpce = (S.selectedAssay === "SPCE" && !$("pos")?.value.trim());
  const posOk = validateWellField($("pos"), $("pos-err"), isSpce);
  const negOk = validateWellField($("neg"), $("neg-err"), false);
  const blkOk = validateWellField($("blank"), $("blank-err"), false);

  let s2Score = 0;
  if (posOk) s2Score += 33.3;
  if (negOk) s2Score += 33.3;
  if (blkOk) s2Score += 33.4;
  updateProgressRing(2, s2Score);

  // Step 3: Measurement
  const cutoffVal = parseFloat($("cutoff")?.value);
  let s3Score = 0;
  if (Boolean($("channel")?.value)) s3Score += 33.3;
  if (Boolean($("mode")?.value)) s3Score += 33.3;
  if (!isNaN(cutoffVal) && cutoffVal > 0) s3Score += 33.4;
  updateProgressRing(3, s3Score);

  // Step 4: Calibration
  const slopeVal = parseFloat($("slope")?.value);
  const icptVal = parseFloat($("icpt")?.value);
  let s4Score = 0;
  if (!isNaN(slopeVal)) s4Score += 50;
  if (!isNaN(icptVal)) s4Score += 50;
  updateProgressRing(4, s4Score);

  // Enable/disable Run button
  const allValid = s1Score >= 100 && s2Score >= 100 && s3Score >= 100 && s4Score >= 100;
  const runBtn = $("run");
  if (runBtn) {
    runBtn.disabled = !allValid || !S.img;
  }

  // Trigger debounced live preview
  scheduleLivePreview();
}

export function initValidation() {
  const inputIds = [
    "rows", "cols", "radius",
    "pos", "neg", "blank",
    "channel", "dark", "lin", "chk-flat-field", "mode", "cutoff", "cutlow",
    "slope", "icpt", "reader"
  ];

  inputIds.forEach((id) => {
    $(id)?.addEventListener("input", () => {
      if (id === "radius") updateRadiusSliderUI();
      updateStepperValidation();
    });
  });

  const radSlider = $("radius");
  if (radSlider) {
    radSlider.addEventListener("input", updateRadiusSliderUI);
    updateRadiusSliderUI();
  }

  const btnChange = $("btn-change-file");
  if (btnChange) {
    btnChange.onclick = () => $("file")?.click();
  }

  updateStepperValidation();
}
