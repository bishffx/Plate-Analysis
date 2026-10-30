"use strict";

/**
 * PlateOD Well-Role Painter Module (painter.js)
 * 
 * Interactive 8x12 mini plate grid allowing click/drag painting of well roles
 * (Positive, Negative, Blank, Clear). Provides real-time two-way synchronization
 * between the visual painter and the text input fields (#pos, #neg, #blank).
 */

import { $, $$ } from "./dom.js";
import { S } from "./state.js";
import { updateStepperValidation } from "./validation.js";

let activeRole = "pos"; // 'pos' | 'neg' | 'blank' | 'sample'
let isPointerDown = false;
const wellRoles = new Map(); // 'A1' => 'pos' | 'neg' | 'blank' | 'sample'

export function initWellPainter() {
  const gridEl = $("painter-grid");
  if (!gridEl) return;

  buildGridDOM(gridEl);
  initPaletteButtons();
  initGridPointerEvents(gridEl);
  initTextInputsSync();
  syncPainterFromInputs();
}

function buildGridDOM(gridEl) {
  gridEl.innerHTML = "";
  const rows = 8;
  const cols = 12;
  const rowLetters = "ABCDEFGH";

  // Create column headers (1..12)
  const headerRow = document.createElement("div");
  headerRow.className = "painter-row painter-header-row";
  
  const cornerSpacer = document.createElement("div");
  cornerSpacer.className = "painter-cell-header";
  headerRow.appendChild(cornerSpacer);

  for (let c = 1; c <= cols; c++) {
    const colH = document.createElement("div");
    colH.className = "painter-cell-header";
    colH.textContent = String(c);
    headerRow.appendChild(colH);
  }
  gridEl.appendChild(headerRow);

  // Create 8 rows of well buttons
  for (let r = 0; r < rows; r++) {
    const rowEl = document.createElement("div");
    rowEl.className = "painter-row";

    // Row header (A..H)
    const rowH = document.createElement("div");
    rowH.className = "painter-cell-header painter-row-header";
    rowH.textContent = rowLetters[r];
    rowEl.appendChild(rowH);

    for (let c = 1; c <= cols; c++) {
      const wellId = `${rowLetters[r]}${c}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "painter-well role-sample";
      btn.setAttribute("data-well", wellId);
      btn.setAttribute("data-role", "sample");
      btn.setAttribute("aria-label", `Well ${wellId}`);
      btn.title = `Well ${wellId}`;
      rowEl.appendChild(btn);
    }

    gridEl.appendChild(rowEl);
  }
}

function initPaletteButtons() {
  const paletteBtns = $$(".painter-palette .palette-btn");
  paletteBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      paletteBtns.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-checked", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-checked", "true");
      activeRole = btn.getAttribute("data-role") || "pos";
    });
  });

  const clearAllBtn = $("btn-clear-all-roles");
  if (clearAllBtn) {
    clearAllBtn.addEventListener("click", () => {
      wellRoles.clear();
      $$(".painter-well").forEach((w) => {
        w.setAttribute("data-role", "sample");
        w.className = "painter-well role-sample";
      });
      syncInputsFromPainter();
    });
  }
}

function initGridPointerEvents(gridEl) {
  const paintWell = (wellEl) => {
    if (!wellEl || !wellEl.hasAttribute("data-well")) return;
    const wellId = wellEl.getAttribute("data-well");
    wellRoles.set(wellId, activeRole);

    wellEl.setAttribute("data-role", activeRole);
    wellEl.className = `painter-well role-${activeRole}`;
  };

  gridEl.addEventListener("pointerdown", (e) => {
    const wellEl = e.target.closest(".painter-well");
    if (!wellEl) return;
    e.preventDefault();
    isPointerDown = true;
    gridEl.setPointerCapture(e.pointerId);
    paintWell(wellEl);
  });

  gridEl.addEventListener("pointermove", (e) => {
    if (!isPointerDown) return;
    // Get element under pointer even while captured
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    const wellEl = elUnder ? elUnder.closest(".painter-well") : null;
    if (wellEl) {
      paintWell(wellEl);
    }
  });

  const onPointerUp = (e) => {
    if (isPointerDown) {
      isPointerDown = false;
      try {
        gridEl.releasePointerCapture(e.pointerId);
      } catch (_) {}
      syncInputsFromPainter();
    }
  };

  gridEl.addEventListener("pointerup", onPointerUp);
  gridEl.addEventListener("pointercancel", onPointerUp);

  // Keyboard support: Space / Enter on focused well toggles active role
  gridEl.addEventListener("keydown", (e) => {
    const wellEl = e.target.closest(".painter-well");
    if (!wellEl) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      paintWell(wellEl);
      syncInputsFromPainter();
    }
  });
}

function initTextInputsSync() {
  const posInput = $("pos");
  const negInput = $("neg");
  const blankInput = $("blank");

  const onInputChange = () => {
    syncPainterFromInputs();
  };

  [posInput, negInput, blankInput].forEach((inp) => {
    if (inp) {
      inp.addEventListener("input", onInputChange);
      inp.addEventListener("change", onInputChange);
    }
  });
}

/**
 * Parses well text field (e.g. "A1-D1, E1") into an array of well IDs ["A1", "B1", "C1", "D1", "E1"]
 */
export function parseWellString(str) {
  if (!str) return [];
  const results = [];
  const tokens = str.split(",");

  for (const rawToken of tokens) {
    const token = rawToken.trim().toUpperCase();
    if (!token) continue;

    if (token.includes("-")) {
      const [start, end] = token.split("-").map((s) => s.trim());
      const m1 = start.match(/^([A-P])([1-9]|1[0-9]|2[0-4])$/);
      const m2 = end.match(/^([A-P])([1-9]|1[0-9]|2[0-4])$/);
      if (!m1 || !m2) continue;

      const r1 = m1[1].charCodeAt(0) - 65;
      const c1 = parseInt(m1[2], 10);
      const r2 = m2[1].charCodeAt(0) - 65;
      const c2 = parseInt(m2[2], 10);

      const minR = Math.min(r1, r2);
      const maxR = Math.max(r1, r2);
      const minC = Math.min(c1, c2);
      const maxC = Math.max(c1, c2);

      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          results.push(`${String.fromCharCode(65 + r)}${c}`);
        }
      }
    } else {
      const m = token.match(/^([A-P])([1-9]|1[0-9]|2[0-4])$/);
      if (m) results.push(token);
    }
  }

  return results;
}

/**
 * Formats a list of well IDs into concise range strings where possible (e.g. "A1-D1, E1-F1")
 */
function formatWellList(wells) {
  if (!wells || wells.length === 0) return "";
  // Sort wells primarily by column, then row (standard ELISA strip format)
  const sorted = [...new Set(wells)].sort((a, b) => {
    const rA = a.charCodeAt(0) - 65;
    const cA = parseInt(a.slice(1), 10);
    const rB = b.charCodeAt(0) - 65;
    const cB = parseInt(b.slice(1), 10);
    return cA !== cB ? cA - cB : rA - rB;
  });

  const ranges = [];
  let currentRange = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const prevR = prev.charCodeAt(0) - 65;
    const prevC = parseInt(prev.slice(1), 10);
    const currR = curr.charCodeAt(0) - 65;
    const currC = parseInt(curr.slice(1), 10);

    // Contiguous along column (e.g. A1, B1, C1)
    if (currC === prevC && currR === prevR + 1) {
      currentRange.push(curr);
    } else {
      ranges.push(currentRange);
      currentRange = [curr];
    }
  }
  if (currentRange.length > 0) {
    ranges.push(currentRange);
  }

  return ranges
    .map((r) => (r.length === 1 ? r[0] : `${r[0]}-${r[r.length - 1]}`))
    .join(", ");
}

export function syncInputsFromPainter() {
  const posWells = [];
  const negWells = [];
  const blankWells = [];

  wellRoles.forEach((role, wellId) => {
    if (role === "pos") posWells.push(wellId);
    else if (role === "neg") negWells.push(wellId);
    else if (role === "blank") blankWells.push(wellId);
  });

  const posInput = $("pos");
  const negInput = $("neg");
  const blankInput = $("blank");

  if (posInput) posInput.value = formatWellList(posWells);
  if (negInput) negInput.value = formatWellList(negWells);
  if (blankInput) blankInput.value = formatWellList(blankWells);

  // Trigger input events to notify validation & live preview
  [posInput, negInput, blankInput].forEach((inp) => {
    if (inp) {
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  updateStepperValidation();
}

export function syncPainterFromInputs() {
  const posWells = new Set(parseWellString($("pos")?.value || ""));
  const negWells = new Set(parseWellString($("neg")?.value || ""));
  const blankWells = new Set(parseWellString($("blank")?.value || ""));

  wellRoles.clear();

  $$(".painter-well").forEach((btn) => {
    const wellId = btn.getAttribute("data-well");
    let role = "sample";

    if (posWells.has(wellId)) role = "pos";
    else if (negWells.has(wellId)) role = "neg";
    else if (blankWells.has(wellId)) role = "blank";

    wellRoles.set(wellId, role);
    btn.setAttribute("data-role", role);
    btn.className = `painter-well role-${role}`;
  });
}
