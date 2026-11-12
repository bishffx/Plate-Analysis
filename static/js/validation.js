"use strict";

/**
 * PlateOD Validation Module (validation.js)
 * 
 * - Circular SVG progress rings for steps 1-4 with animated checkmarks
 * - Comprehensive well address syntax validation (A1, A1-D1, comma lists)
 * - Strict plate boundary validation (wells inside current rows x cols)
 * - Mutual exclusion: no well assigned to multiple roles (Pos, Neg, Blank)
 * - Cutoff numeric validation and doubtful lower cutoff threshold checks
 * - Disables Run button until all parameters are completely valid
 * - Dynamic gradient range slider with tracking value bubble
 */

import { S } from "./state.js";
import { $, el, clearChildren } from "./dom.js";
import { scheduleLivePreview } from "./live-preview.js";
import { updateAccordionStatusChips } from "./accordion.js";

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
 * Validates a single well token and expands it to an array of well strings.
 */
export function expandWellToken(token, maxRows = 8, maxCols = 12) {
  token = token.trim();
  if (!token) return { wells: [], error: null };

  const rowLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const maxRowLetter = rowLetters[maxRows - 1] || "H";

  if (token.includes("-")) {
    const parts = token.split("-");
    if (parts.length !== 2) {
      return { wells: [], error: `Malformed well range "${token}"` };
    }
    const [p1, p2] = parts.map((p) => p.trim());
    const m1 = p1.match(/^([A-Za-z])([0-9]+)$/);
    const m2 = p2.match(/^([A-Za-z])([0-9]+)$/);

    if (!m1 || !m2) {
      return { wells: [], error: `Invalid well range "${token}"` };
    }

    const r1 = m1[1].toUpperCase().charCodeAt(0) - 65;
    const c1 = parseInt(m1[2], 10);
    const r2 = m2[1].toUpperCase().charCodeAt(0) - 65;
    const c2 = parseInt(m2[2], 10);

    // Plate bounds check
    if (r1 >= maxRows || r2 >= maxRows || r1 < 0 || r2 < 0) {
      return { wells: [], error: `Range "${token}" exceeds row limit (${maxRowLetter})` };
    }
    if (c1 > maxCols || c2 > maxCols || c1 < 1 || c2 < 1) {
      return { wells: [], error: `Range "${token}" exceeds column limit (${maxCols})` };
    }

    const minR = Math.min(r1, r2);
    const maxR = Math.max(r1, r2);
    const minC = Math.min(c1, c2);
    const maxC = Math.max(c1, c2);

    const result = [];
    for (let r = minR; r <= maxR; r++) {
      const rowChar = String.fromCharCode(65 + r);
      for (let c = minC; c <= maxC; c++) {
        result.push(`${rowChar}${c}`);
      }
    }
    return { wells: result, error: null };
  }

  // Single well
  const m = token.match(/^([A-Za-z])([0-9]+)$/);
  if (!m) {
    return { wells: [], error: `Invalid well syntax "${token}" (expected e.g. A1 or A1-D1)` };
  }

  const rChar = m[1].toUpperCase();
  const r = rChar.charCodeAt(0) - 65;
  const c = parseInt(m[2], 10);

  if (r >= maxRows || r < 0) {
    return { wells: [], error: `Well "${token}" exceeds row limit (${maxRowLetter})` };
  }
  if (c > maxCols || c < 1) {
    return { wells: [], error: `Well "${token}" exceeds column limit (${maxCols})` };
  }

  return { wells: [`${rChar}${c}`], error: null };
}

/**
 * Parses and validates an entire well list string (e.g. "A1-D1, E1").
 */
export function parseAndValidateWells(raw, maxRows = 8, maxCols = 12) {
  if (!raw || !raw.trim()) return { wells: new Set(), error: null };

  const tokens = raw.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
  const wellsSet = new Set();

  for (const token of tokens) {
    const res = expandWellToken(token, maxRows, maxCols);
    if (res.error) {
      return { wells: new Set(), error: res.error };
    }
    for (const w of res.wells) {
      wellsSet.add(w);
    }
  }

  return { wells: wellsSet, error: null };
}

/**
 * Validates a single well field (used for backward compatibility).
 */
