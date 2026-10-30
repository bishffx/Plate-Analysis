"use strict";

/**
 * PlateOD Presets Module (presets.js)
 * 
 * Manages assay presets (DIVA, SPCE, Custom), form binding,
 * and informational section quick-select buttons.
 */

import { S, setState } from "./state.js";
import { $ } from "./dom.js";
import { fetchPresets } from "./api.js";
import { updateStepperValidation } from "./validation.js";
import { syncPainterFromInputs } from "./painter.js";

export function selectAssay(name) {
  if (!S.presets || !S.presets[name]) return;
  setState("selectedAssay", name);
  S.isCustomised = false;
  const p = S.presets[name];

  const btnSpce = $("btn-assay-spce");
  const btnDiva = $("btn-assay-diva");
  if (name === "SPCE") {
    btnSpce?.classList.add("active");
    btnSpce?.setAttribute("aria-checked", "true");
    btnDiva?.classList.remove("active");
    btnDiva?.setAttribute("aria-checked", "false");
  } else {
    btnDiva?.classList.add("active");
    btnDiva?.setAttribute("aria-checked", "true");
    btnSpce?.classList.remove("active");
    btnSpce?.setAttribute("aria-checked", "false");
  }

  const customBadge = $("badge-customised");
  if (customBadge) customBadge.hidden = true;
  const customCheck = $("customise-wells");
  if (customCheck) customCheck.checked = false;

  const posEl = $("pos");
  const negEl = $("neg");
  const blkEl = $("blank");
  const modeEl = $("mode");
  const cutoffEl = $("cutoff");
  const posWrap = $("pos-wrap");

  if (posEl) posEl.value = p.pos || "";
  if (negEl) negEl.value = p.neg || "";
  if (blkEl) blkEl.value = p.blank || "";
  if (modeEl) {
    modeEl.value = p.mode;
    modeEl.disabled = true;
  }
  if (cutoffEl) cutoffEl.value = p.cutoff;

  if (posWrap) {
    posWrap.hidden = (name === "SPCE");
  }

  const info = $("assay-info");
  if (info) {
    info.hidden = false;
    info.textContent = name === "SPCE"
      ? `${p.neg} = antigen (max-signal) wells, ${p.blank} = blank. Competitive assay, result is % inhibition (PI).`
      : `${p.pos} = positive control, ${p.neg} = negative control, ${p.blank} = blank. Result is percentage positivity (PP).`;
  }

  const runBtn = $("run");
  if (runBtn && S.img) runBtn.disabled = false;
  syncPainterFromInputs();
  updateStepperValidation();
}

export function onWellEdit() {
  S.isCustomised = true;
  const customBadge = $("badge-customised");
  if (customBadge) customBadge.hidden = false;
  const customCheck = $("customise-wells");
  if (customCheck) customCheck.checked = true;

  const posEl = $("pos");
  const posWrap = $("pos-wrap");
  if (posEl && posWrap && posEl.value.trim() && S.selectedAssay === "SPCE") {
    posWrap.hidden = false;
  }
  updateStepperValidation();
}

export async function initPresets() {
  const btnSpce = $("btn-assay-spce");
  if (btnSpce) btnSpce.onclick = () => selectAssay("SPCE");

  const btnDiva = $("btn-assay-diva");
  if (btnDiva) btnDiva.onclick = () => selectAssay("DIVA");

  const customCheck = $("customise-wells");
  if (customCheck) {
    customCheck.onchange = (e) => {
      const on = e.target.checked;
      S.isCustomised = on;
      const customBadge = $("badge-customised");
      if (customBadge) customBadge.hidden = !on;
      const posWrap = $("pos-wrap");
      if (on) {
        if (posWrap) posWrap.hidden = false;
      } else if (S.selectedAssay && S.presets && S.presets[S.selectedAssay]) {
        const p = S.presets[S.selectedAssay];
        if ($("pos")) $("pos").value = p.pos || "";
        if ($("neg")) $("neg").value = p.neg || "";
        if ($("blank")) $("blank").value = p.blank || "";
        if (posWrap && S.selectedAssay === "SPCE") posWrap.hidden = true;
        updateStepperValidation();
      }
    };
  }

  ["pos", "neg", "blank"].forEach((id) => {
    const elInput = $(id);
    if (elInput) {
      elInput.readOnly = false;
      elInput.addEventListener("input", onWellEdit);
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
    S.presets = data;
    if (window.pendingAssay && S.presets[window.pendingAssay]) {
      selectAssay(window.pendingAssay);
    } else {
      selectAssay("DIVA");
    }
  } catch (err) {
    console.error("Failed to load assay presets:", err);
  }
}
