"use strict";

/**
 * PlateOD State Store (state.js)
 * 
 * Tiny observable store holding client state with change listeners.
 */

const listeners = new Set();
const propListeners = new Map();

export const S = {
  dataUrl: null,
  imageId: null,
  w: 0,
  h: 0,
  img: null,
  corners: null,
  circles: null,
  scale: 1,
  drag: -1,
  selHandle: -1,
  hoverHandle: -1,
  hideCircles: false,
  tok: 0,
  last: null,
  zoomLevel: 1.0,
  tab: "table",
  selectedAssay: null,
  isCustomised: false,
  presets: null,
  // Batch processing
  batchFiles: [],
  batchRunning: false,
  batchResults: [],
  // Connectivity
  online: true
};

export const TBL = {
  search: "",
  sortCol: "well",
  sortAsc: true
};

// Expose globally for devtools and non-module compatibility
if (typeof window !== "undefined") {
  window.S = S;
  window.TBL = TBL;
}

/**
 * Subscribe to all state changes.
 * @param {Function} fn (prop, value, state) => void
 * @returns {Function} unsubscribe
 */
export function subscribeState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Subscribe to a specific state property change.
 * @param {string} prop
 * @param {Function} fn (value, state) => void
 * @returns {Function} unsubscribe
 */
export function onState(prop, fn) {
  if (!propListeners.has(prop)) {
    propListeners.set(prop, new Set());
  }
  propListeners.get(prop).add(fn);
  return () => {
    const set = propListeners.get(prop);
    if (set) set.delete(fn);
  };
}

/**
 * Set one or multiple state properties and notify listeners.
 * @param {string|object} keyOrObj
 * @param {*} [val]
 */
export function setState(keyOrObj, val) {
  if (typeof keyOrObj === "string") {
    S[keyOrObj] = val;
    notify(keyOrObj, val);
  } else if (keyOrObj && typeof keyOrObj === "object") {
    for (const [k, v] of Object.entries(keyOrObj)) {
      S[k] = v;
      notify(k, v);
    }
  }
}

function notify(prop, value) {
  for (const fn of listeners) {
    try { fn(prop, value, S); } catch (e) { console.error(e); }
  }
  const propSet = propListeners.get(prop);
  if (propSet) {
    for (const fn of propSet) {
      try { fn(value, S); } catch (e) { console.error(e); }
    }
  }
}
