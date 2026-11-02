"use strict";

/**
 * PlateOD Presets Module (presets.js)
 * 
 * Manages assay presets (SPCE, DIVA, Custom), manual edit mode ("Edit values" switch),
 * persistent storage of edits per assay in localStorage, per-field reset buttons,
 * dynamic description lines, and status badges.
 */

import { S, setState } from "./state.js";
import { $ } from "./dom.js";
import { fetchPresets } from "./api.js";
import { updateStepperValidation } from "./validation.js";
import { syncPainterFromInputs } from "./painter.js";
import { updateAccordionStatusChips } from "./accordion.js";

export const DEFAULT_PRESETS = {
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
  },
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
};

/**
 * Reads saved edits for an assay from localStorage.
 */
export function getStoredEdits(assay) {
  if (!assay) return null;
  try {
    const key = `plateod_assay_edits_${assay.toLowerCase()}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Writes or removes saved edits for an assay in localStorage and S.assayEdits.
 */
export function setStoredEdits(assay, edits) {
  if (!assay) return;
  try {
    const key = `plateod_assay_edits_${assay.toLowerCase()}`;
    if (edits) {
      localStorage.setItem(key, JSON.stringify(edits));
    } else {
      localStorage.removeItem(key);
    }
  } catch (e) {}

  if (!S.assayEdits) S.assayEdits = {};
  S.assayEdits[assay] = edits;
}

/**
 * Compares current field value with default preset value.
 */
export function checkFieldModified(field) {
  const assay = S.selectedAssay;
  if (!assay || assay === "Custom") return true;
  const defs = DEFAULT_PRESETS[assay];
  if (!defs) return false;

  const currentVal = $(field)?.value.trim() || "";
  const defaultVal = String(defs[field] !== undefined ? defs[field] : "").trim();
  return currentVal !== defaultVal;
}

/**
 * Updates small "modified" markers and per-field reset buttons.
 */
export function updateModifiedMarkers() {
  const fields = ["pos", "neg", "blank", "cutoff", "cutlow"];
  let anyModified = false;

  fields.forEach((field) => {
    const modEl = $(`mod-${field}`);
    if (!modEl) return;
    const isMod = checkFieldModified(field);
    modEl.hidden = !isMod;
    if (isMod) anyModified = true;
  });

  updateAssayBadge(anyModified);
}

/**
 * Updates the assay status badge: "Default" or "Customised" (with amber dot).
 */
export function updateAssayBadge(anyModified = null) {
  const badge = $("badge-assay-status");
  const legacyBadge = $("badge-customised");

  if (anyModified === null) {
    anyModified = ["pos", "neg", "blank", "cutoff", "cutlow"].some((f) => checkFieldModified(f));
  }

  const isCustom = S.selectedAssay === "Custom";
  const isModified = anyModified || isCustom;
  S.isCustomised = isModified;

  if (badge) {
    if (isModified) {
      badge.className = "badge-assay-status badge-customised";
      badge.innerHTML = `<span class="amber-dot"></span> Customised`;
    } else {
      badge.className = "badge-assay-status badge-default";
      badge.textContent = "Default";
    }
  }

  if (legacyBadge) {
    legacyBadge.hidden = !isModified;
  }

  updateAccordionStatusChips();
}

/**
 * Dynamically builds description line under the segmented control
 * from CURRENT field values.
 */
export function updateAssayDescription() {
  const info = $("assay-info");
  if (!info) return;

  const assay = S.selectedAssay || "DIVA";
  const pos = $("pos")?.value.trim() || "";
  const neg = $("neg")?.value.trim() || "";
  const blk = $("blank")?.value.trim() || "";
  const mode = $("mode")?.value || (assay === "SPCE" ? "PI" : "PP");

  const posPart = pos ? `${pos} = positive control, ` : "";

  if (assay === "DIVA" || (assay !== "SPCE" && mode === "PP")) {
    info.textContent = `${posPart}${neg} = negative control, ${blk} = blank. Result is percentage positivity (PP).`;
  } else if (assay === "SPCE" || mode === "PI") {
    info.textContent = `${posPart}${neg} = antigen (max-signal) control, ${blk} = blank. Result is % inhibition (PI).`;
  } else {
    info.textContent = `${posPart}${neg} = control, ${blk} = blank.`;
  }
}

/**
 * Sets the "Edit values" switch state and locks/unlocks fields accordingly.
 */
export function setEditValues(enabled = true) {
  S.isEditingValues = true;
  const chk = $("chk-edit-values");
  if (chk) chk.checked = true;

  const fields = ["pos", "neg", "blank", "cutoff", "cutlow"];
  fields.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.readOnly = false;
    el.classList.remove("is-locked");
  });

  const modeEl = $("mode");
  if (modeEl) {
    modeEl.disabled = false;
    modeEl.classList.remove("is-locked");
  }

  const posWrap = $("pos-wrap");
  if (posWrap) {
    posWrap.hidden = false;
  }
}

/**
 * Resets the active assay to its default preset values and clears saved edits.
 */
export function resetAssayToDefaults() {
  const assay = S.selectedAssay || "DIVA";
  setStoredEdits(assay, null);
  selectAssay(assay, true);
}

/**
 * Resets a single field to its default value for the active assay.
 */
export function resetFieldToDefault(field) {
  const assay = S.selectedAssay || "DIVA";
  const defs = DEFAULT_PRESETS[assay];
  if (!defs) return;

  const input = $(field);
  if (input) {
    input.value = defs[field] !== undefined ? defs[field] : "";
    onFieldEdited(field);
    syncPainterFromInputs();
  }
}

/**
 * Selects an assay (SPCE, DIVA, Custom), loading saved edits or defaults.
 */
export function selectAssay(name, forceDefault = false) {
  setState("selectedAssay", name);

  // Update segmented control buttons
  ["spce", "diva", "custom"].forEach((opt) => {
    const btn = $(`btn-assay-${opt}`);
    const active = opt.toUpperCase() === name.toUpperCase();
    btn?.classList.toggle("active", active);
    btn?.setAttribute("aria-checked", active ? "true" : "false");
  });

  const posEl = $("pos");
  const negEl = $("neg");
  const blkEl = $("blank");
  const modeEl = $("mode");
  const cutoffEl = $("cutoff");
  const cutlowEl = $("cutlow");

  let valuesToApply = null;

  if (!forceDefault) {
    valuesToApply = getStoredEdits(name);
  }

  if (!valuesToApply) {
    if (name === "SPCE") {
      valuesToApply = { ...DEFAULT_PRESETS.SPCE };
    } else if (name === "DIVA") {
      valuesToApply = { ...DEFAULT_PRESETS.DIVA };
    } else {
      // Custom defaults to current values or DIVA base
      valuesToApply = {
        pos: posEl?.value || "H7-H8",
        neg: negEl?.value || "H9-H10",
        blank: blkEl?.value || "H11-H12",
        mode: modeEl?.value || "PP",
        cutoff: cutoffEl?.value || 40,
        cutlow: cutlowEl?.value || ""
      };
    }
  }

  if (posEl) posEl.value = valuesToApply.pos !== undefined ? valuesToApply.pos : "";
  if (negEl) negEl.value = valuesToApply.neg !== undefined ? valuesToApply.neg : "";
  if (blkEl) blkEl.value = valuesToApply.blank !== undefined ? valuesToApply.blank : "";
  if (cutoffEl) cutoffEl.value = valuesToApply.cutoff !== undefined ? valuesToApply.cutoff : "";
  if (cutlowEl) cutlowEl.value = valuesToApply.cutlow !== undefined ? valuesToApply.cutlow : "";

  if (modeEl) {
    if (name === "SPCE") {
      modeEl.value = "PI";
    } else if (name === "DIVA") {
      modeEl.value = "PP";
    } else {
      modeEl.value = valuesToApply.mode || "PP";
    }
    modeEl.disabled = false;
    modeEl.classList.remove("is-locked");
  }

  // Update Section 1 manual input controls and Section 2 labels
  const spceBox = $("spce-controls-wrap");
  const divaBox = $("diva-controls-wrap");
  const lblPos = $("lbl-pos");
  const hintPos = $("hint-pos");
  const lblNeg = $("lbl-neg");
  const hintNeg = $("hint-neg");
  const lblBlank = $("lbl-blank");
  const hintBlank = $("hint-blank");

  if (name === "SPCE") {
    if (spceBox) spceBox.hidden = false;
    if (divaBox) divaBox.hidden = true;

    // Populate Section 1 SPCE inputs
    const spceAntigen = $("spce-antigen");
    const spceBlank = $("spce-blank");
    const spcePos = $("spce-pos");
    const spceCutoff = $("spce-cutoff");
    if (spceAntigen) spceAntigen.value = valuesToApply.neg !== undefined ? valuesToApply.neg : "A1-D1";
    if (spceBlank) spceBlank.value = valuesToApply.blank !== undefined ? valuesToApply.blank : "E1-F1";
    if (spcePos) spcePos.value = valuesToApply.pos !== undefined ? valuesToApply.pos : "";
    if (spceCutoff) spceCutoff.value = valuesToApply.cutoff !== undefined ? valuesToApply.cutoff : 65.0;

    // Update Section 2 labels
    if (lblNeg) lblNeg.textContent = "Antigen (max-signal) control wells";
    if (hintNeg) hintNeg.textContent = "Antigen (max-signal) wells in SPCE · Default: A1-D1";
    if (lblPos) lblPos.textContent = "Positive control wells (optional)";
    if (hintPos) hintPos.textContent = "Optional reference wells for SPCE (competitive assay)";
    if (lblBlank) lblBlank.textContent = "Blank wells";
    if (hintBlank) hintBlank.textContent = "Substrate blank wells · Default: E1-F1";
  } else {
    // DIVA or Custom
    if (spceBox) spceBox.hidden = true;
    if (divaBox) divaBox.hidden = false;

    // Populate Section 1 DIVA inputs
    const divaPos = $("diva-pos");
    const divaNeg = $("diva-neg");
    const divaBlank = $("diva-blank");
    const divaCutoff = $("diva-cutoff");
    if (divaPos) divaPos.value = valuesToApply.pos !== undefined ? valuesToApply.pos : "H7-H8";
    if (divaNeg) divaNeg.value = valuesToApply.neg !== undefined ? valuesToApply.neg : "H9-H10";
    if (divaBlank) divaBlank.value = valuesToApply.blank !== undefined ? valuesToApply.blank : "H11-H12";
    if (divaCutoff) divaCutoff.value = valuesToApply.cutoff !== undefined ? valuesToApply.cutoff : 40.0;

    // Update Section 2 labels
    if (lblPos) lblPos.textContent = "Positive control wells";
    if (hintPos) hintPos.textContent = "High OD reference wells (PP mode) · Default: H7-H8";
    if (lblNeg) lblNeg.textContent = "Negative control wells";
    if (hintNeg) hintNeg.textContent = "Negative serum in DIVA · Default: H9-H10";
    if (lblBlank) lblBlank.textContent = "Blank wells (substrate only / empty)";
    if (hintBlank) hintBlank.textContent = "Substrate reference wells for optical baseline · Default: H11-H12";
  }

  setEditValues(true);

  updateAssayDescription();
  updateModifiedMarkers();
  syncPainterFromInputs();
  updateStepperValidation();
}

/**
 * Called whenever a field is edited by the user (typing or painting).
 */
export function onFieldEdited(field) {
  const assay = S.selectedAssay || "DIVA";

  // Two-way synchronization between Section 1 (Assay preset panel) and Section 2 (Well roles panel)
  if (assay === "SPCE") {
    if (field === "spce-antigen" && $("neg") && $("spce-antigen")) {
      $("neg").value = $("spce-antigen").value;
    } else if (field === "spce-blank" && $("blank") && $("spce-blank")) {
      $("blank").value = $("spce-blank").value;
    } else if (field === "spce-pos" && $("pos") && $("spce-pos")) {
      $("pos").value = $("spce-pos").value;
    } else if (field === "spce-cutoff" && $("cutoff") && $("spce-cutoff")) {
      $("cutoff").value = $("spce-cutoff").value;
    } else {
      // Section 2 changed, sync back to Section 1 SPCE inputs
      if ($("spce-antigen") && $("neg")) $("spce-antigen").value = $("neg").value;
      if ($("spce-blank") && $("blank")) $("spce-blank").value = $("blank").value;
      if ($("spce-pos") && $("pos")) $("spce-pos").value = $("pos").value;
      if ($("spce-cutoff") && $("cutoff")) $("spce-cutoff").value = $("cutoff").value;
    }
  } else {
    // DIVA or Custom
    if (field === "diva-pos" && $("pos") && $("diva-pos")) {
      $("pos").value = $("diva-pos").value;
    } else if (field === "diva-neg" && $("neg") && $("diva-neg")) {
      $("neg").value = $("diva-neg").value;
    } else if (field === "diva-blank" && $("blank") && $("diva-blank")) {
      $("blank").value = $("diva-blank").value;
    } else if (field === "diva-cutoff" && $("cutoff") && $("diva-cutoff")) {
      $("cutoff").value = $("diva-cutoff").value;
    } else {
      // Section 2 changed, sync back to Section 1 DIVA inputs
      if ($("diva-pos") && $("pos")) $("diva-pos").value = $("pos").value;
      if ($("diva-neg") && $("neg")) $("diva-neg").value = $("neg").value;
      if ($("diva-blank") && $("blank")) $("diva-blank").value = $("blank").value;
      if ($("diva-cutoff") && $("cutoff")) $("diva-cutoff").value = $("cutoff").value;
    }
  }

  const currentValues = {
    pos: $("pos")?.value.trim() || "",
    neg: $("neg")?.value.trim() || "",
    blank: $("blank")?.value.trim() || "",
    cutoff: $("cutoff")?.value.trim() || "",
    cutlow: $("cutlow")?.value.trim() || "",
    mode: $("mode")?.value || (assay === "SPCE" ? "PI" : "PP")
  };

  // Check if all values match defaults
  const defs = DEFAULT_PRESETS[assay];
  let matchesDefaults = false;
  if (defs && assay !== "Custom") {
    matchesDefaults =
      currentValues.pos === String(defs.pos || "") &&
      currentValues.neg === String(defs.neg || "") &&
      currentValues.blank === String(defs.blank || "") &&
      currentValues.cutoff === String(defs.cutoff || "") &&
      currentValues.cutlow === String(defs.cutlow || "");
  }

  if (matchesDefaults) {
    setStoredEdits(assay, null);
  } else {
    setStoredEdits(assay, currentValues);
  }

  updateModifiedMarkers();
  updateAssayDescription();
  updateStepperValidation();
}

/**
 * Legacy well edit trigger for backward compatibility with painter.js.
 */
export function onWellEdit() {
  onFieldEdited("painter");
}

export async function initPresets() {
  const btnSpce = $("btn-assay-spce");
  if (btnSpce) btnSpce.onclick = () => selectAssay("SPCE");

  const btnDiva = $("btn-assay-diva");
  if (btnDiva) btnDiva.onclick = () => selectAssay("DIVA");

  const btnCustom = $("btn-assay-custom");
  if (btnCustom) btnCustom.onclick = () => selectAssay("Custom");

  const chkEdit = $("chk-edit-values");
  if (chkEdit) {
    chkEdit.onchange = (e) => {
      setEditValues(e.target.checked);
    };
  }

  const btnReset = $("btn-reset-assay-defaults");
  if (btnReset) {
    btnReset.onclick = () => resetAssayToDefaults();
  }

  // Per-field reset buttons
  ["pos", "neg", "blank", "cutoff", "cutlow"].forEach((field) => {
    const btn = $(`reset-field-${field}`);
    if (btn) {
      btn.onclick = (e) => {
        e.preventDefault();
        resetFieldToDefault(field);
      };
    }
  });

  // Track edits on Section 2 inputs
  ["pos", "neg", "blank", "cutoff", "cutlow", "mode"].forEach((id) => {
    const el = $(id);
    if (el) {
      el.addEventListener("input", () => onFieldEdited(id));
      el.addEventListener("change", () => onFieldEdited(id));
    }
  });

  // Track edits on Section 1 SPCE & DIVA manual inputs
  const manualAssayFields = [
    "spce-antigen", "spce-blank", "spce-pos", "spce-cutoff",
    "diva-pos", "diva-neg", "diva-blank", "diva-cutoff"
  ];
  manualAssayFields.forEach((id) => {
    const el = $(id);
    if (el) {
      const handler = () => {
        onFieldEdited(id);
        syncPainterFromInputs();
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    }
  });

  // Quick preset buttons in informational section
  document.querySelectorAll(".preset-act-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const assay = btn.getAttribute("data-preset");
      const analyzer = document.getElementById("analyzer");
      if (analyzer) {
        analyzer.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (S.dataUrl && S.presets) {
        selectAssay(assay);
      } else {
        window.pendingAssay = assay;
        const ph = $("ph");
        if (ph) {
          ph.style.borderColor = "var(--amber-primary)";
          ph.style.boxShadow = "0 0 16px rgba(245, 165, 36, 0.4)";
          setTimeout(() => {
            ph.style.borderColor = "";
            ph.style.boxShadow = "";
          }, 2500);
        }
      }
    });
  });

  try {
    const data = await fetchPresets();
    if (data && typeof data === "object") {
      S.presets = data;
      // Sync default presets if backend provided them
      if (data.SPCE) DEFAULT_PRESETS.SPCE = { ...DEFAULT_PRESETS.SPCE, ...data.SPCE };
      if (data.DIVA) DEFAULT_PRESETS.DIVA = { ...DEFAULT_PRESETS.DIVA, ...data.DIVA };
    }
    const initialAssay = window.pendingAssay || "DIVA";
    selectAssay(initialAssay);
  } catch (err) {
    console.warn("Could not fetch presets from API, using defaults:", err);
    selectAssay("DIVA");
  }
}
