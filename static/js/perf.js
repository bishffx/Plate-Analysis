"use strict";

/**
 * PlateOD Performance Monitor & Timing Breakdown (perf.js)
 * 
 * Provides:
 * - Hidden debug overlay (?perf=1 or localStorage.plateod_perf === "1")
 * - Real-time metrics: FPS, frame time, active rAF loops, active canvases, DPR, WebGL info
 * - Detailed Run flow instrumentation via performance.mark/measure:
 *   (1) image prep in the browser
 *   (2) upload time
 *   (3) server wait (TTFB)
 *   (4) download
 *   (5) JSON parse
 *   (6) render (KPIs, heatmap, table, annotated photo)
 *   Identifies and displays the dominant stage.
 */

import { $ } from "./dom.js";

let isEnabled = false;
let overlayEl = null;
let fpsHistory = [];
let lastFrameTime = performance.now();
let activeRafCount = 0;
let threeRendererRef = null;

// Stores the last run's timing breakdown
let lastRunReport = null;

export function registerThreeRenderer(renderer) {
  threeRendererRef = renderer;
}

export function isPerfActive() {
  if (typeof window === "undefined") return false;
  const urlParams = new URLSearchParams(window.location.search);
  const param = urlParams.get("perf");
  if (param === "1") return true;
  try {
    return localStorage.getItem("plateod_perf") === "1";
  } catch (_) {
    return false;
  }
}

/**
 * Performance Mark helper
 */
export function perfMark(name) {
  try {
    performance.mark(name);
  } catch (_) {}
}

/**
 * Performance Measure helper
 */
export function perfMeasure(name, startMark, endMark) {
  try {
    const entry = performance.measure(name, startMark, endMark);
    return entry.duration;
  } catch (_) {
    return 0;
  }
}

/**
 * Active Run Timing Tracker
 */
class RunTimer {
  constructor(assayName = "Run") {
    this.assay = assayName;
    this.t_start = performance.now();
    this.t_prep_start = 0;
    this.t_prep_end = 0;
    this.t_upload_start = 0;
    this.t_upload_end = 0;
    this.t_ttfb = 0;
    this.t_download_end = 0;
    this.t_json_end = 0;
    this.t_render_kpi_start = 0;
    this.t_render_kpi_end = 0;
    this.t_render_hm_start = 0;
    this.t_render_hm_end = 0;
    this.t_render_tbl_start = 0;
    this.t_render_tbl_end = 0;
    this.t_render_ann_start = 0;
    this.t_render_ann_end = 0;
    this.t_render_end = 0;
    this.t_complete = 0;

    perfMark("plateod:run-start");
  }

  markPrepStart() {
    this.t_prep_start = performance.now();
    perfMark("plateod:prep-start");
  }

  markPrepEnd() {
    this.t_prep_end = performance.now();
    perfMark("plateod:prep-end");
  }

  markUploadStart() {
    this.t_upload_start = performance.now();
    perfMark("plateod:upload-start");
  }

  markTtfb() {
    this.t_ttfb = performance.now();
    perfMark("plateod:ttfb");
  }

  markDownloadEnd() {
    this.t_download_end = performance.now();
    perfMark("plateod:download-end");
  }

  markJsonEnd() {
    this.t_json_end = performance.now();
    perfMark("plateod:json-end");
  }

  markRenderKpiStart() {
    this.t_render_kpi_start = performance.now();
    perfMark("plateod:render-kpi-start");
  }

  markRenderKpiEnd() {
    this.t_render_kpi_end = performance.now();
    perfMark("plateod:render-kpi-end");
  }

  markRenderHeatmapStart() {
    this.t_render_hm_start = performance.now();
    perfMark("plateod:render-hm-start");
  }

  markRenderHeatmapEnd() {
    this.t_render_hm_end = performance.now();
    perfMark("plateod:render-hm-end");
  }

  markRenderTableStart() {
    this.t_render_tbl_start = performance.now();
    perfMark("plateod:render-tbl-start");
  }

  markRenderTableEnd() {
    this.t_render_tbl_end = performance.now();
    perfMark("plateod:render-tbl-end");
  }

  markRenderAnnotatedStart() {
    this.t_render_ann_start = performance.now();
    perfMark("plateod:render-ann-start");
  }

  markRenderAnnotatedEnd() {
    this.t_render_ann_end = performance.now();
    perfMark("plateod:render-ann-end");
  }

