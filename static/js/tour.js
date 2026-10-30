"use strict";

/**
 * PlateOD Onboarding Tour (tour.js)
 * 
 * 5-step interactive spotlight guided tour for first-time visitors:
 * 1. Upload photo
 * 2. Place grid
 * 3. Configure controls & assay
 * 4. Run analysis
 * 5. Explore results & QC
 * 
 * Skippable and remembered in localStorage inside safe try/catch.
 */

import { $, el, clearChildren } from "./dom.js";

const TOUR_STORAGE_KEY = "plateod_tour_completed";

const TOUR_STEPS = [
  {
    targetId: "dropzone",
    title: "1. Upload Plate Photo",
    content: "Drag & drop your 96-well microplate photo here or click to browse. Supports high-res JPG, PNG, and TIFF images.",
    position: "bottom"
  },
  {
    targetId: "cv-wrap",
    title: "2. Position Grid Corners",
    content: "Align the 4 handles onto corner wells (A1, A12, H12, H1) with magnetic snap, or click 'Auto-detect grid' for automatic fitting.",
    position: "top"
  },
  {
    targetId: "step-3",
    title: "3. Set Controls & Assay",
    content: "Choose SPCE (% inhibition) or DIVA (% positivity) presets, or use the interactive 8x12 Well Painter to customize your layout.",
    position: "left"
  },
  {
    targetId: "run",
    title: "4. Run Analysis",
    content: "Click Run (or press key 'R') to start reading wells with animated optical density scanning and blank-referencing.",
    position: "bottom"
  },
  {
    targetId: "step-4",
    title: "5. Explore Results & QC",
    content: "Check QC PASS/FAIL status, examine heatmap distributions, click any well to open the photographic inspector, and export CSV or PNG.",
    position: "top"
  }
];

let currentStep = 0;
let isTourActive = false;

export function initTour() {
  window.addEventListener("plateod:tour", () => startTour());

  // Check if first visit
  try {
    const completed = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!completed) {
      setTimeout(() => {
        if (!localStorage.getItem(TOUR_STORAGE_KEY) && !S.img) {
          // Polite welcoming toast with interactive invitation
          import("./dom.js").then((m) => {
            m.showToast("Welcome! Press ? for shortcuts or Ctrl+K for commands", "info", 5000);
          });
        }
      }, 1500);
    }
  } catch (err) {}
}

export function startTour() {
  currentStep = 0;
  isTourActive = true;

  let overlay = $("tour-overlay");
  if (!overlay) {
    overlay = createTourOverlay();
    document.body.appendChild(overlay);
  }

  overlay.hidden = false;
  overlay.classList.add("active");
  renderStep(currentStep);

  window.addEventListener("resize", handleTourReposition, { passive: true });
  window.addEventListener("keydown", handleTourKeydown);
}

export function endTour(markCompleted = true) {
  isTourActive = false;
  const overlay = $("tour-overlay");
  if (overlay) {
    overlay.classList.remove("active");
    setTimeout(() => { overlay.hidden = true; }, 200);
  }

  window.removeEventListener("resize", handleTourReposition);
  window.removeEventListener("keydown", handleTourKeydown);

  if (markCompleted) {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "true");
    } catch (err) {}
  }
}

function handleTourKeydown(e) {
  if (!isTourActive) return;
  if (e.key === "Escape") {
    endTour(true);
  } else if (e.key === "ArrowRight") {
    nextStep();
  } else if (e.key === "ArrowLeft") {
    prevStep();
  }
}

function handleTourReposition() {
  if (isTourActive) {
    renderStep(currentStep);
  }
}

function nextStep() {
  if (currentStep < TOUR_STEPS.length - 1) {
    currentStep++;
    renderStep(currentStep);
  } else {
    endTour(true);
  }
}

function prevStep() {
  if (currentStep > 0) {
    currentStep--;
    renderStep(currentStep);
  }
}

function createTourOverlay() {
  const overlay = el("div", undefined, "tour-overlay");
  overlay.id = "tour-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Onboarding Guide");

  const spotlight = el("div", undefined, "tour-spotlight");
  spotlight.id = "tour-spotlight";
  overlay.appendChild(spotlight);

  const card = el("div", undefined, "tour-card card");
  card.id = "tour-card";
  overlay.appendChild(card);

  return overlay;
}

function renderStep(idx) {
  const step = TOUR_STEPS[idx];
  if (!step) return;

  const target = $(step.targetId);
  const spotlight = $("tour-spotlight");
  const card = $("tour-card");

  if (!spotlight || !card) return;

  // Position spotlight
  if (target) {
    const rect = target.getBoundingClientRect();
    const pad = 8;
    spotlight.style.display = "block";
    spotlight.style.top = `${rect.top - pad + window.scrollY}px`;
    spotlight.style.left = `${rect.left - pad + window.scrollX}px`;
    spotlight.style.width = `${rect.width + pad * 2}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;

    // Scroll target into view if needed
    target.scrollIntoView({ behavior: "smooth", block: "center" });

    // Position tour card near target
    positionCard(card, rect);
  } else {
    // Center spotlight if target not found
    spotlight.style.display = "none";
    card.style.position = "fixed";
    card.style.top = "50%";
    card.style.left = "50%";
    card.style.transform = "translate(-50%, -50%)";
  }

  // Render card content
  clearChildren(card);

  const topRow = el("div", undefined, "tour-header-row");
  const stepBadge = el("span", `Step ${idx + 1} of ${TOUR_STEPS.length}`, "tour-step-badge");
  const skipBtn = el("button", "Skip", "btn btn-ghost btn-xs tour-skip-btn");
  skipBtn.addEventListener("click", () => endTour(true));
  topRow.appendChild(stepBadge);
  topRow.appendChild(skipBtn);
  card.appendChild(topRow);

  const title = el("h3", step.title, "tour-title");
  card.appendChild(title);

  const text = el("p", step.content, "tour-text");
  card.appendChild(text);

  const footer = el("div", undefined, "tour-footer-row");
  const leftGroup = el("div", undefined, "tour-dots-group");
  TOUR_STEPS.forEach((_, i) => {
    const dot = el("span", undefined, "tour-progress-dot" + (i === idx ? " active" : ""));
    leftGroup.appendChild(dot);
  });
  footer.appendChild(leftGroup);

  const rightGroup = el("div", undefined, "tour-btn-group");
  if (idx > 0) {
    const backBtn = el("button", "Back", "btn btn-secondary btn-sm");
    backBtn.addEventListener("click", () => prevStep());
    rightGroup.appendChild(backBtn);
  }

  const isLast = idx === TOUR_STEPS.length - 1;
  const nextBtn = el("button", isLast ? "Get Started" : "Next", "btn btn-primary btn-sm");
  nextBtn.addEventListener("click", () => nextStep());
  rightGroup.appendChild(nextBtn);

  footer.appendChild(rightGroup);
  card.appendChild(footer);
}

function positionCard(card, targetRect) {
  const cardW = 340;
  const pad = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = targetRect.left + (targetRect.width - cardW) / 2;
  left = Math.max(pad, Math.min(vw - cardW - pad, left));

  let top = targetRect.bottom + pad;
  // If overflows bottom, flip to above target
  if (top + 200 > vh) {
    top = Math.max(pad, targetRect.top - 200 - pad);
  }

  card.style.position = "absolute";
  card.style.top = `${top + window.scrollY}px`;
  card.style.left = `${left + window.scrollX}px`;
  card.style.transform = "none";
}
