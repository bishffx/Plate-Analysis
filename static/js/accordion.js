"use strict";

/**
 * PlateOD Accessible Accordion Module (accordion.js)
 * 
 * Manages the collapsible left analysis parameters panel:
 * - ARIA accordion button & panel relationships (aria-expanded, aria-controls)
 * - Single-open default behavior with "Expand all / Collapse all" toggle
 * - Inactive content is made inert to prevent keyboard focus when collapsed
 * - Keyboard navigation (Enter, Space, ArrowUp, ArrowDown, Home, End)
 * - Live status chips on headers (Assay, Image, Roles, Measurement, Calibration)
 * - Sticky bottom summary line (assay, channel, wells set)
 * - Auto-expansion, scrolling, and error highlighting on validation failure
 */

import { $, $$ } from "./dom.js";
import { S } from "./state.js";
import { validateWellField } from "./validation.js";

let isReducedMotion = false;

export function countAssignedWells() {
  const posVal = $("pos")?.value || "";
  const negVal = $("neg")?.value || "";
  const blkVal = $("blank")?.value || "";

  function countFromTokens(str) {
    if (!str.trim()) return 0;
    const tokens = str.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
    let count = 0;
    for (const t of tokens) {
      if (t.includes("-")) {
        const parts = t.split("-");
        if (parts.length === 2) {
          const m1 = parts[0].trim().match(/^([A-Za-z])([0-9]+)$/);
          const m2 = parts[1].trim().match(/^([A-Za-z])([0-9]+)$/);
          if (m1 && m2) {
            const r1 = m1[1].toUpperCase().charCodeAt(0) - 65;
            const r2 = m2[1].toUpperCase().charCodeAt(0) - 65;
            const c1 = parseInt(m1[2], 10);
            const c2 = parseInt(m2[2], 10);
            const minR = Math.min(r1, r2);
            const maxR = Math.max(r1, r2);
            const minC = Math.min(c1, c2);
            const maxC = Math.max(c1, c2);
            count += (maxR - minR + 1) * (maxC - minC + 1);
            continue;
          }
        }
      }
      count++;
    }
    return count;
  }

  return countFromTokens(posVal) + countFromTokens(negVal) + countFromTokens(blkVal);
}

export function updateAccordionStatusChips() {
  // 1. Assay type chip
  const chipAssay = $("chip-status-assay");
  if (chipAssay) {
    const isCustom = S.isCustomised || (S.selectedAssay === "Custom");
    const assayName = S.selectedAssay || "DIVA";
    chipAssay.textContent = isCustom ? (S.selectedAssay === "Custom" ? "Custom" : `${assayName} (Custom)`) : assayName;
    chipAssay.classList.toggle("is-active", Boolean(S.selectedAssay));
  }

  // 2. Plate and image chip
  const chipPlate = $("chip-status-plate");
  if (chipPlate) {
    if (S.img) {
      const w = S.img.naturalWidth || S.img.width || 0;
      const h = S.img.naturalHeight || S.img.height || 0;
      chipPlate.textContent = w && h ? `${w}×${h} px` : "Image loaded";
      chipPlate.classList.add("is-active");
    } else {
      chipPlate.textContent = "No photo";
      chipPlate.classList.remove("is-active");
    }
  }

  // 3. Well roles chip
  const chipRoles = $("chip-status-roles");
  if (chipRoles) {
    const count = countAssignedWells();
    chipRoles.textContent = `${count} well${count === 1 ? "" : "s"} set`;
    chipRoles.classList.toggle("is-active", count > 0);
  }

  // 4. Measurement chip
  const chipMeasure = $("chip-status-measure");
  if (chipMeasure) {
    const ch = $("channel")?.value || "AUTO";
    const mode = $("mode")?.value || "PP";
    const chLabels = {
      AUTO: "Auto (492nm)",
      B: "Blue (492nm)",
      G: "Green (492nm)",
      CYAN: "Cyan signal (492nm)",
      GRAY: "Luminance (492nm)",
      R: "Red (492nm)"
    };
    chipMeasure.textContent = chLabels[ch] || `${ch} (492nm)`;
    chipMeasure.classList.add("is-active");
  }

  // 5. Calibration chip
  const chipCal = $("chip-status-cal");
  if (chipCal) {
    const model = S.calMode || $("cal-model")?.value || "linear";
    chipCal.textContent = model === "quadratic" ? "Quadratic" : "Linear";
    chipCal.classList.toggle("is-active", model === "quadratic" || $("chk-use-reader")?.checked);
  }

  // Update sticky run summary line
  updateRunSummaryLine();
}

