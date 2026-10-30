"use strict";

/**
 * PlateOD DOM Helpers (dom.js)
 * 
 * Strict textContent only; never innerHTML with user or API data.
 */

export const $ = (id) => (typeof id === "string" ? document.getElementById(id) : id);
export const $$ = (sel, parent = document) => Array.from(parent.querySelectorAll(sel));

/**
 * Safe element builder.
 * Guarantees all text is assigned via textContent.
 * @param {string} tag
 * @param {string|number|object} [textOrProps]
 * @param {string} [className]
 * @returns {HTMLElement}
 */
export function el(tag, textOrProps, className) {
  const node = document.createElement(tag);
  if (textOrProps !== undefined && textOrProps !== null) {
    if (typeof textOrProps === "object" && !(textOrProps instanceof Node)) {
      // Attributes / properties
      for (const [k, v] of Object.entries(textOrProps)) {
        if (k === "class" || k === "className") {
          node.className = v;
        } else if (k === "text" || k === "textContent") {
          node.textContent = v;
        } else if (k === "style" && typeof v === "object") {
          Object.assign(node.style, v);
        } else if (k.startsWith("data-") || k.startsWith("aria-")) {
          node.setAttribute(k, v);
        } else if (k in node) {
          try { node[k] = v; } catch (_) { node.setAttribute(k, v); }
        } else {
          node.setAttribute(k, v);
        }
      }
    } else {
      node.textContent = String(textOrProps);
    }
  }
  if (className) {
    node.className = className;
  }
  return node;
}

/**
 * Formats a numeric value with fixed decimals, or returns an em-dash.
 * @param {number|null|undefined} v
 * @param {number} n
 * @returns {string}
 */
export function fmt(v, n = 3) {
  if (v === null || v === undefined || isNaN(v)) return "–";
  return Number(v).toFixed(n);
}

/**
 * Removes all children from a DOM element safely.
 * @param {HTMLElement} node
 */
export function clearChildren(node) {
  if (!node) return;
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

/**
 * Draws a rounded rectangle path on a 2D canvas context.
 */
export function roundRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y + w, x, y, r);
  ctx.closePath();
}

/**
 * Shows a toast message notification.
 * @param {string} msg
 * @param {"info"|"success"|"warning"|"error"} type
 * @param {number} duration
 */
export function showToast(msg, type = "info", duration = 3500) {
  const container = $("toast-container");
  if (!container) return;

  const toast = el("div", undefined, `toast-pill toast-${type}`);
  const iconSpan = el("span", undefined, "toast-icon");
  const icons = {
    success: "✓",
    error: "✕",
    warning: "⚠",
    info: "ℹ"
  };
  iconSpan.textContent = icons[type] || "ℹ";
  toast.appendChild(iconSpan);

  const msgSpan = el("span", msg, "toast-msg");
  toast.appendChild(msgSpan);

  container.appendChild(toast);

  // Trigger enter transition
  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, duration);
}

/**
 * Displays banner messages (success, warning, error) with structured DOM construction.
 */
export function showMessage(type, title, text, details = null) {
  const banner = $("banner");
  if (!banner) return;

  clearChildren(banner);
  banner.className = `banner banner-${type} visible`;

  const head = el("div", undefined, "banner-header");
  const icon = el("span", undefined, "banner-icon");
  const iconMap = {
    error: "✕",
    warning: "⚠",
    success: "✓",
    info: "ℹ"
  };
  icon.textContent = iconMap[type] || "ℹ";
  head.appendChild(icon);

  const tEl = el("strong", title, "banner-title");
  head.appendChild(tEl);
  banner.appendChild(head);

  if (text) {
    const p = el("div", text, "banner-body");
    banner.appendChild(p);
  }

  if (details && Array.isArray(details) && details.length > 0) {
    const ul = el("ul", undefined, "banner-details-list");
    for (const d of details) {
      ul.appendChild(el("li", String(d)));
    }
    banner.appendChild(ul);
  }

  // Auto-scroll banner into view if error
  if (type === "error" || type === "warning") {
    banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

export function hideMessage() {
  const banner = $("banner");
  if (!banner) return;
  banner.className = "banner hidden";
  clearChildren(banner);
}