export function validateWellField(inputEl, errorEl, allowEmpty = false) {
  if (!inputEl) return true;
  const maxRows = +($("rows")?.value) || 8;
  const maxCols = +($("cols")?.value) || 12;
  const raw = inputEl.value.trim();

  if (!raw) {
    if (allowEmpty) {
      if (errorEl) { errorEl.textContent = ""; errorEl.hidden = true; }
      inputEl.classList.remove("input-error");
      return true;
    } else {
      if (errorEl) {
        errorEl.textContent = "This field cannot be empty";
        errorEl.hidden = false;
      }
      inputEl.classList.add("input-error");
      return false;
    }
  }

  const res = parseAndValidateWells(raw, maxRows, maxCols);
  if (res.error) {
    inputEl.classList.add("input-error");
    if (errorEl) {
      errorEl.textContent = res.error;
      errorEl.hidden = false;
    }
    return false;
  }

  if (errorEl) { errorEl.textContent = ""; errorEl.hidden = true; }
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

/**
 * Core validation cycle for all inputs, mutual exclusions, and progress indicators.
 */
export function updateStepperValidation() {
  const rowsEl = $("rows");
  const colsEl = $("cols");
  const radEl = $("radius");

  const maxRows = +(rowsEl?.value || 8);
  const maxCols = +(colsEl?.value || 12);

  // Step 1: Plate & image progress calculation
  let s1Score = 0;
  if (S.img) s1Score += 40;
  if (+(rowsEl?.value || 0) >= 2 && +(colsEl?.value || 0) >= 2) s1Score += 30;
  if (+(radEl?.value || 0) >= 0.1) s1Score += 30;
  updateProgressRing(1, s1Score);

  // Step 2: Well roles validation & mutual exclusion
  const posEl = $("pos");
  const negEl = $("neg");
  const blkEl = $("blank");
  const posErr = $("pos-err");
  const negErr = $("neg-err");
  const blkErr = $("blank-err");

  const posRaw = posEl?.value.trim() || "";
  const negRaw = negEl?.value.trim() || "";
  const blkRaw = blkEl?.value.trim() || "";

  const isSpce = (S.selectedAssay === "SPCE");
  const modeVal = $("mode")?.value || (isSpce ? "PI" : "PP");

  const posRes = parseAndValidateWells(posRaw, maxRows, maxCols);
  const negRes = parseAndValidateWells(negRaw, maxRows, maxCols);
  const blkRes = parseAndValidateWells(blkRaw, maxRows, maxCols);

  let hasRoleError = false;

  // Clear previous errors
  if (posErr) { posErr.textContent = ""; posErr.hidden = true; }
  if (negErr) { negErr.textContent = ""; negErr.hidden = true; }
  if (blkErr) { blkErr.textContent = ""; blkErr.hidden = true; }
  posEl?.classList.remove("input-error");
  negEl?.classList.remove("input-error");
  blkEl?.classList.remove("input-error");

  // Positive wells validation
  if (!posRaw) {
    // In SPCE, positive control is optional; in DIVA / PP mode, it is required
    if (!isSpce && modeVal === "PP") {
      if (posErr) { posErr.textContent = "Positive control wells are required"; posErr.hidden = false; }
      posEl?.classList.add("input-error");
      hasRoleError = true;
    }
  } else if (posRes.error) {
    if (posErr) { posErr.textContent = posRes.error; posErr.hidden = false; }
    posEl?.classList.add("input-error");
    hasRoleError = true;
  }

  // Negative wells validation (always required)
  if (!negRaw) {
    if (negErr) { negErr.textContent = "Negative/antigen control wells are required"; negErr.hidden = false; }
    negEl?.classList.add("input-error");
    hasRoleError = true;
  } else if (negRes.error) {
    if (negErr) { negErr.textContent = negRes.error; negErr.hidden = false; }
    negEl?.classList.add("input-error");
    hasRoleError = true;
  }

  // Blank wells validation (always required)
  if (!blkRaw) {
    if (blkErr) { blkErr.textContent = "Blank wells are required"; blkErr.hidden = false; }
    blkEl?.classList.add("input-error");
    hasRoleError = true;
  } else if (blkRes.error) {
    if (blkErr) { blkErr.textContent = blkRes.error; blkErr.hidden = false; }
    blkEl?.classList.add("input-error");
    hasRoleError = true;
  }

  // Mutual exclusion: no well assigned to two roles
  if (!hasRoleError) {
    const posSet = posRes.wells;
    const negSet = negRes.wells;
    const blkSet = blkRes.wells;

    const posNegOverlap = [...posSet].filter((w) => negSet.has(w));
    const negBlkOverlap = [...negSet].filter((w) => blkSet.has(w));
    const posBlkOverlap = [...posSet].filter((w) => blkSet.has(w));

    if (posNegOverlap.length > 0) {
      const msg = `Well ${posNegOverlap.join(", ")} assigned to multiple roles (Positive and Negative)`;
      if (posErr) { posErr.textContent = msg; posErr.hidden = false; }
      if (negErr) { negErr.textContent = msg; negErr.hidden = false; }
      posEl?.classList.add("input-error");
      negEl?.classList.add("input-error");
      hasRoleError = true;
    }
    if (negBlkOverlap.length > 0) {
      const msg = `Well ${negBlkOverlap.join(", ")} assigned to multiple roles (Negative and Blank)`;
      if (negErr) { negErr.textContent = msg; negErr.hidden = false; }
      if (blkErr) { blkErr.textContent = msg; blkErr.hidden = false; }
      negEl?.classList.add("input-error");
      blkEl?.classList.add("input-error");
      hasRoleError = true;
    }
    if (posBlkOverlap.length > 0) {
      const msg = `Well ${posBlkOverlap.join(", ")} assigned to multiple roles (Positive and Blank)`;
      if (posErr) { posErr.textContent = msg; posErr.hidden = false; }
      if (blkErr) { blkErr.textContent = msg; blkErr.hidden = false; }
      posEl?.classList.add("input-error");
      blkEl?.classList.add("input-error");
      hasRoleError = true;
    }
  }

  let s2Score = 0;
  if (!hasRoleError) s2Score = 100;
  updateProgressRing(2, s2Score);

  // Step 3: Measurement validation (cutoff & cutlow)
  const cutoffEl = $("cutoff");
  const cutlowEl = $("cutlow");
  const cutoffErr = $("cutoff-err");
  const cutlowErr = $("cutlow-err");

  let hasCutoffError = false;
  if (cutoffErr) { cutoffErr.textContent = ""; cutoffErr.hidden = true; }
  cutoffEl?.classList.remove("input-error");

  const cutoffRaw = cutoffEl?.value.trim() || "";
  const cutoffVal = parseFloat(cutoffRaw);

  if (!cutoffRaw || isNaN(cutoffVal)) {
    if (cutoffErr) { cutoffErr.textContent = "Cutoff must be a valid number"; cutoffErr.hidden = false; }
    cutoffEl?.classList.add("input-error");
    hasCutoffError = true;
  }

  let hasCutlowError = false;
  if (cutlowErr) { cutlowErr.textContent = ""; cutlowErr.hidden = true; }
  cutlowEl?.classList.remove("input-error");

  const cutlowRaw = cutlowEl?.value.trim() || "";
  if (cutlowRaw) {
    const cutlowVal = parseFloat(cutlowRaw);
    if (isNaN(cutlowVal)) {
      if (cutlowErr) { cutlowErr.textContent = "Doubtful lower cutoff must be a number"; cutlowErr.hidden = false; }
      cutlowEl?.classList.add("input-error");
      hasCutlowError = true;
    } else if (!hasCutoffError && cutlowVal >= cutoffVal) {
      if (cutlowErr) {
        cutlowErr.textContent = `Doubtful lower cutoff must be lower than cutoff (${cutoffVal}%)`;
        cutlowErr.hidden = false;
      }
      cutlowEl?.classList.add("input-error");
      hasCutlowError = true;
    }
  }

  let s3Score = 0;
  if (Boolean($("channel")?.value)) s3Score += 33.3;
  if (Boolean($("mode")?.value)) s3Score += 33.3;
  if (!hasCutoffError && !hasCutlowError) s3Score += 33.4;
  updateProgressRing(3, s3Score);

  // Calibration validation
  const selectedCal = S.selectedCalibrationModel || S.calMode || $("cal-model")?.value || "linear";
  let s4Score = 0;
  if (selectedCal === "svr" || selectedCal === "ann") {
    s4Score = 100;
  } else if (selectedCal === "quadratic") {
    const qa = parseFloat($("cal-a")?.value);
    const qb = parseFloat($("cal-b")?.value);
    const qc = parseFloat($("cal-c")?.value);
    if (!isNaN(qa) && !isNaN(qb) && !isNaN(qc)) s4Score = 100;
  } else {
    const slopeVal = parseFloat($("slope")?.value);
    const icptVal = parseFloat($("icpt")?.value);
    if (!isNaN(slopeVal)) s4Score += 50;
    if (!isNaN(icptVal)) s4Score += 50;
  }
  updateProgressRing(4, s4Score);

  // Enable/disable Run button - strictly disabled until all fields are valid
  const allValid = s1Score >= 100 && !hasRoleError && !hasCutoffError && !hasCutlowError && s4Score >= 100;
  const runBtn = $("run");
  if (runBtn) {
    runBtn.disabled = !allValid || !S.img;
  }

  updateAccordionStatusChips();
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
