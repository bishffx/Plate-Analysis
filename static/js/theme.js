"use strict";

/**
 * PlateOD Theme Manager (theme.js)
 * 
 * Supports Dark (default), Light, and System themes with localStorage persistence.
 */

import { S } from "./state.js";
import { draw } from "./plate-canvas.js";

const THEME_STORAGE_KEY = "plateod_theme_pref";

export function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || "dark";
  } catch (err) {
    return "dark";
  }
}

export function setStoredTheme(pref) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch (err) {}
}

export function applyTheme(pref) {
  const root = document.documentElement;
  let resolved = pref;
  if (pref === "system") {
    resolved = (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches)
      ? "light"
      : "dark";
  }
  root.setAttribute("data-theme", resolved);

  document.querySelectorAll(".theme-btn").forEach((btn) => {
    const val = btn.getAttribute("data-theme-val");
    if (val === pref) {
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
    } else {
      btn.classList.remove("active");
      btn.setAttribute("aria-pressed", "false");
    }
  });

  // Re-draw canvas overlay to maintain crispness with updated theme colors
  if (S.img) {
    draw();
  }
}

export function initTheme() {
  const current = getStoredTheme();
  applyTheme(current);

  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const chosen = btn.getAttribute("data-theme-val");
      setStoredTheme(chosen);
      applyTheme(chosen);
    });
  });

  if (typeof window !== "undefined" && window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
      if (getStoredTheme() === "system") {
        applyTheme("system");
      }
    });
  }
}