  finish() {
    this.t_complete = performance.now();
    perfMark("plateod:run-complete");

    const imgPrep = Math.max(0, this.t_prep_end - this.t_prep_start);
    let uploadTime = 1.0;
    let serverWait = Math.max(0, (this.t_ttfb && this.t_upload_start) ? (this.t_ttfb - this.t_upload_start) : 0);
    try {
      const entries = performance.getEntriesByType("resource").filter(e => e.name.includes("/api/analyze"));
      if (entries.length) {
        const last = entries[entries.length - 1];
        if (last.responseStart > 0 && last.requestStart > 0) {
          uploadTime = Math.max(0.5, last.responseStart - last.startTime > 0 ? (last.requestStart - last.startTime) : 1.0);
          serverWait = Math.max(0, last.responseStart - last.requestStart);
        }
      }
    } catch (_) {}
    const downloadTime = Math.max(0, this.t_download_end - (this.t_ttfb || this.t_download_end));
    const jsonParse = Math.max(0, this.t_json_end - (this.t_download_end || this.t_json_end));
    
    const renderKpi = Math.max(0, this.t_render_kpi_end - this.t_render_kpi_start);
    const renderHeatmap = Math.max(0, this.t_render_hm_end - this.t_render_hm_start);
    const renderTable = Math.max(0, this.t_render_tbl_end - this.t_render_tbl_start);
    const renderAnnotated = Math.max(0, this.t_render_ann_end - this.t_render_ann_start);
    const renderTotal = Math.max(0, (this.t_complete - (this.t_render_kpi_start || this.t_json_end)));
    const totalTime = Math.max(0, this.t_complete - this.t_start);

    // Identify dominant stage
    const stages = [
      { name: "(1) Image Prep", dur: imgPrep },
      { name: "(2) Upload Time", dur: uploadTime },
      { name: "(3) Server Wait (TTFB)", dur: serverWait },
      { name: "(4) Download", dur: downloadTime },
      { name: "(5) JSON Parse", dur: jsonParse },
      { name: "(6) Total Render", dur: renderTotal }
    ];
    stages.sort((a, b) => b.dur - a.dur);
    const dominant = stages[0];

    const report = {
      assay: this.assay,
      timestamp: new Date().toLocaleTimeString(),
      total_ms: totalTime.toFixed(1),
      dominant: `${dominant.name} (${dominant.dur.toFixed(1)} ms)`,
      stages: {
        img_prep_ms: imgPrep.toFixed(1),
        upload_ms: uploadTime.toFixed(1),
        server_wait_ttfb_ms: serverWait.toFixed(1),
        download_ms: downloadTime.toFixed(1),
        json_parse_ms: jsonParse.toFixed(1),
        render_kpi_ms: renderKpi.toFixed(1),
        render_heatmap_ms: renderHeatmap.toFixed(1),
        render_table_ms: renderTable.toFixed(1),
        render_annotated_ms: renderAnnotated.toFixed(1),
        render_total_ms: renderTotal.toFixed(1)
      }
    };

    lastRunReport = report;

    // Log to console in formatted table
    console.group(`[PlateOD Perf] Run Breakdown · ${this.assay} (Total: ${report.total_ms} ms)`);
    console.table([
      { Stage: "1. Image Prep", "Time (ms)": report.stages.img_prep_ms },
      { Stage: "2. Upload Time", "Time (ms)": report.stages.upload_ms },
      { Stage: "3. Server Wait (TTFB)", "Time (ms)": report.stages.server_wait_ttfb_ms },
      { Stage: "4. Download", "Time (ms)": report.stages.download_ms },
      { Stage: "5. JSON Parse", "Time (ms)": report.stages.json_parse_ms },
      { Stage: "6a. Render KPIs", "Time (ms)": report.stages.render_kpi_ms },
      { Stage: "6b. Render Heatmap", "Time (ms)": report.stages.render_heatmap_ms },
      { Stage: "6c. Render Table", "Time (ms)": report.stages.render_table_ms },
      { Stage: "6d. Render Annotated Photo", "Time (ms)": report.stages.render_annotated_ms },
      { Stage: "6. Total Render", "Time (ms)": report.stages.render_total_ms },
      { Stage: "TOTAL", "Time (ms)": report.total_ms }
    ]);
    console.log(`%cDominant Stage: ${report.dominant}`, "color: #F5A524; font-weight: bold;");
    console.groupEnd();

    updatePerfOverlayRunData(report);

    return report;
  }
}

let activeRunTimer = null;

export function startRunTimer(assay = "Run") {
  activeRunTimer = new RunTimer(assay);
  return activeRunTimer;
}

export function getActiveRunTimer() {
  return activeRunTimer;
}

/**
 * Creates and injects the HUD overlay if enabled
 */
