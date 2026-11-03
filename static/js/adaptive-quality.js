"use strict";

/**
 * PlateOD Adaptive Visual Quality System (adaptive-quality.js)
 * 
 * Manages rendering tiers: Auto, High, Medium, Low, Off.
 * - Auto monitors frame times; if average frame time > 22ms, drops tier:
 *   High -> Medium (half particles, DPR 1, static cards) -> Low (static poster, no particles)
 *   and never steps up automatically.
 * - Saves mode in localStorage (inside try/catch).
 * - Dispatches 'plateod:quality' event when tier changes.
 */

let userPreference = "Auto"; // 'Auto' | 'High' | 'Medium' | 'Low' | 'Off'
let activeTier = "High";     // 'High' | 'Medium' | 'Low' | 'Off'

// Frame time monitoring for Auto mode
const frameSamples = [];
const SAMPLE_WINDOW = 60;
let autoDowngradedToMedium = false;
let autoDowngradedToLow = false;

// Safe localStorage access
export function getSavedQuality() {
  try {
    return localStorage.getItem("plateod_visual_quality") || "Auto";
  } catch (_) {
    return "Auto";
  }
}

export function saveQuality(mode) {
  try {
    localStorage.setItem("plateod_visual_quality", mode);
  } catch (_) {}
}

export function getQualityState() {
  return {
    mode: userPreference,
    tier: activeTier,
    dprCap: activeTier === "High" ? 1.5 : 1.0,
    particlesCount: activeTier === "High" ? 120 : (activeTier === "Medium" ? 60 : 0),
    isStatic: activeTier === "Low" || activeTier === "Off",
    isOff: activeTier === "Off"
  };
}

export function setQuality(mode) {
  userPreference = mode;
  saveQuality(mode);

  if (mode === "Auto") {
    // Reset auto downgrade tracking on explicit Auto selection
    autoDowngradedToMedium = false;
    autoDowngradedToLow = false;
    frameSamples.length = 0;
    activeTier = "High";
  } else {
    activeTier = mode;
  }

  notifyQualityChanged();
  updateQualityUI();
}

/**
 * Record a frame delta (in ms) from the shared rAF loop.
 * If average > 22ms in Auto mode, drops a tier. Never steps up automatically.
 */
export function recordFrameTime(deltaMs) {
  if (userPreference !== "Auto" || activeTier === "Low" || activeTier === "Off") return;

  frameSamples.push(deltaMs);
  if (frameSamples.length > SAMPLE_WINDOW) {
    frameSamples.shift();
  }

  if (frameSamples.length >= 30) {
    const sum = frameSamples.reduce((a, b) => a + b, 0);
    const avg = sum / frameSamples.length;

    if (avg > 22.0) {
      if (activeTier === "High" && !autoDowngradedToMedium) {
        console.warn(`[Adaptive Quality] Avg frame time ${avg.toFixed(1)}ms > 22ms. Dropping to Medium.`);
        autoDowngradedToMedium = true;
        activeTier = "Medium";
        frameSamples.length = 0;
        notifyQualityChanged();
        updateQualityUI();
      } else if (activeTier === "Medium" && !autoDowngradedToLow) {
        console.warn(`[Adaptive Quality] Avg frame time ${avg.toFixed(1)}ms > 22ms. Dropping to Low.`);
        autoDowngradedToLow = true;
        activeTier = "Low";
        frameSamples.length = 0;
        notifyQualityChanged();
        updateQualityUI();
      }
    }
  }
}

function notifyQualityChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("plateod:quality", {
      detail: getQualityState()
    }));
  }
}

function updateQualityUI() {
  if (typeof document === "undefined") return;
  const buttons = document.querySelectorAll(".quality-btn");
  buttons.forEach((btn) => {
    const q = btn.getAttribute("data-quality");
    const isActive = (q === userPreference);
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });

  const tierIndicator = document.getElementById("quality-active-tier");
  if (tierIndicator) {
    tierIndicator.textContent = userPreference === "Auto" ? `Auto (${activeTier})` : userPreference;
  }
}

export function initQualityUI() {
  const saved = getSavedQuality();
  setQuality(saved);

  // Bind footer buttons if present
  document.querySelectorAll(".quality-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = btn.getAttribute("data-quality");
      if (q) setQuality(q);
    });
  });
}
