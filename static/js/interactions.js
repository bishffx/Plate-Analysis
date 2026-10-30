"use strict";

/**
 * PlateOD Micro-interactions Module (interactions.js)
 * 
 * - Magnetic primary buttons
 * - Ripple on click
 * - Number inputs with press-and-hold steppers
 * - Morphing theme toggle (sun to moon)
 * - View Transitions API wrapper
 */

import { $, el } from "./dom.js";
import { getStoredTheme, setStoredTheme, applyTheme } from "./theme.js";

let isReducedMotion = false;

export function initMicroInteractions() {
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  isReducedMotion = mql.matches;
  mql.addEventListener("change", (e) => {
    isReducedMotion = e.matches;
  });

  initMagneticButtons();
  initClickRipples();
  initPressAndHoldSteppers();
  initMorphingThemeToggle();
}

/**
 * Magnetic button interaction: subtly pulls towards cursor.
 */
function initMagneticButtons() {
  if (isReducedMotion) return;

  const selector = ".btn-primary, #run, .hero-btn-primary, .magnetic-btn";
  const buttons = document.querySelectorAll(selector);

  buttons.forEach((btn) => {
    let bounds = null;

    btn.addEventListener("pointerenter", () => {
      if (isReducedMotion) return;
      bounds = btn.getBoundingClientRect();
      btn.style.transition = "transform 0.15s ease-out";
    });

    btn.addEventListener("pointermove", (e) => {
      if (isReducedMotion || !bounds) return;
      const x = e.clientX - bounds.left - bounds.width / 2;
      const y = e.clientY - bounds.top - bounds.height / 2;
      // Clamp to max 5px
      const dx = Math.max(-5, Math.min(5, x * 0.18));
      const dy = Math.max(-5, Math.min(5, y * 0.18));
      btn.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    });

    btn.addEventListener("pointerleave", () => {
      btn.style.transition = "transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)";
      btn.style.transform = "translate3d(0, 0, 0)";
      bounds = null;
    });
  });
}

/**
 * Click ripple micro-interaction on buttons.
 */
function initClickRipples() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button, .btn, .tab-btn, .theme-btn");
    if (!btn || btn.disabled || isReducedMotion) return;

    // Ensure button has relative positioning and overflow hidden
    const comp = window.getComputedStyle(btn);
    if (comp.position === "static") {
      btn.style.position = "relative";
    }
    btn.style.overflow = "hidden";

    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const x = (e.clientX || (rect.left + rect.width / 2)) - rect.left - size / 2;
    const y = (e.clientY || (rect.top + rect.height / 2)) - rect.top - size / 2;

    const wave = document.createElement("span");
    wave.className = "ripple-wave";
    wave.style.pointerEvents = "none";
    wave.style.width = `${size}px`;
    wave.style.height = `${size}px`;
    wave.style.left = `${x}px`;
    wave.style.top = `${y}px`;

    btn.appendChild(wave);

    setTimeout(() => {
      if (wave.parentNode) wave.parentNode.removeChild(wave);
    }, 550);
  });
}

/**
 * Press-and-hold continuous steppers for zoom buttons and range controls.
 */
function initPressAndHoldSteppers() {
  const steppers = [
    { id: "btn-zoom-in", action: () => document.getElementById("btn-zoom-in")?.click() },
    { id: "btn-zoom-out", action: () => document.getElementById("btn-zoom-out")?.click() }
  ];

  steppers.forEach(({ id, action }) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    setupPressAndHold(btn, action);
  });
}

export function setupPressAndHold(element, callback) {
  let timer = null;
  let interval = null;
  let delay = 350;

  function stop() {
    if (timer) clearTimeout(timer);
    if (interval) clearInterval(interval);
    timer = null;
    interval = null;
    delay = 350;
  }

  element.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // Primary click only
    callback(); // Immediate initial step

    timer = setTimeout(() => {
      interval = setInterval(() => {
        callback();
        // Slightly accelerate interval down to 40ms
        if (delay > 40) delay = Math.max(40, delay - 20);
      }, 70);
    }, delay);
  });

  element.addEventListener("pointerup", stop);
  element.addEventListener("pointercancel", stop);
  element.addEventListener("pointerleave", stop);
}

/**
 * Morphing Theme Toggle (Sun to Moon)
 */
function initMorphingThemeToggle() {
  const toggleBtn = $("theme-toggle-morph");
  if (!toggleBtn) return;

  function updateMorphIcon(theme) {
    const isDark = theme === "dark";
    toggleBtn.setAttribute("data-theme-active", isDark ? "dark" : "light");
    toggleBtn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    toggleBtn.setAttribute("title", isDark ? "Switch to light mode" : "Switch to dark mode");
  }

  const currentTheme = getStoredTheme();
  updateMorphIcon(currentTheme);

  toggleBtn.addEventListener("click", () => {
    const cur = getStoredTheme();
    const next = cur === "light" ? "dark" : "light";
    setStoredTheme(next);
    applyTheme(next);
    updateMorphIcon(next);
  });

  // Keep in sync when other theme buttons are clicked
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.getAttribute("data-theme-val");
      if (val === "light" || val === "dark") {
        updateMorphIcon(val);
      }
    });
  });
}

/**
 * Smooth view transition helper (uses View Transitions API with CSS fade fallback).
 * @param {Function} updateFn
 */
export function transitionView(updateFn) {
  if (document.startViewTransition && !isReducedMotion) {
    document.startViewTransition(updateFn);
  } else {
    updateFn();
  }
}
