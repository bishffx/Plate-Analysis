"use strict";

/**
 * PlateOD API Module (api.js)
 * 
 * Wraps every server endpoint with AbortController support,
 * error normalization, and performance latency logging.
 */

import { S, setState } from "./state.js";

/**
 * Low-level JSON API requester.
 * @param {string} path
 * @param {object} body
 * @param {AbortSignal} [signal]
 * @returns {Promise<any>}
 */
export async function api(path, body, signal = null) {
  const t0 = performance.now();
  let r;
  try {
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    };
    if (signal) opts.signal = signal;
    r = await fetch(path, opts);
  } catch (e) {
    if (e.name === "AbortError") {
      throw e;
    }
    checkServerHealth();
    throw new Error("Cannot reach the server. Is server.py still running?");
  }

  const dur = (performance.now() - t0).toFixed(1);
  const timing = r.headers.get("Server-Timing");
  console.log(`[API] ${path} -> HTTP ${r.status} (${dur} ms${timing ? ", " + timing : ""})`);

  let j;
  try {
    j = await r.json();
  } catch (e) {
    throw new Error(`Server sent an unreadable response (HTTP ${r.status})`);
  }

  if (r.status === 410) {
    const err = new Error(j.error || "Image expired (HTTP 410)");
    err.status = 410;
    err.isExpired = true;
    throw err;
  }

  if (!r.ok) {
    const err = new Error(j.error || `HTTP ${r.status}`);
    err.status = r.status;
    err.data = j;
    throw err;
  }

  return j;
}

/**
 * Checks server health via GET / with no-store cache.
 */
export async function checkServerHealth() {
  try {
    const r = await fetch("/", { method: "GET", cache: "no-store" });
    const isUp = r.ok;
    setState("online", isUp);
    updateStatusChip(isUp);
    return isUp;
  } catch (e) {
    setState("online", false);
    updateStatusChip(false);
    return false;
  }
}

function updateStatusChip(isUp) {
  const chip = document.getElementById("server-status");
  const dot = chip ? (chip.querySelector(".status-dot") || document.getElementById("status-dot")) : null;
  const text = chip ? (chip.querySelector(".status-text") || document.getElementById("status-text")) : null;
  if (!chip) return;
  if (isUp) {
    chip.className = "status-chip online";
    if (dot) dot.className = "status-dot green";
    if (text) text.textContent = "Connected";
    chip.setAttribute("aria-label", "Server status: Online");
  } else {
    chip.className = "status-chip offline";
    if (dot) dot.className = "status-dot red";
    if (text) text.textContent = "Offline";
    chip.setAttribute("aria-label", "Server status: Offline");
  }
}

// -----------------------------------------------------------------------------
// Endpoint Wrappers
// -----------------------------------------------------------------------------

export async function fetchPresets() {
  return await api("/api/presets", {});
}

export async function uploadImage(dataUrl) {
  return await api("/api/upload", { image: dataUrl });
}

export async function prepareImage(dataUrl) {
  return await api("/api/prepare", { image: dataUrl });
}

export async function fetchGrid(params, signal = null) {
  return await api("/api/grid", params, signal);
}

export async function detectGrid(params, signal = null) {
  return await api("/api/detect_grid", params, signal);
}

export async function analyzePlate(params, signal = null) {
  return await api("/api/analyze", params, signal);
}

export async function calibrateFit(params) {
  return await api("/api/calibrate", params);
}

export async function validateConfigFile(config) {
  return await api("/api/config/validate", config);
}

export async function runBatch(plates, config, autoDetect = true) {
  return await api("/api/batch", { plates, config, auto_detect: autoDetect });
}