export function updateRunSummaryLine() {
  const lineAssay = $("run-summary-assay");
  const lineChannel = $("run-summary-channel");
  const lineWells = $("run-summary-wells");

  const assay = S.selectedAssay || "SPCE";
  const ch = $("channel")?.value || "AUTO";
  const chNames = {
    AUTO: "Auto (492nm)",
    B: "Blue (492nm)",
    G: "Green (492nm)",
    CYAN: "Cyan signal (492nm)",
    GRAY: "Luminance (492nm)",
    R: "Red (492nm)"
  };
  const channelText = chNames[ch] || ch;
  const count = countAssignedWells();

  if (lineAssay) lineAssay.textContent = assay;
  if (lineChannel) lineChannel.textContent = channelText;
  if (lineWells) lineWells.textContent = `${count} wells set`;
}

export function openSection(cardEl) {
  if (!cardEl) return;
  const trigger = cardEl.querySelector(".accordion-trigger");
  const panel = cardEl.querySelector(".accordion-panel");

  cardEl.classList.add("is-open");
  if (trigger) trigger.setAttribute("aria-expanded", "true");
  if (panel) {
    panel.classList.add("is-open");
    panel.removeAttribute("inert");
  }
  updateToggleAllButtonText();
  if (typeof window !== "undefined" && window.updateWorkspaceScroll) {
    window.updateWorkspaceScroll();
  }
}

export function closeSection(cardEl) {
  if (!cardEl) return;
  const trigger = cardEl.querySelector(".accordion-trigger");
  const panel = cardEl.querySelector(".accordion-panel");

  cardEl.classList.remove("is-open");
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  if (panel) {
    panel.classList.remove("is-open");
    panel.setAttribute("inert", "");
  }
  updateToggleAllButtonText();
  if (typeof window !== "undefined" && window.updateWorkspaceScroll) {
    window.updateWorkspaceScroll();
  }
}

export function toggleSection(cardEl, singleMode = true) {
  if (!cardEl) return;
  const isOpen = cardEl.classList.contains("is-open");

  if (isOpen) {
    closeSection(cardEl);
  } else {
    if (singleMode) {
      // Close all other accordion cards
      const allCards = $$(".accordion-card");
      allCards.forEach((c) => {
        if (c !== cardEl && c.classList.contains("is-open")) {
          closeSection(c);
        }
      });
    }
    openSection(cardEl);
  }
}

export function ensureSectionOpenForElement(targetEl) {
  if (!targetEl) return;
  const card = targetEl.closest(".accordion-card");
  if (card) {
    // If hidden (e.g. card-assay), unhide it
    if (card.hidden) card.hidden = false;
    openSection(card);
  }

  targetEl.scrollIntoView({ behavior: isReducedMotion ? "auto" : "smooth", block: "center" });
  try {
    targetEl.focus({ preventScroll: true });
  } catch (e) {}

  // Highlight element with shake pulse
  targetEl.classList.add("field-highlight-error");
  const removeHighlight = () => {
    targetEl.classList.remove("field-highlight-error");
    targetEl.removeEventListener("input", removeHighlight);
    targetEl.removeEventListener("change", removeHighlight);
  };
  targetEl.addEventListener("input", removeHighlight);
  targetEl.addEventListener("change", removeHighlight);
  setTimeout(removeHighlight, 3000);
}

