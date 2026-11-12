"use strict";

/**
 * PlateOD API Module (api.js)
 * 
 * Wraps every server endpoint with AbortController support,
 * error normalization, and performance latency logging.
 */

import "./runtime-config.js";
import { S, setState } from "./state.js";
import { getActiveRunTimer } from "./perf.js";

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
    const runTimer = getActiveRunTimer();
    if (runTimer && path.includes("analyze")) runTimer.markUploadStart();
    r = await fetch(path, opts);
    if (runTimer && path.includes("analyze")) runTimer.markTtfb();
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
  setState("lastLatency", dur);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("plateod:api", { detail: { path, dur, ok: r.ok } }));
  }

  let j;
  const runTimer = getActiveRunTimer();
  try {
    const rawText = await r.text();
    if (runTimer && path.includes("analyze")) runTimer.markDownloadEnd();
    j = JSON.parse(rawText);
    if (runTimer && path.includes("analyze")) runTimer.markJsonEnd();
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
    if (!isUp) {
      import("./status-bar.js").then((m) => m.showOfflineBanner()).catch(() => {});
    } else {
      import("./status-bar.js").then((m) => m.hideOfflineBanner()).catch(() => {});
    }
    return isUp;
  } catch (e) {
    setState("online", false);
    updateStatusChip(false);
    import("./status-bar.js").then((m) => m.showOfflineBanner()).catch(() => {});
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

/**
 * Sends per-well Image OD values to the external FastAPI ML calibration backend
 * (SVR & ANN/MLP). Never uses local same-origin api() or checkServerHealth().
 * @param {Array<{well: string, image_od: number}>} wellsPayload
 * @param {AbortSignal} [signal]
 * @returns {Promise<{count: number, models: string[], results: Array<{well: string, image_od: number, svr_calibrated_od: number, ann_mlp_calibrated_od: number}>}>}
 */
export async function predictMlCalibration(wellsPayload, signal = null) {
  const baseUrl = String(window.PLATEOD_CONFIG?.ML_API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("ML calibration backend URL is not configured.");
  }
  if (!Array.isArray(wellsPayload) || wellsPayload.length === 0) {
    throw new Error("No valid Image OD values available for ML calibration.");
  }

  const endpoint = `${baseUrl}/calibrate/batch`;
  let response;
  try {
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wells: wellsPayload })
    };
    if (signal) opts.signal = signal;
    response = await fetch(endpoint, opts);
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw err;
    }
    throw new Error(`Unable to reach ML calibration backend at ${baseUrl}.`);
  }

  let rawText;
  try {
    rawText = await response.text();
  } catch (_) {
    throw new Error(`Failed to read response from ML calibration backend (HTTP ${response.status}).`);
  }

  let data = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch (_) {
      throw new Error(`ML calibration backend returned invalid JSON (HTTP ${response.status}).`);
    }
  }

  if (!response.ok) {
    const detail = data && (data.detail || data.error || data.message);
    const detailMsg = typeof detail === "string" ? detail : (Array.isArray(detail) ? detail.map((d) => d?.msg || JSON.stringify(d)).join("; ") : "");
    throw new Error(detailMsg || `ML calibration backend returned HTTP ${response.status}.`);
  }

  if (!data || typeof data !== "object" || !Array.isArray(data.results)) {
    throw new Error("Malformed response from ML calibration backend: missing 'results' array.");
  }

  return data;
}
