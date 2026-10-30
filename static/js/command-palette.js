"use strict";

/**
 * PlateOD Command Palette (command-palette.js)
 * 
 * Provides an accessible, keyboard-first modal (Ctrl/Cmd+K)
 * with fuzzy action filtering, recent commands, focus trap,
 * and direct well navigation (e.g. typing "C7").
 */

import { $, el, clearChildren, showToast } from "./dom.js";
import { S } from "./state.js";
import { selectAssay } from "./presets.js";
import { applyTheme, getStoredTheme, setStoredTheme } from "./theme.js";
import { openWellInspector } from "./results.js";

const RECENT_KEY = "plateod_recent_actions";

const BASE_COMMANDS = [
  { id: "run", title: "Run Analysis", category: "Analysis", icon: "▶", shortcut: "R", run: () => $("run")?.click() },
  { id: "upload", title: "Upload Plate Photo", category: "File", icon: "📁", shortcut: "U", run: () => $("file")?.click() },
  { id: "detect_grid", title: "Auto-detect Grid Corners", category: "Grid", icon: "🎯", run: () => $("detect-grid")?.click() },
  { id: "reset_grid", title: "Reset Grid Handles to Default", category: "Grid", icon: "↺", run: () => $("btn-reset-grid")?.click() },
  { id: "toggle_circles", title: "Toggle Well Circle Overlays", category: "View", icon: "◎", shortcut: "G", run: () => $("btn-toggle-circles")?.click() },
  { id: "assay_spce", title: "Switch Assay to SPCE (PI %)", category: "Assay", icon: "🧪", run: () => { $("btn-assay-spce")?.click(); selectAssay("SPCE"); } },
  { id: "assay_diva", title: "Switch Assay to DIVA (PP %)", category: "Assay", icon: "🧪", run: () => { $("btn-assay-diva")?.click(); selectAssay("DIVA"); } },
  { id: "tab_heatmap", title: "View Heatmap (OD)", category: "Results", icon: "▦", shortcut: "H", run: () => $("tab-od")?.click() },
  { id: "tab_val", title: "View Heatmap (PI / PP)", category: "Results", icon: "▦", run: () => $("tab-val")?.click() },
  { id: "tab_table", title: "View Wells Table", category: "Results", icon: "📋", shortcut: "T", run: () => $("tab-table")?.click() },
  { id: "download_csv", title: "Download Results CSV", category: "Export", icon: "📥", run: () => $("download")?.click() },
  { id: "toggle_theme", title: "Toggle Theme (Light / Dark)", category: "Preferences", icon: "🌓", run: () => toggleThemeMode() },
  { id: "goto_faq", title: "Go to Best Practices & FAQ", category: "Navigation", icon: "❓", run: () => {
    const faq = $("faq");
    if (faq) faq.scrollIntoView({ behavior: "smooth" });
  }},
  { id: "shortcuts", title: "Keyboard Shortcuts Reference", category: "Help", icon: "⌨", shortcut: "?", run: () => window.dispatchEvent(new CustomEvent("plateod:shortcuts")) },
  { id: "tour", title: "Take Guided Onboarding Tour", category: "Help", icon: "🚀", run: () => window.dispatchEvent(new CustomEvent("plateod:tour")) }
];

let selectedIndex = 0;
let currentResults = [];
let previousActiveElement = null;

export function initCommandPalette() {
  const modal = $("command-palette-modal");
  const input = $("command-palette-input");
  const backdrop = $("command-palette-backdrop");
  const closeBtn = $("command-palette-close");

  if (!modal || !input) return;

  // Global Ctrl+K / Cmd+K listener
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      togglePalette();
    }
  });

  // Open triggers
  document.querySelectorAll("[data-open-palette]").forEach((btn) => {
    btn.addEventListener("click", () => openPalette());
  });

  if (backdrop) backdrop.addEventListener("click", () => closePalette());
  if (closeBtn) closeBtn.addEventListener("click", () => closePalette());

  input.addEventListener("input", () => {
    selectedIndex = 0;
    renderPaletteList(input.value.trim());
  });

  input.addEventListener("keydown", handleKeydown);

  // Focus trap
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      const focusables = modal.querySelectorAll("input, button, [tabindex]:not([tabindex='-1'])");
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  });
}

export function openPalette() {
  const modal = $("command-palette-modal");
  const input = $("command-palette-input");
  if (!modal || !input) return;

  previousActiveElement = document.activeElement;
  modal.hidden = false;
  modal.classList.add("open");
  input.value = "";
  selectedIndex = 0;
  renderPaletteList("");

  requestAnimationFrame(() => {
    input.focus();
  });
}

