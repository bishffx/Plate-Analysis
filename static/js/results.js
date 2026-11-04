// Blob URL cache for annotated photos
function base64ToBlobUrl(base64) {
  if (!base64 || typeof base64 !== "string" || !base64.startsWith("data:")) return base64;
  try {
    const parts = base64.split(",");
    const mime = parts[0].match(/:(.*?);/)?.[1] || "image/jpeg";
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8 = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    return URL.createObjectURL(new Blob([u8], { type: mime }));
  } catch (_) {
    return base64;
  }
}

function showHeatmapTooltip(clientX, clientY, w, key, isVal, activeCutoff) {
  const tt = $("heat-tooltip");
  if (!tt) return;
  tt.hidden = false;
  tt.style.display = "block";
  tt.style.position = "fixed";
  tt.style.left = `${clientX + 14}px`;
  tt.style.top = `${clientY + 14}px`;
  tt.style.zIndex = "99999";
  tt.style.pointerEvents = "none";
  
  clearChildren(tt);
  const head = el("div", `${w.well} · ${w.role || "Sample"}`, "tooltip-title");
  const odLine = el("div", `OD: ${w.od_cal !== null ? Number(w.od_cal).toFixed(3) : "–"}`);
  const valLine = el("div", isVal ? `${w.value !== null ? Number(w.value).toFixed(1) + "%" : "–"}` : `Value: ${w.value !== null ? fmt(w.value, 2) : "–"}`);
  const clsLine = el("div", `Class: ${w.class || "–"}`, `badge badge-${(w.class || "unknown").toLowerCase()}`);
  tt.appendChild(head);
  tt.appendChild(odLine);
  tt.appendChild(valLine);
  tt.appendChild(clsLine);
}

function hideHeatmapTooltip() {
  const tt = $("heat-tooltip");
  if (!tt) return;
  tt.hidden = true;
  tt.style.display = "none";
}

import { transitionView } from "./interactions.js";
"use strict";

/**
 * PlateOD Results Module (results.js)
 * 
 * - Morphing QC status pill (PASS / FAIL) with check/cross icons
 * - KPI summary cards with countUp animator and sparkline gauges
 * - Class distribution: animated stacked bar + interactive donut chart (canvas)
 * - Linked views: synchronized hovering across heatmap, table, and canvas
 * - Slide-in Well Inspector Drawer with 4x photographic crop, cutoff gauge, and arrow-key walkthrough
 * - Interactive Heatmap: TMB amber ramp for OD, diverging ramp for PI/PP,
 *   draggable cutoff marker with live client re-color & reset, scrub slider, and values/classes toggle
 * - Searchable, multi-column sorted, class-filtered table with row-hover highlights
 * - Compare Mode: pin two wells and inspect Delta OD and Delta Value
 * - Exports: CSV, Copy table (TSV for Excel), Download Heatmap PNG, Print bundle
 */

import { S, TBL } from "./state.js";
import { $, $$, el, clearChildren, fmt, showToast, roundRect } from "./dom.js";
import { countUp, initSpotlight } from "./effects.js";
import { getActiveRunTimer } from "./perf.js";
import { draw } from "./plate-canvas.js";

// Results State
let activeInspectorWell = null;
let lastInspectorFocus = null;
let pinnedCompareWells = [];
let clientCutoffPreview = null;
let scrubThreshold = null;
let heatmapViewMode = "values"; // "values" | "classes"
let activeTableFilter = "ALL";
let highlightedWellId = null;
let highlightedClass = null;

// Color Ramps
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpRgb(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
}
function contrastColor(rgb) {
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 145 ? "#0B0F14" : "#FFFFFF";
}

const TMB_STOPS = [
  { t: 0.0, rgb: [255, 243, 196] }, // #FFF3C4
  { t: 0.35, rgb: [245, 165, 36] }, // #F5A524
  { t: 0.70, rgb: [194, 86, 12] },  // #C2560C
  { t: 1.0, rgb: [91, 30, 8] }      // #5B1E08
];

export function tmbAmberColor(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < TMB_STOPS.length - 1; i++) {
    const s1 = TMB_STOPS[i], s2 = TMB_STOPS[i + 1];
    if (t >= s1.t && t <= s2.t) {
      const segT = (t - s1.t) / (s2.t - s1.t);
      const rgb = lerpRgb(s1.rgb, s2.rgb, segT);
      return { bg: rgbToHex(...rgb), fg: contrastColor(rgb) };
    }
  }
  const last = TMB_STOPS[TMB_STOPS.length - 1].rgb;
  return { bg: rgbToHex(...last), fg: contrastColor(last) };
}

export function divergingColor(val, cutoff, lo, hi) {
  if (val === null || !isFinite(val)) {
    return { bg: "#1E2633", fg: "#8B97A8", isAbove: false };
  }
  const isAbove = val >= cutoff;
  const TEAL = [52, 211, 190];     // #34D3BE (negative)
  const WHITE = [244, 241, 255];   // #F4F1FF (at cutoff)
  const CORAL = [255, 122, 89];    // #FF7A59 (positive)
  let rgb;

  if (val < cutoff) {
    const span = Math.max(1e-4, cutoff - lo);
    const t = Math.max(0, Math.min(1, (val - lo) / span));
    rgb = lerpRgb(TEAL, WHITE, t);
  } else {
    const span = Math.max(1e-4, hi - cutoff);
    const t = Math.max(0, Math.min(1, (val - cutoff) / span));
    rgb = lerpRgb(WHITE, CORAL, t);
  }
  return { bg: rgbToHex(...rgb), fg: contrastColor(rgb), isAbove };
}

export function getClassColor(clsName) {
  const c = (clsName || "").toLowerCase();
  if (c.includes("pos")) return "#FF7A59";
  if (c.includes("neg")) return "#34D3BE";
  if (c.includes("doubt")) return "#F3CF6B";
  if (c.includes("inv")) return "#E27BD0";
  if (c.includes("ctl") || c.includes("control") || c.includes("antigen")) return "#7AA7FF";
  if (c.includes("blank")) return "#A8A3C0";
  return "#8279A8";
}

// -----------------------------------------------------------------------------
// Linked View Synchronization
// -----------------------------------------------------------------------------
export function setHighlightedWell(wellId) {
  highlightedWellId = wellId;
  // Update canvas
  S.highlightWell = wellId;
  draw();

  // Update heatmap cells
  document.querySelectorAll(".heat-cell").forEach((cell) => {
    cell.classList.toggle("linked-highlight", cell.getAttribute("data-well") === wellId);
  });

  // Update table rows
  document.querySelectorAll(".tbl tbody tr").forEach((tr) => {
    tr.classList.toggle("linked-highlight-row", tr.getAttribute("data-well") === wellId);
  });
}

export function setHighlightedClass(clsName) {
  highlightedClass = clsName;
  document.querySelectorAll(".heat-cell").forEach((cell) => {
    if (!clsName) {
      cell.classList.remove("class-dimmed", "class-matched");
    } else {
      const match = cell.getAttribute("data-class") === clsName;
      cell.classList.toggle("class-matched", match);
      cell.classList.toggle("class-dimmed", !match);
    }
  });

  document.querySelectorAll(".tbl tbody tr").forEach((tr) => {
    if (!clsName) {
      tr.classList.remove("class-dimmed", "class-matched");
    } else {
      const match = tr.getAttribute("data-class") === clsName;
      tr.classList.toggle("class-matched", match);
      tr.classList.toggle("class-dimmed", !match);
    }
  });
}

// -----------------------------------------------------------------------------
// Slide-In Well Inspector Drawer
// -----------------------------------------------------------------------------
export function openWellInspector(well) {
  if (!well || !S.last) return;
  if (typeof well === "string") {
    const found = S.last.wells ? S.last.wells.find((w) => w.well.toUpperCase() === well.toUpperCase()) : null;
    if (!found) return;
    well = found;
  }
  activeInspectorWell = well;

  const drawer = $("well-inspector-drawer");
  if (!drawer) return;

  lastInspectorFocus = document.activeElement;
  drawer.setAttribute("aria-hidden", "false");
  drawer.classList.add("open");
  const closeBtn = $("inspector-close-btn");
  if (closeBtn) closeBtn.focus();

  // Well Title & Class
  const titleEl = $("inspector-well-id");
  const classEl = $("inspector-well-class");
  if (titleEl) titleEl.textContent = `Well ${well.well}`;
  if (classEl) {
    classEl.textContent = well.class;
    classEl.className = "b " + (well.class.split(" ")[0]);
  }

  // Metrics
  $("inspector-val-role") && ($("inspector-val-role").textContent = well.role);
  $("inspector-val-intensity") && ($("inspector-val-intensity").textContent = fmt(well.intensity, 2));
  $("inspector-val-od") && ($("inspector-val-od").textContent = fmt(well.od, 4));
  $("inspector-val-od-cal") && ($("inspector-val-od-cal").textContent = fmt(well.od_cal, 4));

  const isPI = S.last.mode === "PI";
  const lblVal = $("inspector-lbl-value");
  const valVal = $("inspector-val-value");
  if (lblVal) lblVal.textContent = isPI ? "Inhibition (PI)" : "Positivity (PP)";
  if (valVal) valVal.textContent = `${fmt(well.value, 1)}%`;

  // Cutoff Gauge
  const cutoff = clientCutoffPreview !== null ? clientCutoffPreview : (S.last.cutoff || 40);
  const cutoffLabel = $("inspector-gauge-cutoff");
  if (cutoffLabel) cutoffLabel.textContent = `Cutoff: ${cutoff}%`;

  const needle = $("inspector-gauge-needle");
  const fill = $("inspector-gauge-fill");
  const cutoffLine = $("inspector-gauge-cutoff-line");

  const pct = Math.max(0, Math.min(100, well.value !== null ? well.value : 0));
  if (needle) needle.style.left = `${pct}%`;
  if (fill) {
    fill.style.width = `${pct}%`;
    fill.style.background = pct >= cutoff ? "linear-gradient(90deg, #F5A524, #FF7A59)" : "linear-gradient(90deg, #34D3BE, #22D3EE)";
  }
  if (cutoffLine) cutoffLine.style.left = `${cutoff}%`;

  // Photographic 4x crop from source plate
  renderInspectorCrop(well);

  // Set highlighted in views
  setHighlightedWell(well.well);
}

