"use strict";

/**
 * PlateOD Toast Notification & Problems System (toast-system.js)
 * 
 * Features:
 * - Stacked toasts with icons & animated progress bars
 * - Swipe / drag to dismiss (pointer events)
 * - Accessible aria-live region (#toast-container)
 * - Persistent "Problems" card for QC failures
 */

import { $, el, clearChildren } from "./dom.js";

const TOAST_ICONS = {
  success: "✓",
  error: "✕",
  warning: "⚠",
  info: "ℹ"
};

export function initToastSystem() {
  const container = $("toast-container");
  if (!container) return;
  container.setAttribute("role", "status");
  container.setAttribute("aria-live", "polite");
}

/**
 * Display a modern stacked toast with icon, progress bar, and swipe-to-dismiss.
 * @param {string} msg
 * @param {"info"|"success"|"warning"|"error"} type
 * @param {number} duration ms
 */
export function showRichToast(msg, type = "info", duration = 3500) {
  const container = $("toast-container");
  if (!container) return;

  const toast = el("div", undefined, `toast-pill toast-${type}`);
  toast.setAttribute("role", "alert");

  // Icon
  const iconSpan = el("span", TOAST_ICONS[type] || "ℹ", "toast-icon");
  toast.appendChild(iconSpan);

  // Message
  const msgSpan = el("span", msg, "toast-msg");
  toast.appendChild(msgSpan);

  // Close button
  const closeBtn = el("button", "×", "toast-close-btn");
  closeBtn.setAttribute("type", "button");
  closeBtn.setAttribute("aria-label", "Dismiss notification");
  toast.appendChild(closeBtn);

  // Animated progress bar
  const progressBar = el("div", undefined, "toast-progress");
  const progressFill = el("div", undefined, "toast-progress-fill");
  progressBar.appendChild(progressFill);
  toast.appendChild(progressBar);

  container.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => {
    toast.classList.add("visible");
    // Start progress shrink
    progressFill.style.transition = `width ${duration}ms linear`;
    progressFill.style.width = "0%";
  });

  let dismissTimer = null;
  function scheduleDismiss() {
    dismissTimer = setTimeout(() => {
      dismissToast(toast);
    }, duration);
  }

  scheduleDismiss();

  closeBtn.addEventListener("click", () => {
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissToast(toast);
  });

  // Swipe / Drag to dismiss
  let startX = 0;
  let currentX = 0;
  let isDragging = false;

  toast.addEventListener("pointerdown", (e) => {
    if (e.target === closeBtn) return;
    startX = e.clientX;
    currentX = startX;
    isDragging = true;
    toast.setPointerCapture(e.pointerId);
    toast.style.transition = "none";
    if (dismissTimer) clearTimeout(dismissTimer);
  });

  toast.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    currentX = e.clientX;
    const dx = currentX - startX;
    toast.style.transform = `translateX(${dx}px)`;
    toast.style.opacity = `${Math.max(0.2, 1 - Math.abs(dx) / 180)}`;
  });

  const onPointerEnd = (e) => {
    if (!isDragging) return;
    isDragging = false;
    try { toast.releasePointerCapture(e.pointerId); } catch (_) {}

    const dx = currentX - startX;
    if (Math.abs(dx) > 60) {
      // Swiped away
      toast.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out";
      toast.style.transform = `translateX(${dx > 0 ? 300 : -300}px)`;
      toast.style.opacity = "0";
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    } else {
      // Snap back
      toast.style.transition = "transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s ease";
      toast.style.transform = "translateX(0)";
      toast.style.opacity = "1";
      scheduleDismiss();
    }
  };

  toast.addEventListener("pointerup", onPointerEnd);
  toast.addEventListener("pointercancel", onPointerEnd);
}

function dismissToast(toast) {
  if (!toast) return;
  toast.classList.remove("visible");
  toast.style.transform = "translateY(-10px) scale(0.95)";
  toast.style.opacity = "0";
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 220);
}

/**
 * Renders or updates the persistent "Problems" card for QC failures.
 * @param {string[]} problems
 * @param {string[]} warnings
 */
export function updateProblemsCard(problems = [], warnings = []) {
  let card = $("problems-card");
  if (!card) {
    const banner = $("banner");
    if (!banner) return;
    card = el("div", undefined, "card problems-card");
    card.id = "problems-card";
    banner.parentNode.insertBefore(card, banner.nextSibling);
  }

  const hasProblems = problems && problems.length > 0;
  const hasWarnings = warnings && warnings.length > 0;

  if (!hasProblems && !hasWarnings) {
    card.hidden = true;
    clearChildren(card);
    return;
  }

  card.hidden = false;
  clearChildren(card);

  const header = el("div", undefined, "problems-card-header");
  const badgeClass = hasProblems ? "badge-problem-danger" : "badge-problem-warning";
  const badgeText = hasProblems
    ? `QC Alert: ${problems.length} Problem${problems.length > 1 ? "s" : ""} Detected`
    : `QC Note: ${warnings.length} Warning${warnings.length > 1 ? "s" : ""}`;
  const badge = el("span", badgeText, `badge ${badgeClass}`);
  header.appendChild(badge);

  const dismissBtn = el("button", "Dismiss", "btn btn-ghost btn-sm");
  dismissBtn.addEventListener("click", () => {
    card.hidden = true;
  });
  header.appendChild(dismissBtn);
  card.appendChild(header);

  if (hasProblems) {
    const probList = el("ul", undefined, "problem-items-list error-list");
    problems.forEach((p) => {
      const li = el("li");
      const icon = el("span", "✕ ", "problem-bullet-icon text-red");
      const text = el("span", p);
      li.appendChild(icon);
      li.appendChild(text);
      probList.appendChild(li);
    });
    card.appendChild(probList);
  }

  if (hasWarnings) {
    const warnList = el("ul", undefined, "problem-items-list warning-list");
    warnings.forEach((w) => {
      const li = el("li");
      const icon = el("span", "⚠ ", "problem-bullet-icon text-amber");
      const text = el("span", w);
      li.appendChild(icon);
      li.appendChild(text);
      warnList.appendChild(li);
    });
    card.appendChild(warnList);
  }
}
