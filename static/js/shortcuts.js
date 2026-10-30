"use strict";

/**
 * PlateOD Keyboard Shortcuts & Cheat-sheet Overlay (shortcuts.js)
 * 
 * Maps single-key shortcuts (R, U, G, H, T, [, ], ?) and renders
 * accessible button hints and a shortcut reference modal.
 */

import { $, el, clearChildren } from "./dom.js";

const SHORTCUTS = [
  { key: "R", action: "Run Analysis", target: () => $("run") },
  { key: "U", action: "Upload Plate Photo", target: () => $("file") },
  { key: "G", action: "Toggle Well Circles", target: () => $("btn-toggle-circles") },
  { key: "H", action: "Show Heatmap View", target: () => $("tab-od") },
  { key: "T", action: "Show Table View", target: () => $("tab-table") },
  { key: "[", action: "Previous Well (Inspector)", target: () => $("inspector-btn-prev") },
  { key: "]", action: "Next Well (Inspector)", target: () => $("inspector-btn-next") },
  { key: "?", action: "Open Keyboard Shortcuts", target: () => openShortcutsModal() },
  { key: "Ctrl + K", action: "Open Command Palette", target: null },
  { key: "Ctrl + Z", action: "Undo Corner Adjustment", target: () => $("btn-undo") },
  { key: "Ctrl + ⇧ + Z", action: "Redo Corner Adjustment", target: () => $("btn-redo") },
  { key: "Esc", action: "Close Drawer / Modals", target: null }
];

export function initShortcuts() {
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("plateod:shortcuts", () => openShortcutsModal());

  // Setup shortcuts modal triggers
  const modal = $("shortcuts-modal");
  const closeBtn = $("shortcuts-modal-close");
  const backdrop = $("shortcuts-modal-backdrop");

  if (closeBtn) closeBtn.addEventListener("click", () => closeShortcutsModal());
  if (backdrop) backdrop.addEventListener("click", () => closeShortcutsModal());

  const sbBtn = $("sb-btn-shortcuts");
  if (sbBtn) sbBtn.addEventListener("click", () => openShortcutsModal());

  // Attach key hint badges to primary buttons
  attachKeyHints();
}

function handleGlobalKeydown(e) {
  // Ignore shortcuts when user is focused in input, textarea, select, or editable element
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) {
    return;
  }

  // If command palette or another dialog is active, let them handle Esc/nav
  const palette = $("command-palette-modal");
  if (palette && !palette.hidden && palette.classList.contains("open")) {
    return;
  }

  // Check shortcuts
  if (e.key === "?" || (e.shiftKey && (e.key === "/" || e.code === "Slash"))) {
    e.preventDefault();
    toggleShortcutsModal();
    return;
  }

  if (e.key === "Escape") {
    closeShortcutsModal();
    return;
  }

  // Don't trigger single-letter shortcuts when Ctrl/Meta/Alt are held
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const k = e.key.toLowerCase();

  if (k === "r") {
    const btn = $("run");
    if (btn && !btn.disabled) {
      e.preventDefault();
      btn.click();
    }
  } else if (k === "u") {
    const file = $("file");
    if (file) {
      e.preventDefault();
      file.click();
    }
  } else if (k === "g") {
    const btn = $("btn-toggle-circles");
    if (btn) {
      e.preventDefault();
      btn.click();
    }
  } else if (k === "h") {
    const tab = $("tab-od");
    if (tab) {
      e.preventDefault();
      tab.click();
    }
  } else if (k === "t") {
    const tab = $("tab-table");
    if (tab) {
      e.preventDefault();
      tab.click();
    }
  } else if (e.key === "[") {
    const prev = $("inspector-btn-prev");
    if (prev && !prev.disabled) {
      e.preventDefault();
      prev.click();
    }
  } else if (e.key === "]") {
    const next = $("inspector-btn-next");
    if (next && !next.disabled) {
      e.preventDefault();
      next.click();
    }
  }
}

export function openShortcutsModal() {
  const modal = $("shortcuts-modal");
  if (!modal) return;
  renderShortcutsList();
  modal.hidden = false;
  modal.classList.add("open");
}

export function closeShortcutsModal() {
  const modal = $("shortcuts-modal");
  if (!modal) return;
  modal.classList.remove("open");
  setTimeout(() => {
    modal.hidden = true;
  }, 150);
}

export function toggleShortcutsModal() {
  const modal = $("shortcuts-modal");
  if (modal && !modal.hidden && modal.classList.contains("open")) {
    closeShortcutsModal();
  } else {
    openShortcutsModal();
  }
}

function renderShortcutsList() {
  const listEl = $("shortcuts-list");
  if (!listEl) return;
  clearChildren(listEl);

  SHORTCUTS.forEach((sc) => {
    const row = el("div", undefined, "shortcut-row");
    const kbd = el("kbd", sc.key, "kbd-chip key-badge");
    const desc = el("span", sc.action, "shortcut-desc");
    row.appendChild(kbd);
    row.appendChild(desc);
    listEl.appendChild(row);
  });
}

function attachKeyHints() {
  // Attach key chips to existing buttons
  const hints = [
    { selector: "#run", key: "R" },
    { selector: "#btn-toggle-circles", key: "G" }
  ];

  hints.forEach(({ selector, key }) => {
    const btn = document.querySelector(selector);
    if (btn && !btn.querySelector(`.kbd-hint-${key.toLowerCase()}`)) {
      const chip = el("kbd", key, `kbd-chip btn-key-hint kbd-hint-${key.toLowerCase()}`);
      chip.setAttribute("aria-hidden", "true");
      btn.appendChild(chip);
    }
  });
}
