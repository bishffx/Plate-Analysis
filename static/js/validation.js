"use strict";

/**
 * PlateOD Validation Module (validation.js)
 * 
 * Stepper state checking, well address syntax validation (A1, B1-B12),
 * and dynamic step badge updates (using strict DOM construction).
 */

import { S } from "./state.js";
import { $, el, clearChildren } from "./dom.js";

export function setBadgeValid(badgeEl, isValid, defaultNum) {
  if (!badgeEl) return;
  clearChildren(badgeEl);
  if (isValid) {
    badgeEl.classList.add("step-valid");
    badgeEl.setAttribute("aria-label", `Step ${defaultNum} valid`);
    // Safe SVG creation via DOM
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "13");
    svg.setAttribute("height", "13");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "3");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", "20 6 9 17 4 12");
    svg.appendChild(polyline);
    badgeEl.appendChild(svg);
  } else {
    badgeEl.classList.remove("step-valid");
    badgeEl.textContent = String(defaultNum);
    badgeEl.setAttribute("aria-label", `Step ${defaultNum}`);
  }
}

export function validateWellToken(token, maxRows = 16, maxCols = 24) {
  token = token.trim();
  if (!token) return false;
  const parts = token.split("-");
  if (parts.length > 2) return false;
  for (const p of parts) {
    const m = p.trim().match(/^([A-Pa-p])([1-9]|1[0-9]|2[0-4])$/);
    if (!m) return false;
    const r = m[1].toUpperCase().charCodeAt(0) - 65;
    const c = parseInt(m[2], 10);
    if (r >= maxRows || c > maxCols) return false;
  }
  return true;
}

export function validateWellField(inputEl, errorEl, allowEmpty = false) {
  if (!inputEl) return true;
  const maxRows = +($("rows")?.value) || 8;
  const maxCols = +($("cols")?.value) || 12;
  const val = inputEl.value.trim();
  if (!val) {
    if (allowEmpty) {
      if (errorEl) errorEl.hidden = true;
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
  const tokens = val.split(",");
  for (const t of tokens) {
    if (!validateWellToken(t, maxRows, maxCols)) {
      if (errorEl) {
        errorEl.textContent = `Invalid well "${t.trim()}" (e.g. A1, B1-B12)`;
        errorEl.hidden = false;
      }
      inputEl.classList.add("input-error");
      return false;
    }
  }
  if (errorEl) errorEl.hidden = true;
  inputEl.classList.remove("input-error");
  return true;
}

export function updateStepperValidation() {
  const rowsEl = $("rows");
  const colsEl = $("cols");
  const radEl = $("radius");

  // Step 1: Plate & image
  const s1Valid = Boolean(S.img) &&
    +(rowsEl?.value || 0) >= 2 &&
    +(colsEl?.value || 0) >= 2 &&
    +(radEl?.value || 0) >= 0.1;
  setBadgeValid($("step-badge-1"), s1Valid, 1);

  // Step 2: Well roles
  const isSpce = (S.selectedAssay === "SPCE" && !$("pos")?.value.trim());
  const posOk = validateWellField($("pos"), $("pos-err"), isSpce);
  const negOk = validateWellField($("neg"), $("neg-err"), false);
  const blkOk = validateWellField($("blank"), $("blank-err"), false);
  const s2Valid = posOk && negOk && blkOk;
  setBadgeValid($("step-badge-2"), s2Valid, 2);

  // Step 3: Measurement
  const cutoffVal = parseFloat($("cutoff")?.value);
  const s3Valid = !isNaN(cutoffVal) && cutoffVal > 0 && Boolean($("channel")?.value) && Boolean($("mode")?.value);
  setBadgeValid($("step-badge-3"), s3Valid, 3);

  // Step 4: Calibration
  const slopeVal = parseFloat($("slope")?.value);
  const icptVal = parseFloat($("icpt")?.value);
  const s4Valid = !isNaN(slopeVal) && !isNaN(icptVal);
  setBadgeValid($("step-badge-4"), s4Valid, 4);

  // Enable/disable Run button
  const allValid = s1Valid && s2Valid && s3Valid && s4Valid;
  const runBtn = $("run");
  if (runBtn) {
    if (!allValid || !S.img) {
      runBtn.disabled = true;
    } else {
      runBtn.disabled = false;
    }
  }
}

export function initValidation() {
  const inputIds = [
    "rows", "cols", "radius",
    "pos", "neg", "blank",
    "channel", "dark", "lin", "mode", "cutoff", "cutlow",
    "slope", "icpt", "reader"
  ];

  inputIds.forEach((id) => {
    $(id)?.addEventListener("input", updateStepperValidation);
  });

  const btnChange = $("btn-change-file");
  if (btnChange) {
    btnChange.onclick = () => $("file")?.click();
  }

  updateStepperValidation();
}