function renderInspectorCrop(well) {
  const cropCv = $("inspector-crop-cv");
  if (!cropCv || !S.img || !S.circles) return;

  const ctx = cropCv.getContext("2d");
  if (!ctx) return;
  const cw = cropCv.width;
  const ch = cropCv.height;
  ctx.clearRect(0, 0, cw, ch);

  // Find well coordinates
  const cols = S.last.cols || 12;
  const circleIdx = well.row * cols + well.col;
  const circle = S.circles[circleIdx];
  if (!circle) return;

  const [cx, cy, rad] = circle;
  const zoom = 4;
  const cropW = (cw / zoom);
  const cropH = (ch / zoom);

  ctx.save();
  // Circular mask
  ctx.beginPath();
  ctx.arc(cw / 2, ch / 2, cw / 2 - 2, 0, Math.PI * 2);
  ctx.clip();

  // Draw zoomed portion
  ctx.drawImage(
    S.img,
    cx - cropW / 2, cy - cropH / 2, cropW, cropH,
    0, 0, cw, ch
  );

  // Overlay crosshair
  ctx.strokeStyle = "rgba(245, 165, 36, 0.75)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cw / 2, 0); ctx.lineTo(cw / 2, ch);
  ctx.moveTo(0, ch / 2); ctx.lineTo(cw, ch / 2);
  ctx.stroke();

  // Well ring outline
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cw / 2, ch / 2, rad * zoom, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();

  // Outer border
  ctx.save();
  ctx.strokeStyle = "#F5A524";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cw / 2, ch / 2, cw / 2 - 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function closeWellInspector() {
  const drawer = $("well-inspector-drawer");
  if (drawer) {
    drawer.setAttribute("aria-hidden", "true");
    drawer.classList.remove("open");
  }
  activeInspectorWell = null;
  setHighlightedWell(null);
  if (lastInspectorFocus && typeof lastInspectorFocus.focus === "function") {
    lastInspectorFocus.focus();
    lastInspectorFocus = null;
  }
}

function walkInspectorWell(step) {
  if (!activeInspectorWell || !S.last || !S.last.wells) return;
  const wells = S.last.wells;
  const curIdx = wells.findIndex((w) => w.well === activeInspectorWell.well);
  if (curIdx < 0) return;

  const nextIdx = (curIdx + step + wells.length) % wells.length;
  openWellInspector(wells[nextIdx]);
}

// -----------------------------------------------------------------------------
// Compare Mode
// -----------------------------------------------------------------------------
export function pinWellToCompare(well) {
  if (!well) return;
  if (pinnedCompareWells.length >= 2) {
    pinnedCompareWells.shift(); // keep last 2
  }
  pinnedCompareWells.push(well);
  updateCompareBar();
}

function updateCompareBar() {
  const bar = $("compare-bar");
  if (!bar) return;

  if (pinnedCompareWells.length === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;

  const w1El = $("compare-well-1");
  const w2El = $("compare-well-2");
  const diffEl = $("compare-diff");

  const w1 = pinnedCompareWells[0];
  const w2 = pinnedCompareWells[1] || null;

  if (w1El) w1El.textContent = `Well 1: ${w1.well} (${fmt(w1.od_cal, 3)} OD)`;
  if (w2El) w2El.textContent = w2 ? `Well 2: ${w2.well} (${fmt(w2.od_cal, 3)} OD)` : "Well 2: (Click another well to pin)";

  if (diffEl) {
    if (w1 && w2) {
      const dOD = (w2.od_cal - w1.od_cal);
      const dVal = (w2.value - w1.value);
      diffEl.textContent = `ΔOD: ${dOD >= 0 ? "+" : ""}${dOD.toFixed(3)} | ΔVal: ${dVal >= 0 ? "+" : ""}${dVal.toFixed(1)}%`;
    } else {
      diffEl.textContent = "ΔOD: – | ΔValue: –";
    }
  }
}

// -----------------------------------------------------------------------------
// Interactive Donut Chart (Canvas)
// -----------------------------------------------------------------------------
function renderDonutChart(r) {
  const cv = $("donut-chart-cv");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const w = cv.width;
  const h = cv.height;

  ctx.clearRect(0, 0, w, h);

  const s = r.summary || {};
  const data = [
    { label: "Positive", count: s.positive || 0, color: "#FF7A59" },
    { label: "Negative", count: s.negative || 0, color: "#34D3BE" },
    { label: "Doubtful", count: s.doubtful || 0, color: "#F3CF6B" },
    { label: "Invalid", count: s.invalid || 0, color: "#E27BD0" }
  ].filter((d) => d.count > 0);

  const total = data.reduce((acc, d) => acc + d.count, 0) || 1;
  const centerLabel = $("donut-center-label");
  if (centerLabel) {
    clearChildren(centerLabel);
    centerLabel.appendChild(document.createTextNode(String(total)));
    centerLabel.appendChild(document.createElement("br"));
    centerLabel.appendChild(el("span", "samples"));
  }

  const cx = w / 2;
  const cy = h / 2;
  const rOuter = 62;
  const rInner = 44;

  let startAngle = -Math.PI / 2;

  data.forEach((slice) => {
    const sliceAngle = (slice.count / total) * Math.PI * 2;
    const endAngle = startAngle + sliceAngle;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, startAngle, endAngle);
    ctx.arc(cx, cy, rInner, endAngle, startAngle, true);
    ctx.closePath();

    ctx.fillStyle = slice.color;
    ctx.fill();

    // Segment gap line
    ctx.strokeStyle = "rgba(11, 16, 26, 0.9)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.restore();

    slice.startAngle = startAngle;
    slice.endAngle = endAngle;
    startAngle = endAngle;
  });

  // Interactive hover on donut
  cv.onpointermove = (e) => {
    const rect = cv.getBoundingClientRect();
    const mx = e.clientX - rect.left - cx;
    const my = e.clientY - rect.top - cy;
    const dist = Math.hypot(mx, my);

    if (dist >= rInner && dist <= rOuter) {
      let angle = Math.atan2(my, mx);
      if (angle < -Math.PI / 2) angle += Math.PI * 2;
      const hovered = data.find((d) => angle >= d.startAngle && angle <= d.endAngle);
      if (hovered) {
        setHighlightedClass(hovered.label);
        cv.style.cursor = "pointer";
        return;
      }
    }
    setHighlightedClass(null);
    cv.style.cursor = "default";
  };

  cv.onpointerleave = () => {
    setHighlightedClass(null);
  };
}

// -----------------------------------------------------------------------------
// Stacked Proportion Bar
// -----------------------------------------------------------------------------
function renderSummaryStrip(r) {
  const box = $("summary-strip");
  if (!box) return;
  clearChildren(box);

  const s = r.summary;
  const pos = s.positive || 0, neg = s.negative || 0, dbt = s.doubtful || 0, inv = s.invalid || 0;
  const total = (pos + neg + dbt + inv) || 1;
  const pPos = (pos / total * 100);
  const pNeg = (neg / total * 100);
  const pDbt = (dbt / total * 100);
  const pInv = (inv / total * 100);

  const container = el("div", undefined, "summary-strip-card");
  const head = el("div", undefined, "summary-strip-header");
  const title = el("span", "Sample Distribution Breakdown", "summary-title");
  head.appendChild(title);

  const leg = el("div", undefined, "summary-legend");
  const addLegItem = (label, cnt, pct, cls) => {
    const it = el("div", undefined, "summary-legend-item");
    const dot = el("span", undefined, "summary-dot " + cls);
    it.appendChild(dot);
    const txt = el("span", undefined, "summary-legend-text");
    txt.textContent = `${label}: ${cnt} (${pct.toFixed(1)}%)`;
    it.appendChild(txt);

    it.onpointerenter = () => setHighlightedClass(label);
    it.onpointerleave = () => setHighlightedClass(null);
    leg.appendChild(it);
  };

  addLegItem("Positive", pos, pPos, "Positive");
  addLegItem("Negative", neg, pNeg, "Negative");
  if (dbt > 0) addLegItem("Doubtful", dbt, pDbt, "Doubtful");
  if (inv > 0) addLegItem("Invalid", inv, pInv, "Invalid");

  head.appendChild(leg);
  container.appendChild(head);

  // Stacked proportion bar
  const bar = el("div", undefined, "summary-stacked-bar");
  const addSegment = (pct, cls, titleText, label) => {
    if (pct <= 0) return;
    const seg = el("div", undefined, "summary-bar-segment " + cls);
    seg.style.width = pct + "%";
    seg.title = titleText;
    seg.onpointerenter = () => setHighlightedClass(label);
    seg.onpointerleave = () => setHighlightedClass(null);
    bar.appendChild(seg);
  };

  addSegment(pPos, "Positive", `Positive: ${pPos.toFixed(1)}%`, "Positive");
  addSegment(pNeg, "Negative", `Negative: ${pNeg.toFixed(1)}%`, "Negative");
  addSegment(pDbt, "Doubtful", `Doubtful: ${pDbt.toFixed(1)}%`, "Doubtful");
  addSegment(pInv, "Invalid", `Invalid: ${pInv.toFixed(1)}%`, "Invalid");

  container.appendChild(bar);
  box.appendChild(container);

  renderDonutChart(r);
}

// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Zero-Dependency Client-Side ZIP Generator & Export Utilities
// -----------------------------------------------------------------------------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function calcCrc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export class ZipBuilder {
  constructor() {
    this.entries = [];
  }

  add(name, data) {
    let bytes;
    if (typeof data === "string") {
      bytes = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
      bytes = data;
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else {
      bytes = new Uint8Array(0);
    }
    this.entries.push({ name, bytes, crc: calcCrc32(bytes) });
  }

  buildBlob() {
    const encoder = new TextEncoder();
    const parts = [];
    const centralDirs = [];
    let offset = 0;

    for (const entry of this.entries) {
      const nameBytes = encoder.encode(entry.name);
      const size = entry.bytes.length;

      // Local file header (30 bytes + name)
      const lfh = new Uint8Array(30 + nameBytes.length);
      const lView = new DataView(lfh.buffer);
      lView.setUint32(0, 0x04034b50, true);
      lView.setUint16(4, 10, true);
      lView.setUint16(6, 0, true);
      lView.setUint16(8, 0, true);
      lView.setUint16(10, 0, true);
      lView.setUint16(12, 0, true);
      lView.setUint32(14, entry.crc, true);
      lView.setUint32(18, size, true);
      lView.setUint32(22, size, true);
      lView.setUint16(26, nameBytes.length, true);
      lView.setUint16(28, 0, true);
      lfh.set(nameBytes, 30);

      parts.push(lfh);
      parts.push(entry.bytes);

      // Central directory header (46 bytes + name)
      const cdh = new Uint8Array(46 + nameBytes.length);
      const cView = new DataView(cdh.buffer);
      cView.setUint32(0, 0x02014b50, true);
      cView.setUint16(4, 20, true);
      cView.setUint16(6, 10, true);
      cView.setUint16(8, 0, true);
      cView.setUint16(10, 0, true);
      cView.setUint16(12, 0, true);
      cView.setUint16(14, 0, true);
      cView.setUint32(16, entry.crc, true);
      cView.setUint32(20, size, true);
      cView.setUint32(24, size, true);
      cView.setUint16(28, nameBytes.length, true);
      cView.setUint16(30, 0, true);
      cView.setUint16(32, 0, true);
      cView.setUint16(34, 0, true);
      cView.setUint16(36, 0, true);
      cView.setUint32(38, 0, true);
      cView.setUint32(42, offset, true);
      cdh.set(nameBytes, 46);

      centralDirs.push(cdh);
      offset += lfh.length + size;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const cdh of centralDirs) {
      parts.push(cdh);
      cdSize += cdh.length;
    }

    // End of central directory record (22 bytes)
    const eocd = new Uint8Array(22);
    const eView = new DataView(eocd.buffer);
    eView.setUint32(0, 0x06054b50, true);
    eView.setUint16(4, 0, true);
    eView.setUint16(6, 0, true);
    eView.setUint16(8, this.entries.length, true);
    eView.setUint16(10, this.entries.length, true);
    eView.setUint32(12, cdSize, true);
    eView.setUint32(16, cdOffset, true);
    eView.setUint16(20, 0, true);
    parts.push(eocd);

    return new Blob(parts, { type: "application/zip" });
  }
}

export function createDownloadSvgIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p1.setAttribute("d", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");
  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  poly.setAttribute("points", "7 10 12 15 17 10");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", "12");
  line.setAttribute("y1", "15");
  line.setAttribute("x2", "12");
  line.setAttribute("y2", "3");
  svg.appendChild(p1);
  svg.appendChild(poly);
  svg.appendChild(line);
  return svg;
}

export function drawHeatmapToExportCanvas(r, key = "od_cal", decimals = 3, viewMode = "values", scrubThreshold = null) {
  if (!r || !r.wells) return null;
  const cols = r.cols || 12;
  const rows = r.rows || 8;
  const W = 960;
  const H = 580;
  const dpr = 2;

  const cv = document.createElement("canvas");
  cv.width = W * dpr;
  cv.height = H * dpr;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  // Solid dark background
  ctx.fillStyle = "#0B1017";
  ctx.fillRect(0, 0, W, H);

  // Title & Metadata
  const isVal = key === "value";
  const title = `PlateOD · ${r.assay || "ELISA"} (${isVal ? (r.mode === "PI" ? "% Inhibition (PI)" : "% Positivity (PP)") : "Calibrated Optical Density (OD)"})`;
  ctx.fillStyle = "#F5A524";
  ctx.font = "bold 15px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, 36, 28);

  const dateStr = new Date().toLocaleString();
  const qcText = r.valid ? "QC: PASS" : "QC: REVIEW";
  const channelText = r.channel_used || r.channel || "AUTO";
  const sub = `Generated: ${dateStr}   |   ${qcText}   |   Channel: ${channelText}   |   Mode: ${r.mode || "PP"} (Cutoff: ${r.cutoff || 40}%)`;
  ctx.fillStyle = "#8B949E";
  ctx.font = "11.5px system-ui, -apple-system, sans-serif";
  ctx.fillText(sub, 36, 48);

  const hw = 36;
  const hh = 70;
  const footerH = 46;
  const gridW = W - hw - 36;
  const gridH = H - hh - footerH;
  const cw = gridW / cols;
  const ch = gridH / rows;

  const vs = r.wells.map((w) => w[key]).filter((v) => v !== null && isFinite(v));
  const lo = vs.length ? Math.min(...vs) : 0;
  const hi = vs.length ? Math.max(...vs) : 1;
  const activeCutoff = r.cutoff || 40;

  const m = {};
  r.wells.forEach((w) => { m[w.row + "," + w.col] = w; });

  // Column numbers (1..cols)
  ctx.fillStyle = "#8B949E";
  ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let c = 0; c < cols; c++) {
    ctx.fillText(String(c + 1), hw + c * cw + cw / 2, hh - 12);
  }

  // Row letters (A..rows)
  for (let i = 0; i < rows; i++) {
    ctx.fillText("ABCDEFGHIJKLMNOP"[i], hw - 14, hh + i * ch + ch / 2);
  }

  // Draw cells
  for (let i = 0; i < rows; i++) {
    for (let c = 0; c < cols; c++) {
      const w = m[i + "," + c];
      if (!w) continue;
      const v = w[key];
      const x = hw + c * cw;
      const y = hh + i * ch;

      let bg = "#1E2633";
      let fg = "#6B778C";
      let isAboveCutoff = false;

      if (viewMode === "values") {
        if (v !== null && isFinite(v)) {
          if (!isVal) {
            const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
            const color = tmbAmberColor(t);
            bg = color.bg;
            fg = color.fg;
          } else {
            const color = divergingColor(v, activeCutoff, lo, hi);
            bg = color.bg;
            fg = color.fg;
            if (color.isAbove) isAboveCutoff = true;
          }
        }
      } else {
        bg = getClassColor(w.class);
        fg = "#FFFFFF";
      }

      ctx.fillStyle = bg;
      roundRect(ctx, x + 2, y + 2, cw - 4, ch - 4, 4);
      ctx.fill();

      if (isAboveCutoff) {
        ctx.strokeStyle = "#F5A524";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      if (scrubThreshold !== null && (v === null || v < scrubThreshold)) {
        ctx.fillStyle = "rgba(10, 14, 20, 0.68)";
        roundRect(ctx, x + 2, y + 2, cw - 4, ch - 4, 4);
        ctx.fill();
      }

      // Role dots
      if (w.role === "Positive ctrl" || w.role === "Negative ctrl" || (w.role && w.role.includes("Antigen"))) {
        ctx.fillStyle = "#F5A524";
        ctx.beginPath();
        ctx.arc(x + cw - 7, y + 7, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (w.role === "Blank") {
        ctx.fillStyle = "#38BDF8";
        ctx.beginPath();
        ctx.rect(x + cw - 9, y + 5, 5, 5);
        ctx.fill();
      }

      ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const txt = viewMode === "values" ? fmt(v, decimals) : w.well;
      ctx.fillText(txt, x + cw / 2, y + ch / 2 + 1);
    }
  }

  // Footer Legend
  const legY = H - 22;
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#8B949E";
  ctx.fillText("Controls:  Orange = Control Wells   Blue = Blank Reference", 36, legY);

  ctx.textAlign = "right";
  ctx.fillText(`Range: ${fmt(lo, isVal ? 1 : 2)} to ${fmt(hi, isVal ? 1 : 2)} ${isVal ? "%" : "OD"}`, W - 36, legY);

  return cv;
}

export function downloadActiveHeatmapImage(r, key = "od_cal", decimals = 3, viewMode = "values", scrubThreshold = null) {
  if (!r || !r.wells) {
    showToast("No heatmap data available to download", "warning");
    return;
  }
  const cv = drawHeatmapToExportCanvas(r, key, decimals, viewMode, scrubThreshold);
  if (!cv) return;
  cv.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const modeName = viewMode === "classes" ? "Classes" : (key === "od_cal" ? "OD" : "Values");
    a.download = `PlateOD_Heatmap_${r.assay || "ELISA"}_${modeName}_${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast("Heatmap image downloaded (PNG)", "success");
  }, "image/png");
}

export function downloadResultsTableCsv(r) {
  if (!r || !r.wells || !r.wells.length) {
    showToast("No table data available to download", "warning");
    return;
  }
  const valHeader = r.mode === "PI" ? "PI_Percent" : "PP_Percent";
  const rows = [
    "Well,Row,Column,Role,Raw_Intensity,Image_OD,Calibrated_OD," + valHeader + ",Cutoff,Classification,Note"
  ];
  r.wells.forEach((w) => {
    rows.push([
      w.well,
      w.row + 1,
      w.col + 1,
      `"${w.role || "Sample"}"`,
      w.intensity !== undefined && w.intensity !== null ? Number(w.intensity).toFixed(4) : "",
      w.od !== undefined && w.od !== null ? Number(w.od).toFixed(4) : "",
      w.od_cal !== undefined && w.od_cal !== null ? Number(w.od_cal).toFixed(4) : "",
      w.value !== undefined && w.value !== null ? Number(w.value).toFixed(2) : "",
      r.cutoff !== undefined && r.cutoff !== null ? Number(r.cutoff).toFixed(1) : "",
      `"${w.class || ""}"`,
      `"${w.flag || ""}"`
    ].join(","));
  });
  const blob = new Blob([rows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `PlateOD_Results_Table_${r.assay || r.mode || "ELISA"}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  showToast("Results table downloaded as CSV", "success");
}

export async function downloadAllResultsPackage(r) {
  if (!r || !r.wells || !r.wells.length) {
    showToast("Please run analysis before downloading results", "warning");
    return;
  }

  showToast("Packaging complete results bundle...", "info");

  try {
    const zip = new ZipBuilder();
    const assayName = r.assay || r.mode || "ELISA";
    const dateStr = new Date().toISOString().slice(0, 10);

    // 1. Table CSV
    const valHeader = r.mode === "PI" ? "PI_Percent" : "PP_Percent";
    const csvRows = [
      "Well,Row,Column,Role,Raw_Intensity,Image_OD,Calibrated_OD," + valHeader + ",Cutoff,Classification,Note"
    ];
    r.wells.forEach((w) => {
      csvRows.push([
        w.well,
        w.row + 1,
        w.col + 1,
        `"${w.role || "Sample"}"`,
        w.intensity !== undefined && w.intensity !== null ? Number(w.intensity).toFixed(4) : "",
        w.od !== undefined && w.od !== null ? Number(w.od).toFixed(4) : "",
        w.od_cal !== undefined && w.od_cal !== null ? Number(w.od_cal).toFixed(4) : "",
        w.value !== undefined && w.value !== null ? Number(w.value).toFixed(2) : "",
        r.cutoff !== undefined && r.cutoff !== null ? Number(r.cutoff).toFixed(1) : "",
        `"${w.class || ""}"`,
        `"${w.flag || ""}"`
      ].join(","));
    });
    zip.add(`1_Results_Table_${assayName}.csv`, csvRows.join("\r\n"));

    // 2. Optical Density Heatmap PNG
    const odCv = drawHeatmapToExportCanvas(r, "od_cal", 3, "values");
    if (odCv) {
      const blob = await new Promise((res) => odCv.toBlob(res, "image/png"));
      if (blob) {
        const buf = await blob.arrayBuffer();
        zip.add(`2_Heatmap_OD_${assayName}.png`, new Uint8Array(buf));
      }
    }

    // 3. Values / Diagnostic Heatmap PNG
    const valCv = drawHeatmapToExportCanvas(r, "value", 1, "values");
    if (valCv) {
      const blob = await new Promise((res) => valCv.toBlob(res, "image/png"));
      if (blob) {
        const buf = await blob.arrayBuffer();
        zip.add(`3_Heatmap_Values_${assayName}.png`, new Uint8Array(buf));
      }
    }

    // 4. Annotated Plate Photograph
    if (r.annotated) {
      try {
        let b64 = r.annotated;
        if (b64.includes(",")) b64 = b64.split(",")[1];
        const binaryStr = atob(b64);
        const imgBytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          imgBytes[i] = binaryStr.charCodeAt(i);
        }
        zip.add(`4_Annotated_Plate_${assayName}.jpg`, imgBytes);
      } catch (e) {
        console.warn("Could not add annotated plate to zip", e);
      }
    }

    // 5. Summary Report Text
    const s = r.summary || {};
    const reportText = [
      "==================================================",
      " PLATEOD ANALYSIS LABORATORY REPORT",
      "==================================================",
      `Protocol / Assay:  ${assayName}`,
      `Date / Timestamp:  ${new Date().toLocaleString()}`,
      `QC Validation:     ${r.valid ? "PASS" : "REVIEW / ALERTS"}`,
      `Channel Used:      ${r.channel_used || r.channel || "AUTO"}`,
      `Wavelength:        ${r.wavelength || r.channel_param || "492nm"}`,
      `Flat-Field:        ${r.flat_field_applied ? "Enabled" : "Disabled"}`,
      `Diagnostic Mode:   ${r.mode || "PP"}`,
      `Cutoff Threshold:  ${r.cutoff || 40}%`,
      "",
      "--- CONTROL WELL VALUES ---",
      `Blank Mean:        ${s.blank_od !== undefined ? Number(s.blank_od).toFixed(4) : "N/A"} OD`,
      `Positive Control:  ${s.pos_od !== undefined ? Number(s.pos_od).toFixed(4) : "N/A"} OD`,
      `Negative Control:  ${s.neg_od !== undefined ? Number(s.neg_od).toFixed(4) : "N/A"} OD`,
      `Delta Signal:      ${s.delta_od !== undefined ? Number(s.delta_od).toFixed(4) : "N/A"} OD`,
      "",
      "--- SAMPLE CLASSIFICATION COUNTS ---",
      `Positive Wells:    ${s.positive ?? 0}`,
      `Negative Wells:    ${s.negative ?? 0}`,
      `Doubtful Wells:    ${s.doubtful ?? 0}`,
      `Invalid Wells:     ${s.invalid ?? 0}`,
      `Total Wells:       ${r.wells.length}`,
      "",
      "--- WARNINGS / QC CHECKS ---",
      ...(r.warnings && r.warnings.length ? r.warnings.map((w) => `• ${w}`) : ["No QC warnings detected."]),
      "",
      "Generated by PlateOD · Automated Microplate Photometry"
    ].join("\r\n");
    zip.add(`5_Summary_Report_${assayName}.txt`, reportText);

    const zipBlob = zip.buildBlob();
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PlateOD_Complete_Results_${assayName}_${dateStr}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast("Complete results package downloaded (ZIP)", "success");
  } catch (err) {
    console.error("Universal download failed", err);
    showToast("Universal download failed: " + err.message, "error");
  }
}

// Interactive Table View
// -----------------------------------------------------------------------------
function renderTable(r) {
  const wrap = el("div", undefined, "tbl-container");
  const tb = el("div", undefined, "tbl-toolbar");

  // Search box
  const sb = el("div", undefined, "tbl-search-box");
  const sinp = el("input");
  sinp.type = "text";
  sinp.id = "tbl-filter";
  sinp.placeholder = "Filter by well (e.g. A1, B)...";
  sinp.setAttribute("aria-label", "Filter wells by name");
  sinp.value = TBL.search || "";
  sinp.oninput = () => {
    TBL.search = sinp.value.trim();
    refreshRows();
  };
  sb.appendChild(sinp);
  tb.appendChild(sb);

  // Filter Chips (All, Positive, Negative, Doubtful, Invalid, Controls, Flagged)
  const chipsWrap = el("div", undefined, "tbl-filter-chips");
  const chipFilters = [
    { id: "ALL", label: "All" },
    { id: "Positive", label: "Positive" },
    { id: "Negative", label: "Negative" },
    { id: "Doubtful", label: "Doubtful" },
    { id: "Invalid", label: "Invalid" },
    { id: "Control", label: "Controls" },
    { id: "Flagged", label: "Flagged" }
  ];

  chipFilters.forEach((f) => {
    const chip = el("button", f.label, "tbl-chip-btn" + (activeTableFilter === f.id ? " active" : ""));
    chip.type = "button";
    chip.onclick = () => {
      activeTableFilter = f.id;
      chipsWrap.querySelectorAll(".tbl-chip-btn").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      refreshRows();
    };
    chipsWrap.appendChild(chip);
  });
  tb.appendChild(chipsWrap);

  const countSpan = el("span", "", "tbl-count");
  tb.appendChild(countSpan);

  // Dedicated Table Download Button
  const btnDlTable = el("button", undefined, "sec btn-xs btn-table-download");
  btnDlTable.id = "btn-download-table-section";
  btnDlTable.type = "button";
  btnDlTable.title = "Download complete results table as CSV";
  btnDlTable.appendChild(createDownloadSvgIcon());
  btnDlTable.appendChild(el("span", "Download Table (CSV)"));
  btnDlTable.onclick = () => {
    downloadResultsTableCsv(r);
  };
  tb.appendChild(btnDlTable);

  wrap.appendChild(tb);

  const tblWrap = el("div", undefined, "tbl");
  const t = el("table");
  const thead = el("thead"), thr = el("tr");

  const cols = [
    { key: "well", label: "Well", num: false },
    { key: "role", label: "Role", num: false },
    { key: "intensity", label: "Intensity", num: true },
    { key: "od", label: "Image OD", num: true },
    { key: "od_cal", label: "Calibrated OD", num: true },
    { key: "value", label: r.mode === "PI" ? "PI %" : "PP %", num: true },
    { key: "class", label: "Class", num: false },
    { key: "flag", label: "Note", num: false }
  ];

  cols.forEach((c) => {
    const th = el("th", c.label, "sortable" + (c.num ? " num-col" : ""));
    const sIcon = el("span", " ▲", "sort-icon");
    if (TBL.sortCol === c.key) {
      th.classList.add("sort-active");
      sIcon.textContent = TBL.sortAsc ? " ▲" : " ▼";
    }
    th.appendChild(sIcon);
    th.onclick = () => {
      if (TBL.sortCol === c.key) {
        TBL.sortAsc = !TBL.sortAsc;
      } else {
        TBL.sortCol = c.key;
        TBL.sortAsc = true;
      }
      refreshRows();
    };
    thr.appendChild(th);
  });
  thead.appendChild(thr);
  t.appendChild(thead);

  const tbody = el("tbody");
  t.appendChild(tbody);
  tblWrap.appendChild(t);
  wrap.appendChild(tblWrap);

  function refreshRows() {
    clearChildren(tbody);

    let list = r.wells.filter((w) => {
      if (activeTableFilter === "Flagged" && (!w.flag || w.flag === "")) return false;
      if (activeTableFilter === "Control" && !w.role.toLowerCase().includes("ctrl") && !w.role.toLowerCase().includes("blank") && !w.role.toLowerCase().includes("antigen")) return false;
      if (activeTableFilter !== "ALL" && activeTableFilter !== "Flagged" && activeTableFilter !== "Control") {
        if (!w.class.toLowerCase().includes(activeTableFilter.toLowerCase())) return false;
      }
      if (!TBL.search) return true;
      return w.well.toUpperCase().includes(TBL.search.toUpperCase());
    });

    countSpan.textContent = `Showing ${list.length} of ${r.wells.length} wells`;

    list.sort((a, b) => {
      let va = a[TBL.sortCol], vb = b[TBL.sortCol];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      let diff = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return TBL.sortAsc ? diff : -diff;
    });

    const PAGE_SIZE = 40;
    const visibleList = list.slice(0, PAGE_SIZE);

    visibleList.forEach((x) => {
      const tr = el("tr");
      tr.setAttribute("data-well", x.well);
      tr.setAttribute("data-class", x.class);

      tr.appendChild(el("td", x.well));
      tr.appendChild(el("td", x.role));
      tr.appendChild(el("td", fmt(x.intensity, 2), "num-col"));
      tr.appendChild(el("td", fmt(x.od, 4), "num-col"));
      tr.appendChild(el("td", fmt(x.od_cal, 4), "num-col"));
      tr.appendChild(el("td", fmt(x.value, 1), "num-col"));

      const tdClass = el("td");
      const badge = el("span", undefined, "b " + x.class.split(" ")[0]);
      badge.appendChild(el("span", undefined, "b-dot"));
      badge.appendChild(document.createTextNode(x.class));
      tdClass.appendChild(badge);
      tr.appendChild(tdClass);

      tr.appendChild(el("td", x.flag || ""));

      // Linked hover & click
      tr.onpointerenter = () => setHighlightedWell(x.well);
      tr.onpointerleave = () => setHighlightedWell(null);
      tr.onclick = () => openWellInspector(x);

      tbody.appendChild(tr);
    });

    if (list.length > PAGE_SIZE) {
      const moreTr = el("tr", undefined, "table-more-row");
      const moreTd = el("td");
      moreTd.colSpan = 8;
      moreTd.style.textAlign = "center";
      moreTd.style.padding = "8px";
      const moreBtn = el("button", `Show all ${list.length} wells (${PAGE_SIZE} shown)`, "sec btn-xs");
      moreBtn.onclick = (e) => {
        e.preventDefault();
        moreTr.remove();
        list.slice(PAGE_SIZE).forEach((x) => {
          const tr = el("tr");
          tr.setAttribute("data-well", x.well);
          tr.setAttribute("data-class", x.class);
          tr.appendChild(el("td", x.well));
          tr.appendChild(el("td", x.role));
          tr.appendChild(el("td", fmt(x.intensity, 2), "num-col"));
          tr.appendChild(el("td", fmt(x.od, 4), "num-col"));
          tr.appendChild(el("td", fmt(x.od_cal, 4), "num-col"));
          tr.appendChild(el("td", fmt(x.value, 1), "num-col"));
          const tdClass = el("td");
          const badge = el("span", undefined, "b " + x.class.split(" ")[0]);
          badge.appendChild(el("span", undefined, "b-dot"));
          badge.appendChild(document.createTextNode(x.class));
          tdClass.appendChild(badge);
          tr.appendChild(tdClass);
          tr.appendChild(el("td", x.flag || ""));
          tr.onpointerenter = () => setHighlightedWell(x.well);
          tr.onpointerleave = () => setHighlightedWell(null);
          tr.onclick = () => openWellInspector(x);
          tbody.appendChild(tr);
        });
      };
      moreTd.appendChild(moreBtn);
      moreTr.appendChild(moreTd);
      tbody.appendChild(moreTr);
    }
  }

  refreshRows();
  return wrap;
}

// -----------------------------------------------------------------------------
// Interactive Heatmap View
// -----------------------------------------------------------------------------
function heat(r, key, nd) {
  const rows = Math.max(...r.wells.map((w) => w.row)) + 1;
  const cols = Math.max(...r.wells.map((w) => w.col)) + 1;
  const isVal = (key === "value");
  const serverCutoff = r.cutoff || (r.mode === "PP" ? 40 : 65);
  const activeCutoff = clientCutoffPreview !== null ? clientCutoffPreview : serverCutoff;

  const vs = r.wells.map((w) => w[key]).filter((v) => v !== null && isFinite(v));
  const lo = vs.length ? Math.min(...vs) : 0;
  const hi = vs.length ? Math.max(...vs) : 1;

  const container = el("div", undefined, "heat-container");

  // Controls bar: Values/Classes toggle & Value Scrubber
  const cBar = el("div", undefined, "heat-controls-bar");

  // Toggle Values / Classes
  const toggleGroup = el("div", undefined, "segmented-control heat-mode-toggle");
  const btnVals = el("button", "Values", "seg-btn" + (heatmapViewMode === "values" ? " active" : ""));
  const btnCls = el("button", "Classes", "seg-btn" + (heatmapViewMode === "classes" ? " active" : ""));
  btnVals.onclick = () => { heatmapViewMode = "values"; renderResults(r); };
  btnCls.onclick = () => { heatmapViewMode = "classes"; renderResults(r); };
  toggleGroup.appendChild(btnVals);
  toggleGroup.appendChild(btnCls);
  cBar.appendChild(toggleGroup);

  // Threshold scrub slider
  const scrubWrap = el("div", undefined, "heat-scrub-wrap");
  scrubWrap.appendChild(el("span", "Highlight ≥", "scrub-label"));
  const scrubSlider = el("input");
  scrubSlider.type = "range";
  scrubSlider.min = lo;
  scrubSlider.max = hi;
  scrubSlider.step = ((hi - lo) / 50).toFixed(3);
  scrubSlider.value = scrubThreshold !== null ? scrubThreshold : lo;
  const scrubValText = el("span", scrubThreshold !== null ? fmt(scrubThreshold, 2) : "All", "scrub-val-text");

  let drawCanvasFn = null;
  scrubSlider.oninput = () => {
    scrubThreshold = parseFloat(scrubSlider.value);
    scrubValText.textContent = fmt(scrubThreshold, 2);
    if (drawCanvasFn) drawCanvasFn();
  };
  scrubWrap.appendChild(scrubSlider);
  scrubWrap.appendChild(scrubValText);

  const resetScrubBtn = el("button", "Clear", "sec btn-xs");
  resetScrubBtn.onclick = () => {
    scrubThreshold = null;
    scrubSlider.value = lo;
    scrubValText.textContent = "All";
    if (drawCanvasFn) drawCanvasFn();
  };
  scrubWrap.appendChild(resetScrubBtn);
  cBar.appendChild(scrubWrap);

  // Dedicated Heatmap Download Button inside Heatmap Section
  const btnDlHeatmap = el("button", undefined, "sec btn-xs btn-heatmap-download");
  btnDlHeatmap.id = "btn-download-heatmap-section";
  btnDlHeatmap.type = "button";
  btnDlHeatmap.title = "Download active heatmap image (PNG)";
  btnDlHeatmap.appendChild(createDownloadSvgIcon());
  btnDlHeatmap.appendChild(el("span", "Download Heatmap"));
  btnDlHeatmap.onclick = () => {
    downloadActiveHeatmapImage(r, key, nd, heatmapViewMode, scrubThreshold);
  };
  cBar.appendChild(btnDlHeatmap);

  container.appendChild(cBar);

  // SINGLE-CANVAS HEATMAP (Step B.5)
  const g = el("div", undefined, "heat-canvas-wrap");
  g.id = "active-heatmap-grid";

  const cv = el("canvas", undefined, "active-heatmap-canvas");
  cv.id = "active-heatmap-canvas";
  g.appendChild(cv);
  container.appendChild(g);

  const W = 620;
  const H = 340;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  cv.style.width = "100%";
  cv.style.maxWidth = `${W}px`;
  cv.style.height = `${H}px`;

  const ctx = cv.getContext("2d");
  if (ctx) ctx.scale(dpr, dpr);

  const hw = 28;
  const hh = 24;
  const cw = (W - hw) / cols;
  const ch = (H - hh) / rows;
  let hoveredWell = null;

  const m = {};
  r.wells.forEach((w) => { m[w.row + "," + w.col] = w; });

  function drawCanvas() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#8B949E";

    for (let c = 0; c < cols; c++) {
      ctx.fillText(String(c + 1), hw + c * cw + cw / 2, hh / 2);
    }
    for (let i = 0; i < rows; i++) {
      ctx.fillText("ABCDEFGHIJKLMNOP"[i], hw / 2, hh + i * ch + ch / 2);
    }

    for (let i = 0; i < rows; i++) {
      for (let c = 0; c < cols; c++) {
        const w = m[i + "," + c];
        if (!w) continue;
        const v = w[key];
        const x = hw + c * cw;
        const y = hh + i * ch;

        let bg = "#1E2633";
        let fg = "#6B778C";
        let isAboveCutoff = false;

        if (heatmapViewMode === "values") {
          if (v !== null && isFinite(v)) {
            if (!isVal) {
              const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
              const color = tmbAmberColor(t);
              bg = color.bg;
              fg = color.fg;
            } else {
              const color = divergingColor(v, activeCutoff, lo, hi);
              bg = color.bg;
              fg = color.fg;
              if (color.isAbove) isAboveCutoff = true;
            }
          }
        } else {
          bg = getClassColor(w.class);
          fg = "#FFFFFF";
        }

        ctx.fillStyle = bg;
        roundRect(ctx, x + 2, y + 2, cw - 4, ch - 4, 4);
        ctx.fill();

        if (isAboveCutoff) {
          ctx.strokeStyle = "#F5A524";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        if (hoveredWell === w.well) {
          ctx.strokeStyle = "#38BDF8";
          ctx.lineWidth = 2.0;
          ctx.stroke();
        }

        if (scrubThreshold !== null && (v === null || v < scrubThreshold)) {
          ctx.fillStyle = "rgba(10, 14, 20, 0.68)";
          roundRect(ctx, x + 2, y + 2, cw - 4, ch - 4, 4);
          ctx.fill();
        }

        if (w.role === "Positive ctrl" || w.role === "Negative ctrl" || (w.role && w.role.includes("Antigen"))) {
          ctx.fillStyle = "#F5A524";
          ctx.beginPath();
          ctx.arc(x + cw - 7, y + 7, 3, 0, Math.PI * 2);
          ctx.fill();
        } else if (w.role === "Blank") {
          ctx.fillStyle = "#38BDF8";
          ctx.beginPath();
          ctx.rect(x + cw - 9, y + 5, 5, 5);
          ctx.fill();
        }

        ctx.font = "bold 10.5px system-ui, -apple-system, sans-serif";
        ctx.fillStyle = fg;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const txt = heatmapViewMode === "values" ? fmt(v, nd) : w.well;
        ctx.fillText(txt, x + cw / 2, y + ch / 2 + 1);
      }
    }
  }

  drawCanvasFn = drawCanvas;
  drawCanvas();

  cv.onpointermove = (e) => {
    const rect = cv.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    if (mx >= hw && my >= hh) {
      const c = Math.floor((mx - hw) / cw);
      const r = Math.floor((my - hh) / ch);
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        const w = m[r + "," + c];
        if (w) {
          cv.style.cursor = "pointer";
          if (hoveredWell !== w.well) {
            hoveredWell = w.well;
            setHighlightedWell(w.well);
            drawCanvas();
          }
          showHeatmapTooltip(e.clientX, e.clientY, w, key, isVal, activeCutoff);
          return;
        }
      }
    }
    cv.style.cursor = "default";
    if (hoveredWell !== null) {
      hoveredWell = null;
      setHighlightedWell(null);
      drawCanvas();
    }
    hideHeatmapTooltip();
  };

  cv.onpointerleave = () => {
    if (hoveredWell !== null) {
      hoveredWell = null;
      setHighlightedWell(null);
      drawCanvas();
    }
    hideHeatmapTooltip();
  };

  cv.onclick = (e) => {
    const rect = cv.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    if (mx >= hw && my >= hh) {
      const c = Math.floor((mx - hw) / cw);
      const r = Math.floor((my - hh) / ch);
      const w = m[r + "," + c];
      if (w) openWellInspector(w);
    }
  };

  // Wire PNG export button directly to high-res canvas
  const btnDownloadPng = $("btn-download-heatmap-png");
  if (btnDownloadPng) {
    btnDownloadPng.onclick = () => {
      const a = document.createElement("a");
      a.download = `PlateOD_Heatmap_${r.assay || "ELISA"}.png`;
      a.href = cv.toDataURL("image/png");
      a.click();
    };
  }

  // Vertical Colour Legend with Draggable Cutoff Slider
  const leg = el("div", undefined, "heat-legend");
  leg.appendChild(el("span", isVal ? (r.mode === "PI" ? "PI %" : "PP %") : "OD", "legend-title"));
  leg.appendChild(el("span", fmt(hi, isVal ? 1 : 2), "legend-val"));

  const bWrap = el("div", undefined, "legend-bar-wrap");
  const bar = el("div", undefined, "legend-bar");

  if (!isVal) {
    bar.style.background = "linear-gradient(180deg, #5B1E08 0%, #C2560C 33%, #F5A524 67%, #FFF3C4 100%)";
  } else {
    const cutPos = hi > lo ? Math.max(0, Math.min(100, (1 - (activeCutoff - lo) / (hi - lo)) * 100)) : 50;
    bar.style.background = `linear-gradient(180deg, #FF7A59 0%, #F4F1FF ${cutPos}%, #34D3BE 100%)`;

    const cMark = el("div", undefined, "legend-cutoff-draggable");
    cMark.style.top = cutPos + "%";
    cMark.title = "Drag to adjust diagnostic cutoff preview";

    const labelSpan = el("span", `Cutoff: ${fmt(activeCutoff, 1)}%`, "cutoff-drag-label");
    cMark.appendChild(labelSpan);
    bWrap.appendChild(cMark);

    let isDraggingCutoff = false;
    cMark.onpointerdown = (e) => {
      e.preventDefault();
      isDraggingCutoff = true;
      cMark.setPointerCapture(e.pointerId);
    };

    cMark.onpointermove = (e) => {
      if (!isDraggingCutoff) return;
      const rect = bWrap.getBoundingClientRect();
      const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const newCutoff = Math.round(hi - normY * (hi - lo));
      clientCutoffPreview = newCutoff;
      renderResults(r);
    };

    const stopCutoffDrag = () => { isDraggingCutoff = false; };
    cMark.onpointerup = stopCutoffDrag;
    cMark.onpointercancel = stopCutoffDrag;
  }

  bWrap.appendChild(bar);
  leg.appendChild(bWrap);
  leg.appendChild(el("span", fmt(lo, isVal ? 1 : 2), "legend-val"));

  if (isVal && clientCutoffPreview !== null && clientCutoffPreview !== serverCutoff) {
    const resetWrap = el("div", undefined, "legend-reset-wrap");
    const previewTag = el("span", "Preview (not saved)", "cutoff-preview-tag");
    const resetBtn = el("button", "Reset", "sec btn-xs");
    resetBtn.onclick = () => {
      clientCutoffPreview = null;
      renderResults(r);
    };
    resetWrap.appendChild(previewTag);
    resetWrap.appendChild(resetBtn);
    leg.appendChild(resetWrap);
  }

  container.appendChild(leg);
  return container;
}

function updateHeatmapScrubHighlights(threshold) {
  document.querySelectorAll(".heat-cell").forEach((cell) => {
    if (threshold === null) {
      cell.classList.remove("scrub-dimmed", "scrub-highlighted");
      return;
    }
    const val = parseFloat(cell.getAttribute("data-val"));
    if (!isNaN(val) && val >= threshold) {
      cell.classList.add("scrub-highlighted");
      cell.classList.remove("scrub-dimmed");
    } else {
      cell.classList.add("scrub-dimmed");
      cell.classList.remove("scrub-highlighted");
    }
  });
}

// -----------------------------------------------------------------------------
// Annotated View
// -----------------------------------------------------------------------------
function annotatedView(r) {
  const wrap = el("div", undefined, "annot-container");
  const frame = el("div", undefined, "annot-frame");
  const img = el("img");
  img.id = "annot";
  const blobUrl = base64ToBlobUrl(r.annotated);
  img.src = blobUrl;
  img.alt = "Annotated Plate";
  if (typeof img.decode === "function") {
    img.decoding = "async";
    img.decode().catch(() => {});
  }
  frame.appendChild(img);

  frame.onclick = () => {
    const lb = $("lightbox");
    const lbImg = $("lightbox-img");
    if (lb && lbImg) {
      lbImg.src = r.annotated;
      lb.hidden = false;
    }
  };
  wrap.appendChild(frame);

  const leg = el("div", undefined, "annot-legend");
  leg.appendChild(el("span", "Classes:", "annot-legend-title"));
  ["Positive", "Negative", "Doubtful", "Control", "Blank", "Invalid"].forEach((cls) => {
    const tag = el("span", cls, "b " + cls);
    tag.onpointerenter = () => setHighlightedClass(cls);
    tag.onpointerleave = () => setHighlightedClass(null);
    leg.appendChild(tag);
  });
  wrap.appendChild(leg);

  return wrap;
}

// -----------------------------------------------------------------------------
// Print Bundle Builder
// -----------------------------------------------------------------------------
function renderPrintBundle(r) {
  const p = $("print-bundle");
  if (!p) return;
  clearChildren(p);

  const head = el("div", undefined, "print-header");
  const left = el("div");
  const title = el("h1", "PlateOD · Quantitative Microplate Analysis Report", "print-title");
  const meta = el("div", undefined, "print-meta");
  meta.textContent = `Generated: ${new Date().toLocaleString()} · Laboratory Scientific Edition`;
  left.appendChild(title);
  left.appendChild(meta);
  head.appendChild(left);
  p.appendChild(head);

  const sGrid = el("div", undefined, "print-settings-grid");
  const addSetting = (k, val) => {
    const item = el("div");
    item.appendChild(el("strong", k + ": "));
    item.appendChild(el("span", String(val)));
    sGrid.appendChild(item);
  };
  addSetting("Protocol", r.assay || r.mode);
  addSetting("Dimensions", `${$("rows")?.value || 8} × ${$("cols")?.value || 12}`);
  addSetting("Channel", $("channel")?.value || "B");
  addSetting("Cutoff Threshold", `${r.cutoff}%`);
  addSetting("QC Evaluation", r.valid ? "PASS" : "FAIL");
  p.appendChild(sGrid);

  p.appendChild(el("div", "Photometric Heatmaps (OD & Positivity/Inhibition)", "print-section-title"));
  const hmRow = el("div", undefined, "print-heatmaps-row");
  hmRow.appendChild(heat(r, "od_cal", 3));
  hmRow.appendChild(heat(r, "value", 1));
  p.appendChild(hmRow);

  p.appendChild(el("div", "Well Quantification & Classification Table", "print-section-title print-page-break"));
  p.appendChild(renderTable(r));
}

// -----------------------------------------------------------------------------
// Main Render Entry
// -----------------------------------------------------------------------------
export function renderResults(r) {
  const perfTimer = getActiveRunTimer();
  if (perfTimer) perfTimer.markRenderKpiStart();
  const res = $("results");
  if (!res) return;
  res.hidden = false;

  // 1. Morphing QC Pill (PASS = teal check, FAIL = red cross)
  const qcPill = $("qc-pill");
  const txt = $("qc-pill-text");
  if (qcPill) {
    qcPill.className = "qc-status-pill " + (r.valid ? "qc-pass" : "qc-fail");
    clearChildren(qcPill);

    const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    iconSvg.setAttribute("width", "16");
    iconSvg.setAttribute("height", "16");
    iconSvg.setAttribute("viewBox", "0 0 24 24");
    iconSvg.setAttribute("fill", "none");
    iconSvg.setAttribute("stroke", "currentColor");
    iconSvg.setAttribute("stroke-width", "2.8");
    iconSvg.setAttribute("stroke-linecap", "round");
    iconSvg.setAttribute("stroke-linejoin", "round");

    if (r.valid) {
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      poly.setAttribute("points", "20 6 9 17 4 12");
      iconSvg.appendChild(poly);
    } else {
      const l1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l1.setAttribute("x1", "18"); l1.setAttribute("y1", "6"); l1.setAttribute("x2", "6"); l1.setAttribute("y2", "18");
      const l2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l2.setAttribute("x1", "6"); l2.setAttribute("y1", "6"); l2.setAttribute("x2", "18"); l2.setAttribute("y2", "18");
      iconSvg.appendChild(l1); iconSvg.appendChild(l2);
    }

    qcPill.appendChild(iconSvg);
    const labelSpan = el("span", r.valid ? "PASS" : "FAIL");
    labelSpan.id = "qc-pill-text";
    qcPill.appendChild(labelSpan);
  }

  // Header meta tags
  const metaAssay = $("results-meta-assay");
  if (metaAssay) metaAssay.textContent = r.assay || (r.mode === "PI" ? "Competitive (PI)" : "Indirect (PP)");
  const metaTime = $("results-meta-time");
  if (metaTime) metaTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const metaChan = $("results-meta-channel");
  if (metaChan) {
    const ch = r.channel_used || r.channel || "B";
    metaChan.textContent = r.auto_channel ? `${ch} (Auto)` : ch;
  }

  // 2. KPI Cards with count-up animator and sparkline gauges
  const s = r.summary;
  const st = $("stats");
  if (st) {
    clearChildren(st);

    const addKpi = (label, val, iconName, cls = "", targetNum = null, gaugePct = null) => {
      const card = el("div", undefined, "stat kpi-card" + (cls ? " " + cls : ""));
      const ic = el("div", undefined, "kpi-icon-wrap");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");

      if (iconName === "shield") {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z");
        svg.appendChild(path);
      } else {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", "10");
        svg.appendChild(circle);
      }
      ic.appendChild(svg);
      card.appendChild(ic);

      const b = el("b", val, "kpi-value");
      if (targetNum !== null) {
        countUp(b, targetNum, 700);
      }
      card.appendChild(b);

      const lbl = el("span", label, "kpi-label");
      card.appendChild(lbl);

      // Tiny sparkline / progress gauge
      if (gaugePct !== null) {
        const gWrap = el("div", undefined, "kpi-sparkline");
        const gFill = el("div", undefined, "kpi-sparkline-fill");
        gFill.style.width = `${Math.max(4, Math.min(100, gaugePct))}%`;
        gWrap.appendChild(gFill);
        card.appendChild(gWrap);
      }

      initSpotlight(card);
      st.appendChild(card);
    };

    addKpi("Plate QC", r.valid ? "PASS" : "FAIL", "shield", r.valid ? "qc-pass" : "qc-fail", null, r.valid ? 100 : 25);

    if (r.assay === "SPCE" || (r.mode === "PI" && s.pos_od === null)) {
      addKpi("Antigen (max) OD", fmt(s.neg_od, 3) + " OD", "circle", "", null, 85);
    } else {
      addKpi("Positive ctrl OD", fmt(s.pos_od, 3) + " OD", "circle", "", null, 80);
      addKpi("Negative ctrl OD", fmt(s.neg_od, 3) + " OD", "circle", "", null, 25);
    }
    addKpi("Blank baseline OD", fmt(s.blank_od, 3) + " OD", "circle", "", null, 15);

    const totalSamples = (s.positive || 0) + (s.negative || 0) + (s.doubtful || 0) + (s.invalid || 0) || 1;
    addKpi("Positive Wells", String(s.positive || 0), "circle", "Positive", s.positive || 0, ((s.positive || 0) / totalSamples) * 100);
    addKpi("Negative Wells", String(s.negative || 0), "circle", "Negative", s.negative || 0, ((s.negative || 0) / totalSamples) * 100);
    if ((s.doubtful || 0) > 0) {
      addKpi("Doubtful Wells", String(s.doubtful), "circle", "Doubtful", s.doubtful, ((s.doubtful || 0) / totalSamples) * 100);
    }
  }

  // 3. Distribution Strip & Donut Chart
  renderSummaryStrip(r);
  draw();
  if (perfTimer) perfTimer.markRenderKpiEnd();

  // 4. Tabs & Active View
  const names = [
    ["table", "Table"],
    ["od", "OD heatmap"],
    ["val", r.mode === "PI" ? "PI % heatmap" : "PP % heatmap"],
    ["ann", "Annotated plate"]
  ];

  const t = $("tabs");
  if (t) {
    clearChildren(t);
    t.setAttribute("role", "tablist");
    t.setAttribute("aria-label", "Results views");
    names.forEach(([k, n]) => {
      const b = el("button", n, "tab-btn" + (k === S.tab ? " on" : ""));
      b.id = "tab-" + k;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", k === S.tab ? "true" : "false");
      b.setAttribute("aria-controls", "view");
      b.onclick = () => {
        transitionView(() => {
          S.tab = k;
          renderResults(r);
        });
      };
      t.appendChild(b);
    });
  }

  const v = $("view");
  if (v) {
    clearChildren(v);
    v.setAttribute("role", "tabpanel");
    v.setAttribute("aria-labelledby", "tab-" + S.tab);
    v.setAttribute("tabindex", "0");
    if (S.tab === "table") {
      if (perfTimer) perfTimer.markRenderTableStart();
      v.appendChild(renderTable(r));
      if (perfTimer) perfTimer.markRenderTableEnd();
    } else if (S.tab === "od") {
      if (perfTimer) perfTimer.markRenderHeatmapStart();
      v.appendChild(heat(r, "od_cal", 3));
      if (perfTimer) perfTimer.markRenderHeatmapEnd();
    } else if (S.tab === "val") {
      if (perfTimer) perfTimer.markRenderHeatmapStart();
      v.appendChild(heat(r, "value", 1));
      if (perfTimer) perfTimer.markRenderHeatmapEnd();
    } else {
      if (perfTimer) perfTimer.markRenderAnnotatedStart();
      v.appendChild(annotatedView(r));
      if (perfTimer) perfTimer.markRenderAnnotatedEnd();
    }
  }

  // Defer building hidden print bundle until print is actually requested
  if (typeof window !== "undefined") {
    if (!window.__plateod_print_listener) {
      window.__plateod_print_listener = true;
      window.addEventListener("beforeprint", () => {
        if (S.last) renderPrintBundle(S.last);
      });
    }
  }

  if (typeof window !== "undefined" && window.updateWorkspaceScroll) {
    window.updateWorkspaceScroll();
  }
  if (perfTimer) perfTimer.finish();
}

// -----------------------------------------------------------------------------
// Interactive Toolbar & Global Events
// -----------------------------------------------------------------------------
export function initResultsControls() {
  const btnPrint = $("btn-print-report");
  if (btnPrint) btnPrint.onclick = () => window.print();

  // Universal Download Button (All tables, heatmaps, annotated plate, report in ZIP)
  const btnUniversal = $("btn-universal-download");
  if (btnUniversal) {
    btnUniversal.onclick = () => {
      if (!S.last) {
        showToast("Please run analysis before downloading results", "warning");
        return;
      }
      downloadAllResultsPackage(S.last);
    };
  }

  // CSV Export
  const handleExportCsv = () => {
    if (!S.last) {
      showToast("Please run analysis before exporting CSV", "warning");
      return;
    }
    const q = S.last;
    if (!q.wells || !q.wells.length) {
      showToast("No well data available to export", "warning");
      return;
    }
    const rows = ["well,role,intensity,image_od,calibrated_od," + (q.mode === "PI" ? "PI_percent" : "PP_percent") + ",class,note"];
    q.wells.forEach((w) => {
      rows.push([w.well, w.role, w.intensity ?? "", w.od ?? "", w.od_cal ?? "", w.value ?? "", w.class, w.flag || ""].join(","));
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = el("a");
    a.href = url;
    a.download = `plateod-${q.assay || q.mode}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("CSV downloaded successfully", "success");
  };

  const btnExport = $("csv");
  if (btnExport) btnExport.onclick = handleExportCsv;
  const btnDownload = $("download");
  if (btnDownload) btnDownload.onclick = handleExportCsv;

  // Copy Table (TSV) to Clipboard
  const btnCopy = $("btn-copy-table");
  if (btnCopy) {
    btnCopy.onclick = async () => {
      if (!S.last || !S.last.wells) return;
      const q = S.last;
      const valHeader = q.mode === "PI" ? "PI_Percent" : "PP_Percent";
      const lines = [`Well\tRole\tIntensity\tImage_OD\tCalibrated_OD\t${valHeader}\tClass\tNote`];

      q.wells.forEach((w) => {
        lines.push([
          w.well,
          w.role,
          fmt(w.intensity, 4),
          fmt(w.od, 4),
          fmt(w.od_cal, 4),
          fmt(w.value, 1),
          w.class,
          w.flag || ""
        ].join("\t"));
      });

      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        showToast("Table copied to clipboard (TSV format for Excel)", "success");
      } catch (_) {
        showToast("Could not access clipboard", "warning");
      }
    };
  }

  // Download Heatmap PNG
  const btnHeatmapPng = $("btn-download-heatmap-png");
  if (btnHeatmapPng) {
    btnHeatmapPng.onclick = () => {
      if (!S.last) return;
      const gridCv = document.createElement("canvas");
      const cols = S.last.cols || 12;
      const rows = S.last.rows || 8;
      const cellW = 54;
      const cellH = 54;
      gridCv.width = cols * cellW + 60;
      gridCv.height = rows * cellH + 60;

      const g = gridCv.getContext("2d");
      g.fillStyle = "#0B0F14";
      g.fillRect(0, 0, gridCv.width, gridCv.height);

      const cutoff = S.last.cutoff || 40;
      const vs = S.last.wells.map((w) => w.od_cal).filter((v) => v !== null && isFinite(v));
      const lo = Math.min(...vs);
      const hi = Math.max(...vs);

      S.last.wells.forEach((w) => {
        const x = 40 + w.col * cellW;
        const y = 30 + w.row * cellH;
        const t = hi > lo ? (w.od_cal - lo) / (hi - lo) : 0.5;
        const col = tmbAmberColor(t);

        g.fillStyle = col.bg;
        g.beginPath();
        g.roundRect ? g.roundRect(x, y, cellW - 4, cellH - 4, 8) : g.rect(x, y, cellW - 4, cellH - 4);
        g.fill();

        g.fillStyle = col.fg;
        g.font = "bold 11px system-ui, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(fmt(w.od_cal, 2), x + cellW / 2 - 2, y + cellH / 2 - 2);
      });

      const url = gridCv.toDataURL("image/png");
      const a = el("a");
      a.href = url;
      a.download = `plateod-heatmap-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast("Heatmap PNG exported", "success");
    };
  }

  // Clear compare bar
  const btnClearCompare = $("btn-clear-compare");
  if (btnClearCompare) {
    btnClearCompare.onclick = () => {
      pinnedCompareWells = [];
      updateCompareBar();
    };
  }

  // Well Inspector Drawer controls
  const closeBtn = $("inspector-close-btn");
  if (closeBtn) closeBtn.onclick = closeWellInspector;

  const prevBtn = $("inspector-btn-prev");
  if (prevBtn) prevBtn.onclick = () => walkInspectorWell(-1);

  const nextBtn = $("inspector-btn-next");
  if (nextBtn) nextBtn.onclick = () => walkInspectorWell(1);

  const pinBtn = $("inspector-btn-pin");
  if (pinBtn) {
    pinBtn.onclick = () => {
      if (activeInspectorWell) {
        pinWellToCompare(activeInspectorWell);
        showToast(`Pinned ${activeInspectorWell.well} to Compare Mode`, "info");
      }
    };
  }

  // Arrow key navigation when inspector is open
  window.addEventListener("keydown", (e) => {
    const drawer = $("well-inspector-drawer");
    if (drawer && drawer.classList.contains("open")) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        walkInspectorWell(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        walkInspectorWell(1);
      } else if (e.key === "Escape") {
        closeWellInspector();
      } else if (e.key === "Tab") {
        const focusables = Array.from(drawer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => !el.disabled && el.offsetParent !== null);
        if (focusables.length > 0) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
  });

  // Lightbox handlers
  const lb = $("lightbox");
  if (lb) {
    lb.onclick = (e) => {
      if (e.target !== $("lightbox-img")) lb.hidden = true;
    };
  }
  const lbClose = $("lightbox-close");
  if (lbClose) {
    lbClose.onclick = () => {
      if (lb) lb.hidden = true;
    };
  }
}