export function initPerfOverlay() {
  isEnabled = isPerfActive();
  if (!isEnabled) return;

  if (document.getElementById("perf-debug-overlay")) return;

  overlayEl = document.createElement("aside");
  overlayEl.id = "perf-debug-overlay";
  overlayEl.setAttribute("aria-label", "Performance Debug Overlay");
  overlayEl.innerHTML = `
    <div class="perf-header">
      <div class="perf-title">
        <span class="perf-dot"></span>
        <strong>PERF MONITOR</strong> (?perf=1)
      </div>
      <button type="button" id="perf-toggle-btn" class="perf-mini-btn" title="Minimize">_</button>
    </div>
    <div class="perf-body" id="perf-body">
      <div class="perf-metric-row">
        <span>FPS:</span>
        <strong id="perf-fps">--</strong>
        <span>Frame:</span>
        <strong id="perf-frame-time">-- ms</strong>
      </div>
      <div class="perf-metric-row">
        <span>DPR:</span>
        <strong id="perf-dpr">${(window.devicePixelRatio || 1).toFixed(2)}</strong>
        <span>Canvases:</span>
        <strong id="perf-canvases">--</strong>
      </div>
      <div class="perf-metric-row">
        <span>rAF Tasks:</span>
        <strong id="perf-raf-loops">--</strong>
        <span>WebGL:</span>
        <strong id="perf-webgl-info">--</strong>
      </div>
      <hr class="perf-divider">
      <div class="perf-section-title">LAST RUN BREAKDOWN</div>
      <div id="perf-run-status" class="perf-run-status">No analysis run yet</div>
      <div id="perf-run-table-wrap" class="perf-run-table-wrap" style="display:none;">
        <table class="perf-run-table">
          <tbody>
            <tr><td>Image prep:</td><td id="perf-t-prep">--</td></tr>
            <tr><td>Upload:</td><td id="perf-t-upload">--</td></tr>
            <tr><td>Server wait (TTFB):</td><td id="perf-t-ttfb">--</td></tr>
            <tr><td>Download:</td><td id="perf-t-download">--</td></tr>
            <tr><td>JSON parse:</td><td id="perf-t-json">--</td></tr>
            <tr><td>Render KPIs:</td><td id="perf-t-kpi">--</td></tr>
            <tr><td>Render Heatmap:</td><td id="perf-t-hm">--</td></tr>
            <tr><td>Render Table:</td><td id="perf-t-tbl">--</td></tr>
            <tr><td>Render Annotated:</td><td id="perf-t-ann">--</td></tr>
            <tr class="perf-tr-total"><td>Total:</td><td id="perf-t-total">--</td></tr>
          </tbody>
        </table>
        <div class="perf-dominant-wrap">
          <span>Dominant:</span>
          <strong id="perf-dominant">--</strong>
        </div>
      </div>
    </div>
  `;

  // Apply styling
  const style = document.createElement("style");
  style.id = "perf-debug-style";
  style.textContent = `
    #perf-debug-overlay {
      position: fixed;
      bottom: 16px;
      right: 16px;
      width: 290px;
      background: rgba(11, 16, 26, 0.94);
      border: 1px solid rgba(245, 165, 36, 0.4);
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.75), 0 0 12px rgba(245, 165, 36, 0.2);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      color: #E2E8F0;
      z-index: 999999;
      pointer-events: auto;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      user-select: none;
      line-height: 1.4;
    }
    #perf-debug-overlay.minimized #perf-body {
      display: none;
    }
    .perf-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: rgba(245, 165, 36, 0.12);
      border-bottom: 1px solid rgba(245, 165, 36, 0.25);
      border-radius: 7px 7px 0 0;
    }
    .perf-title {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #F5A524;
      font-size: 11px;
      letter-spacing: 0.04em;
    }
    .perf-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22C55E;
      box-shadow: 0 0 6px #22C55E;
    }
    .perf-mini-btn {
      background: transparent;
      border: none;
      color: #94A3B8;
      cursor: pointer;
      font-size: 12px;
      font-weight: bold;
      padding: 0 4px;
    }
    .perf-mini-btn:hover {
      color: #FFFFFF;
    }
    .perf-body {
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .perf-metric-row {
      display: flex;
      justify-content: space-between;
      color: #94A3B8;
    }
    .perf-metric-row strong {
      color: #F8FAFC;
    }
    .perf-divider {
      border: 0;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      margin: 4px 0;
    }
    .perf-section-title {
      font-size: 10px;
      font-weight: bold;
      color: #F5A524;
      letter-spacing: 0.05em;
    }
    .perf-run-status {
      color: #64748B;
      font-style: italic;
    }
    .perf-run-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
      font-size: 10.5px;
    }
    .perf-run-table td {
      padding: 1px 0;
    }
    .perf-run-table td:last-child {
      text-align: right;
      color: #F8FAFC;
      font-weight: bold;
    }
    .perf-tr-total td {
      border-top: 1px solid rgba(245, 165, 36, 0.3);
      padding-top: 3px;
      color: #F5A524 !important;
      font-weight: bold;
    }
    .perf-dominant-wrap {
      display: flex;
      justify-content: space-between;
      background: rgba(245, 165, 36, 0.1);
      border: 1px solid rgba(245, 165, 36, 0.25);
      border-radius: 4px;
      padding: 3px 6px;
      margin-top: 5px;
      font-size: 10px;
      color: #FCD34D;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(overlayEl);

  const toggleBtn = $("perf-toggle-btn");
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      overlayEl.classList.toggle("minimized");
      toggleBtn.textContent = overlayEl.classList.contains("minimized") ? "+" : "_";
    };
  }

  startPerfMetricsLoop();
}

function updatePerfOverlayRunData(report) {
  if (!overlayEl) return;
  const statusEl = $("perf-run-status");
  const wrapEl = $("perf-run-table-wrap");
  if (statusEl) statusEl.style.display = "none";
  if (wrapEl) wrapEl.style.display = "block";

  const setT = (id, val) => {
    const el = $(id);
    if (el) el.textContent = `${val} ms`;
  };

  setT("perf-t-prep", report.stages.img_prep_ms);
  setT("perf-t-upload", report.stages.upload_ms);
  setT("perf-t-ttfb", report.stages.server_wait_ttfb_ms);
  setT("perf-t-download", report.stages.download_ms);
  setT("perf-t-json", report.stages.json_parse_ms);
  setT("perf-t-kpi", report.stages.render_kpi_ms);
  setT("perf-t-hm", report.stages.render_heatmap_ms);
  setT("perf-t-tbl", report.stages.render_table_ms);
  setT("perf-t-ann", report.stages.render_annotated_ms);
  setT("perf-t-total", report.total_ms);

  const domEl = $("perf-dominant");
  if (domEl) domEl.textContent = report.dominant;
}

/**
 * Real-time monitoring loop
 */
let metricsFrameCount = 0;
let metricsLastSec = performance.now();
let currentFps = 60;
let currentFrameTime = 16.6;

function startPerfMetricsLoop() {
  function tick(timestamp) {
    const delta = timestamp - lastFrameTime;
    lastFrameTime = timestamp;
    currentFrameTime = delta;

    metricsFrameCount++;
    if (timestamp - metricsLastSec >= 500) {
      currentFps = Math.round((metricsFrameCount * 1000) / (timestamp - metricsLastSec));
      metricsFrameCount = 0;
      metricsLastSec = timestamp;

      // Update HUD elements
      const fpsEl = $("perf-fps");
      if (fpsEl) {
        fpsEl.textContent = `${currentFps}`;
        fpsEl.style.color = currentFps >= 50 ? "#22C55E" : (currentFps >= 30 ? "#F5A524" : "#EF4444");
      }
      const ftEl = $("perf-frame-time");
      if (ftEl) ftEl.textContent = `${currentFrameTime.toFixed(1)} ms`;

      const canvases = document.querySelectorAll("canvas");
      const cvEl = $("perf-canvases");
      if (cvEl) cvEl.textContent = `${canvases.length}`;

      const rafEl = $("perf-raf-loops");
      if (rafEl) {
        // Query subscriber count from effects if available
        const subCount = (window.S && window.S._activeRafCount !== undefined) ? window.S._activeRafCount : (window._activeEffectsSubscribers || 1);
        rafEl.textContent = `${subCount}`;
      }

      const webglEl = $("perf-webgl-info");
      if (webglEl) {
        if (threeRendererRef && threeRendererRef.info) {
          const calls = threeRendererRef.info.render.calls || 0;
          const tris = threeRendererRef.info.render.triangles || 0;
          webglEl.textContent = `${calls}c / ${tris}t`;
        } else {
          // Never call getContext("webgl") on 2D canvases because a canvas cannot switch context types
          webglEl.textContent = "2D Canvas";
        }
      }
    }

    if (isEnabled) {
      requestAnimationFrame(tick);
    }
  }

  requestAnimationFrame(tick);
}

// Expose on window for programmatic verification
if (typeof window !== "undefined") {
  window.__PLATEOD_PERF__ = {
    isActive: () => isEnabled,
    getLastRunReport: () => lastRunReport,
    getMetrics: () => ({
      fps: currentFps,
      frameTimeMs: currentFrameTime,
      dpr: window.devicePixelRatio || 1,
      canvasesCount: document.querySelectorAll("canvas").length
    }),
    enable: () => {
      try { localStorage.setItem("plateod_perf", "1"); } catch (_) {}
      if (!overlayEl) initPerfOverlay();
    },
    disable: () => {
      try { localStorage.removeItem("plateod_perf"); } catch (_) {}
      if (overlayEl) overlayEl.remove();
      isEnabled = false;
    }
  };
}