function updateToggleAllButtonText() {
  const btn = $("btn-accordion-toggle-all");
  const txt = $("txt-accordion-toggle-all");
  if (!btn || !txt) return;

  const visibleCards = Array.from($$(".accordion-card")).filter((c) => !c.hidden);
  const openCards = visibleCards.filter((c) => c.classList.contains("is-open"));

  if (openCards.length === visibleCards.length) {
    txt.textContent = "Collapse all";
    btn.setAttribute("aria-label", "Collapse all sections");
  } else {
    txt.textContent = "Expand all";
    btn.setAttribute("aria-label", "Expand all sections");
  }
}

export function initAccordion() {
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  isReducedMotion = mql.matches;
  mql.addEventListener("change", (e) => {
    isReducedMotion = e.matches;
  });

  const cards = $$(".accordion-card");
  cards.forEach((card) => {
    const trigger = card.querySelector(".accordion-trigger");
    const panel = card.querySelector(".accordion-panel");

    if (card.classList.contains("is-open")) {
      if (trigger) trigger.setAttribute("aria-expanded", "true");
      if (panel) {
        panel.classList.add("is-open");
        panel.removeAttribute("inert");
      }
    } else {
      if (trigger) trigger.setAttribute("aria-expanded", "false");
      if (panel) {
        panel.classList.remove("is-open");
        panel.setAttribute("inert", "");
      }
    }

    if (trigger) {
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        toggleSection(card, false);
      });

      trigger.addEventListener("keydown", (e) => {
        handleHeaderKeydown(e);
      });
    }
  });

  // Expand all / Collapse all toggle link
  const btnToggleAll = $("btn-accordion-toggle-all");
  if (btnToggleAll) {
    btnToggleAll.addEventListener("click", () => {
      const visibleCards = Array.from($$(".accordion-card")).filter((c) => !c.hidden);
      const allOpen = visibleCards.every((c) => c.classList.contains("is-open"));

      visibleCards.forEach((c) => {
        if (allOpen) {
          closeSection(c);
        } else {
          openSection(c);
        }
      });
    });
  }

  // Bind input listeners for live status chip updates
  const chipSyncInputs = [
    "rows", "cols", "radius", "pos", "neg", "blank",
    "channel", "mode", "cutoff", "cutlow", "slope", "icpt",
    "cal-model", "chk-use-reader"
  ];
  chipSyncInputs.forEach((id) => {
    $(id)?.addEventListener("input", updateAccordionStatusChips);
    $(id)?.addEventListener("change", updateAccordionStatusChips);
  });

  // Also hook preset selection buttons to refresh status chips
  $("btn-assay-spce")?.addEventListener("click", () => setTimeout(updateAccordionStatusChips, 20));
  $("btn-assay-diva")?.addEventListener("click", () => setTimeout(updateAccordionStatusChips, 20));
  $("btn-assay-custom")?.addEventListener("click", () => setTimeout(updateAccordionStatusChips, 20));
  $("btn-cal-linear")?.addEventListener("click", () => setTimeout(updateAccordionStatusChips, 20));
  $("btn-cal-quad")?.addEventListener("click", () => setTimeout(updateAccordionStatusChips, 20));

  // Initial chip & run summary refresh
  updateAccordionStatusChips();
}

function handleHeaderKeydown(e) {
  const visibleTriggers = Array.from(document.querySelectorAll(".accordion-card:not([hidden]) .accordion-trigger"));
  const currentIndex = visibleTriggers.indexOf(e.currentTarget);
  if (currentIndex === -1) return;

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      visibleTriggers[(currentIndex + 1) % visibleTriggers.length].focus();
      break;
    case "ArrowUp":
      e.preventDefault();
      visibleTriggers[(currentIndex - 1 + visibleTriggers.length) % visibleTriggers.length].focus();
      break;
    case "Home":
      e.preventDefault();
      visibleTriggers[0].focus();
      break;
    case "End":
      e.preventDefault();
      visibleTriggers[visibleTriggers.length - 1].focus();
      break;
  }
}