export function closePalette() {
  const modal = $("command-palette-modal");
  if (!modal) return;
  modal.classList.remove("open");
  const input = $("command-palette-input");
  if (input) input.blur();
  modal.hidden = true;
  if (previousActiveElement && typeof previousActiveElement.focus === "function") {
    try { previousActiveElement.focus(); } catch (_) {}
  }
}

export function togglePalette() {
  const modal = $("command-palette-modal");
  if (modal && !modal.hidden && modal.classList.contains("open")) {
    closePalette();
  } else {
    openPalette();
  }
}

function handleKeydown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    closePalette();
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (currentResults.length > 0) {
      selectedIndex = (selectedIndex + 1) % currentResults.length;
      updateActiveItem();
    }
    return;
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (currentResults.length > 0) {
      selectedIndex = (selectedIndex - 1 + currentResults.length) % currentResults.length;
      updateActiveItem();
    }
    return;
  }

  if (e.key === "Enter") {
    e.preventDefault();
    if (currentResults[selectedIndex]) {
      executeCommand(currentResults[selectedIndex]);
    }
  }
}

function executeCommand(cmd) {
  closePalette();
  if (cmd && typeof cmd.run === "function") {
    // Record in recents
    recordRecent(cmd.id);
    cmd.run();
  }
}

function recordRecent(cmdId) {
  if (!cmdId) return;
  try {
    let recents = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    recents = recents.filter((id) => id !== cmdId);
    recents.unshift(cmdId);
    if (recents.length > 5) recents.length = 5;
    localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
  } catch (err) {}
}

function getRecents() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch (err) {
    return [];
  }
}

function renderPaletteList(query) {
  const listEl = $("command-palette-list");
  if (!listEl) return;
  clearChildren(listEl);

  const matched = [];

  // Check if query is a well name (e.g. C7, A1, H12)
  const wellMatch = query.match(/^([A-Ha-h])([1-9]|1[0-2])$/i);
  if (wellMatch) {
    const well = wellMatch[0].toUpperCase();
    matched.push({
      id: "well_" + well,
      title: `Open well ${well}`,
      category: "Well Navigation",
      icon: "🔍",
      run: () => {
        // If results are available, switch to od tab and open well inspector
        if (S.last && S.last.wells) {
          openWellInspector(well);
        } else {
          showToast(`No analysis results loaded yet for well ${well}`, "info");
        }
      }
    });
  }

  if (!query) {
    // Show recents first, then base commands
    const recentIds = getRecents();
    if (recentIds.length > 0) {
      const header = el("div", "Recent Actions", "palette-section-title");
      listEl.appendChild(header);
      recentIds.forEach((id) => {
        const found = BASE_COMMANDS.find((c) => c.id === id);
        if (found) matched.push(found);
      });
    }

    // Add remaining commands
    BASE_COMMANDS.forEach((c) => {
      if (!matched.some((m) => m.id === c.id)) {
        matched.push(c);
      }
    });
  } else {
    const q = query.toLowerCase();
    BASE_COMMANDS.forEach((c) => {
      if (c.title.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)) {
        matched.push(c);
      }
    });
  }

  currentResults = matched;
  selectedIndex = Math.min(selectedIndex, Math.max(0, currentResults.length - 1));

  if (currentResults.length === 0) {
    const empty = el("div", `No commands found for "${query}"`, "palette-empty");
    listEl.appendChild(empty);
    return;
  }

  let currentCategory = "";
  currentResults.forEach((cmd, idx) => {
    if (!query && cmd.category !== currentCategory) {
      currentCategory = cmd.category;
      const catEl = el("div", currentCategory, "palette-section-title");
      listEl.appendChild(catEl);
    }

    const item = el("div", undefined, "palette-item" + (idx === selectedIndex ? " active" : ""));
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "-1");
    item.id = "palette-item-" + idx;

    const left = el("div", undefined, "palette-item-left");
    const icon = el("span", cmd.icon || "•", "palette-item-icon");
    const title = el("span", cmd.title, "palette-item-title");
    left.appendChild(icon);
    left.appendChild(title);
    item.appendChild(left);

    if (cmd.shortcut) {
      const kbd = el("kbd", cmd.shortcut, "kbd-chip");
      item.appendChild(kbd);
    }

    item.addEventListener("click", () => executeCommand(cmd));
    item.addEventListener("mouseenter", () => {
      selectedIndex = idx;
      updateActiveItem();
    });

    listEl.appendChild(item);
  });

  updateActiveItem();
}

function updateActiveItem() {
  const items = document.querySelectorAll(".palette-item");
  items.forEach((item, idx) => {
    if (idx === selectedIndex) {
      item.classList.add("active");
      item.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else {
      item.classList.remove("active");
    }
  });
}

function toggleThemeMode() {
  const cur = getStoredTheme();
  const next = cur === "light" ? "dark" : "light";
  setStoredTheme(next);
  applyTheme(next);
  showToast(`Theme switched to ${next} mode`, "info");
}
