"use strict";

/**
 * PlateOD Results Module (results.js)
 * 
 * Renders QC evaluation pill, KPI summary cards with countUp animations,
 * Calculation & Paper reference panels, stacked proportion bar,
 * synchronized views (Table, OD heatmap, Value heatmap, Annotated plate lightbox),
 * CSV export, and print bundle.
 */

import { S, TBL } from "./state.js";
import { $, el, clearChildren, fmt, showToast } from "./dom.js";
import { countUp } from "./effects.js";
import { draw } from "./plate-canvas.js";

// -----------------------------------------------------------------------------
// Color Math & Ramps
// -----------------------------------------------------------------------------
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
  { t: 0.0, rgb: [246, 234, 188] },
  { t: 0.333, rgb: [245, 165, 36] },
  { t: 0.667, rgb: [194, 86, 12] },
  { t: 1.0, rgb: [91, 30, 8] }
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
  const TEAL = [60, 184, 168];     // #3CB8A8
  const WHITE = [232, 236, 242];   // #E8ECF2
  const VERMILION = [240, 113, 79]; // #F0714F
  let rgb;
  if (val < cutoff) {
    const span = Math.max(1e-4, cutoff - lo);
    const t = Math.max(0, Math.min(1, (val - lo) / span));
    rgb = lerpRgb(TEAL, WHITE, t);
  } else {
    const span = Math.max(1e-4, hi - cutoff);
    const t = Math.max(0, Math.min(1, (val - cutoff) / span));
    rgb = lerpRgb(WHITE, VERMILION, t);
  }
  return { bg: rgbToHex(...rgb), fg: contrastColor(rgb), isAbove };
}

// -----------------------------------------------------------------------------
// Reference Values Panel
// -----------------------------------------------------------------------------
function renderReferencePanel(r) {
  const panel = $("reference-panel");
  if (!panel) return;
  clearChildren(panel);
  if (!r.reference) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const w = el("div", undefined, "ref-panel");
  const head = el("div", undefined, "ref-panel-header");
  const title = el("div", undefined, "ref-panel-title");
  title.appendChild(el("span", `Calculation & Paper Verification (${r.assay || (r.mode === "PI" ? "SPCE" : "DIVA")})`));
  if (r.reference.used_reader_ods) {
    title.appendChild(el("span", "Direct Reader OD Mode", "ref-mode-badge"));
  }
  head.appendChild(title);
  w.appendChild(head);

  const grid = el("div", undefined, "ref-grid");
  const addRef = (label, val, formula) => {
    const it = el("div", undefined, "ref-item");
    it.appendChild(el("div", label, "ref-label"));
    it.appendChild(el("div", val, "ref-value"));
    it.appendChild(el("div", formula, "ref-formula"));
    grid.appendChild(it);
  };

  const ref = r.reference;
  if (r.assay === "SPCE" || (!ref.pos_od && ref.max_od !== undefined)) {
    addRef("Antigen (Max) OD", fmt(ref.max_od, 3) + " OD", "Negative/Antigen control OD");
    addRef("Blank Baseline", fmt(ref.blank_od !== undefined ? ref.blank_od : 0.0, 3) + " OD", "Substrate reference baseline");
    addRef("Cutoff Percent", `${fmt(ref.cutoff_percent, 1)}%`, "Threshold: PI ≥ Cutoff is Positive");
    addRef("Cutoff OD Threshold", fmt(ref.cutoff_od, 3) + " OD", "cutoff_od = max_od × (1 - cutoff/100)");
  } else {
    addRef("Positive Control OD", fmt(ref.pos_od, 3) + " OD", "Mean OD of positive control wells");
    addRef("Negative Control OD", fmt(ref.neg_od, 3) + " OD", "Mean OD of negative control wells");
    addRef("Blank Baseline", fmt(ref.blank_od !== undefined ? ref.blank_od : 0.0, 3) + " OD", "Substrate reference baseline");
    addRef("Delta OD (Pos - Neg)", fmt(ref.delta_od, 3) + " OD", "Controls dynamic range (must be ≥ 0.05)");
    addRef("Cutoff Percent", `${fmt(ref.cutoff_percent, 1)}%`, "Threshold: PP ≥ Cutoff is Positive");
    addRef("Cutoff OD Threshold", fmt(ref.cutoff_od, 3) + " OD", "cutoff_od = neg_od + delta_od × (cutoff/100)");
  }

  w.appendChild(grid);
  panel.appendChild(w);
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
  const addSegment = (pct, cls, titleText) => {
    if (pct <= 0) return;
    const seg = el("div", undefined, "summary-bar-segment " + cls);
    seg.style.width = pct + "%";
    seg.title = titleText;
    bar.appendChild(seg);
  };

  addSegment(pPos, "Positive", `Positive: ${pPos.toFixed(1)}%`);
  addSegment(pNeg, "Negative", `Negative: ${pNeg.toFixed(1)}%`);
  addSegment(pDbt, "Doubtful", `Doubtful: ${pDbt.toFixed(1)}%`);
  addSegment(pInv, "Invalid", `Invalid: ${pInv.toFixed(1)}%`);

  container.appendChild(bar);
  box.appendChild(container);
}

// -----------------------------------------------------------------------------
// Results Table
// -----------------------------------------------------------------------------
function renderTable(r) {
  const wrap = el("div", undefined, "tbl-container");
  const tb = el("div", undefined, "tbl-toolbar");

  // Search box
  const sb = el("div", undefined, "tbl-search-box");
  const searchSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  searchSvg.setAttribute("class", "tbl-search-icon");
  searchSvg.setAttribute("width", "14");
  searchSvg.setAttribute("height", "14");
  searchSvg.setAttribute("viewBox", "0 0 24 24");
  searchSvg.setAttribute("fill", "none");
  searchSvg.setAttribute("stroke", "currentColor");
  searchSvg.setAttribute("stroke-width", "2");
  const cEl = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  cEl.setAttribute("cx", "11"); cEl.setAttribute("cy", "11"); cEl.setAttribute("r", "8");
  const lEl = document.createElementNS("http://www.w3.org/2000/svg", "line");
  lEl.setAttribute("x1", "21"); lEl.setAttribute("y1", "21"); lEl.setAttribute("x2", "16.65"); lEl.setAttribute("y2", "16.65");
  searchSvg.appendChild(cEl); searchSvg.appendChild(lEl);
  sb.appendChild(searchSvg);

  const sinp = el("input");
  sinp.type = "text";
  sinp.id = "tbl-filter";
  sinp.placeholder = "Filter by well (e.g. A1, B)...";
  sinp.setAttribute("aria-label", "Filter wells by name");
  sinp.value = TBL.search || "";
  sinp.oninput = sinp.onkeyup = sinp.onchange = () => {
    TBL.search = sinp.value.trim();
    refreshRows();
  };
  sb.appendChild(sinp);
  tb.appendChild(sb);

  // Show Flagged Only toggle
  const flagLabel = el("label", undefined, "check-label tbl-flag-toggle");
  const flagInp = el("input");
  flagInp.type = "checkbox";
  flagInp.id = "tbl-flagged-only";
  flagInp.checked = Boolean(TBL.flaggedOnly);
  flagInp.onchange = () => {
    TBL.flaggedOnly = flagInp.checked;
    refreshRows();
  };
  flagLabel.appendChild(flagInp);
  const flagTxt = document.createTextNode("Show flagged only");
  flagLabel.appendChild(flagTxt);
  tb.appendChild(flagLabel);

  const countSpan = el("span", "", "tbl-count");
  tb.appendChild(countSpan);
  wrap.appendChild(tb);

  const tblWrap = el("div", undefined, "tbl");
  const t = el("table");
  const thead = el("thead"), thr = el("tr");

  const cols = [
    { key: "well", label: "Well", num: false },
    { key: "role", label: "Role", num: false },
    { key: "intensity", label: "Intensity", num: true, fmt: 4 },
    { key: "od", label: "Image OD", num: true, fmt: 4 },
    { key: "od_cal", label: "Calibrated OD", num: true, fmt: 4 },
    { key: "value", label: r.mode === "PI" ? "PI %" : "PP %", num: true, fmt: 1 },
    { key: "class", label: "Class", num: false },
    { key: "flag", label: "Note", num: false }
  ];

  cols.forEach((c) => {
    const th = el("th", undefined, "sortable" + (c.num ? " num-col" : ""));
    th.textContent = c.label;
    const sIcon = el("span", "▲", "sort-icon");
    if (TBL.sortCol === c.key) {
      th.classList.add("sort-active");
      sIcon.textContent = TBL.sortAsc ? "▲" : "▼";
    }
    th.appendChild(sIcon);
    th.onclick = () => {
      if (TBL.sortCol === c.key) {
        TBL.sortAsc = !TBL.sortAsc;
      } else {
        TBL.sortCol = c.key;
        TBL.sortAsc = true;
      }
      renderResults(r);
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
      if (TBL.flaggedOnly && (!w.flag || w.flag === "")) return false;
      if (!TBL.search) return true;
      return w.well.toUpperCase().includes(TBL.search.toUpperCase());
    });
    countSpan.textContent = `Showing ${list.length} of ${r.wells.length} wells`;

    list.sort((a, b) => {
      let va = a[TBL.sortCol], vb = b[TBL.sortCol];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      let diff = 0;
      if (typeof va === "number" && typeof vb === "number") {
        diff = va - vb;
      } else {
        diff = String(va).localeCompare(String(vb), undefined, { numeric: true });
      }
      return TBL.sortAsc ? diff : -diff;
    });

    list.forEach((x) => {
      const tr = el("tr");
      tr.appendChild(el("td", x.well));
      let roleDisplay = x.role;
      if (r.assay === "SPCE" && roleDisplay === "Negative ctrl") {
        roleDisplay = "Antigen (max-signal) control";
      }
      tr.appendChild(el("td", roleDisplay));
      tr.appendChild(el("td", fmt(x.intensity, 4), "num-col"));
      tr.appendChild(el("td", fmt(x.od, 4), "num-col"));
      tr.appendChild(el("td", fmt(x.od_cal, 4), "num-col"));
      tr.appendChild(el("td", fmt(x.value, 1), "num-col"));

      const tdClass = el("td");
      const badge = el("span", undefined, "b " + x.class.split(" ")[0]);
      const dot = el("span", undefined, "b-dot");
      badge.appendChild(dot);
      const badgeTxt = document.createTextNode(x.class);
      badge.appendChild(badgeTxt);
      tdClass.appendChild(badge);
      tr.appendChild(tdClass);

      tr.appendChild(el("td", x.flag || ""));
      tbody.appendChild(tr);
    });
  }

  refreshRows();
  return wrap;
}

// -----------------------------------------------------------------------------
// Heatmap View
// -----------------------------------------------------------------------------
function showTooltip(e, w, r) {
  const tooltip = $("heat-tooltip");
  if (!tooltip) return;
  clearChildren(tooltip);

  const h = el("div", undefined, "tooltip-header");
  h.appendChild(el("span", w.well, "tooltip-well"));
  const b = el("span", w.class, "b " + w.class.split(" ")[0]);
  h.appendChild(b);
  tooltip.appendChild(h);

  const addRow = (k, v) => {
    const row = el("div", undefined, "tooltip-row");
    row.appendChild(el("span", k));
    row.appendChild(el("span", v, "tooltip-val"));
    tooltip.appendChild(row);
  };
  addRow("Role", w.role);
  addRow("Raw Intensity", fmt(w.intensity, 4));
  addRow("Image OD", fmt(w.od, 4));
  addRow("Calibrated OD", fmt(w.od_cal, 4));
  addRow(r.mode === "PI" ? "PI %" : "PP %", fmt(w.value, 1));
  if (w.flag) addRow("Note", w.flag);

  tooltip.classList.add("show");
  moveTooltip(e);
}

function moveTooltip(e) {
  const tooltip = $("heat-tooltip");
  if (!tooltip) return;
  const pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  const rw = window.innerWidth, rh = window.innerHeight;
  if (x + 210 > rw) x = e.clientX - 210 - pad;
  if (y + 180 > rh) y = e.clientY - 180 - pad;
  tooltip.style.left = Math.max(8, x) + "px";
  tooltip.style.top = Math.max(8, y) + "px";
}

function hideTooltip() {
  const tooltip = $("heat-tooltip");
  if (tooltip) tooltip.classList.remove("show");
}

function heat(r, key, nd) {
  const rows = Math.max(...r.wells.map((w) => w.row)) + 1;
  const cols = Math.max(...r.wells.map((w) => w.col)) + 1;
  const isVal = (key === "value");
  const cutoff = r.cutoff || (r.mode === "PP" ? 40 : 65);

  const vs = r.wells.map((w) => w[key]).filter((v) => v !== null && isFinite(v));
  const lo = vs.length ? Math.min(...vs) : 0;
  const hi = vs.length ? Math.max(...vs) : 1;

  const container = el("div", undefined, "heat-container");
  const g = el("div", undefined, "heat");
  g.style.gridTemplateColumns = `28px repeat(${cols},minmax(38px,1fr))`;

  // Header column numbers
  g.appendChild(el("div", "", "heat-header"));
  for (let c = 0; c < cols; c++) g.appendChild(el("div", String(c + 1), "heat-header"));

  const m = {};
  r.wells.forEach((w) => { m[w.row + "," + w.col] = w; });

  for (let i = 0; i < rows; i++) {
    g.appendChild(el("div", "ABCDEFGHIJKLMNOP"[i], "heat-header"));
    for (let c = 0; c < cols; c++) {
      const w = m[i + "," + c], v = w[key];
      const cell = el("div", fmt(v, nd), "heat-cell");

      if (v === null || !isFinite(v)) {
        cell.style.background = "#1E2633";
        cell.style.color = "#6B778C";
      } else if (!isVal) {
        const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
        const color = tmbAmberColor(t);
        cell.style.background = color.bg;
        cell.style.color = color.fg;
      } else {
        const color = divergingColor(v, cutoff, lo, hi);
        cell.style.background = color.bg;
        cell.style.color = color.fg;
        if (color.isAbove) cell.classList.add("cutoff-outline");
      }

      if (w.role === "Positive ctrl" || w.role === "Negative ctrl" || (w.role && w.role.includes("Antigen"))) {
        cell.appendChild(el("span", undefined, "corner-ctl"));
      } else if (w.role === "Blank") {
        cell.appendChild(el("span", undefined, "corner-blk"));
      }

      cell.onpointerenter = (e) => showTooltip(e, w, r);
      cell.onpointermove = moveTooltip;
      cell.onpointerleave = hideTooltip;

      g.appendChild(cell);
    }
  }
  container.appendChild(g);

  // Vertical Colour Legend
  const leg = el("div", undefined, "heat-legend");
  leg.appendChild(el("span", isVal ? (r.mode === "PI" ? "PI %" : "PP %") : "OD", "legend-title"));
  leg.appendChild(el("span", fmt(hi, isVal ? 1 : 2), "legend-val"));

  const bWrap = el("div", undefined, "legend-bar-wrap");
  const bar = el("div", undefined, "legend-bar");

  if (!isVal) {
    bar.style.background = "linear-gradient(180deg, #5B1E08 0%, #C2560C 33.3%, #F5A524 66.7%, #FFF3C4 100%)";
  } else {
    const cutPos = hi > lo ? Math.max(0, Math.min(100, (1 - (cutoff - lo) / (hi - lo)) * 100)) : 50;
    bar.style.background = `linear-gradient(180deg, #E4572E 0%, #F8FAFC ${cutPos}%, #2A9D8F 100%)`;

    const cMark = el("div", `Cutoff: ${cutoff}%`, "legend-cutoff-mark");
    cMark.style.top = cutPos + "%";
    bWrap.appendChild(cMark);
  }

  bWrap.appendChild(bar);
  leg.appendChild(bWrap);
  leg.appendChild(el("span", fmt(lo, isVal ? 1 : 2), "legend-val"));
  container.appendChild(leg);

  return container;
}

// -----------------------------------------------------------------------------
// Annotated Plate View with Lightbox
// -----------------------------------------------------------------------------
function annotatedView(r) {
  const wrap = el("div", undefined, "annot-container");
  const frame = el("div", undefined, "annot-frame");
  const img = el("img");
  img.id = "annot";
  img.src = r.annotated;
  img.alt = "Annotated Plate";
  frame.appendChild(img);

  const badge = el("div", undefined, "annot-zoom-badge");
  const zoomSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  zoomSvg.setAttribute("width", "12");
  zoomSvg.setAttribute("height", "12");
  zoomSvg.setAttribute("viewBox", "0 0 24 24");
  zoomSvg.setAttribute("fill", "none");
  zoomSvg.setAttribute("stroke", "currentColor");
  zoomSvg.setAttribute("stroke-width", "2");
  const cZ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  cZ.setAttribute("cx", "11"); cZ.setAttribute("cy", "11"); cZ.setAttribute("r", "8");
  const lZ = document.createElementNS("http://www.w3.org/2000/svg", "line");
  lZ.setAttribute("x1", "21"); lZ.setAttribute("y1", "21"); lZ.setAttribute("x2", "16.65"); lZ.setAttribute("y2", "16.65");
  zoomSvg.appendChild(cZ); zoomSvg.appendChild(lZ);
  badge.appendChild(zoomSvg);
  const badgeTxt = document.createTextNode(" Click to zoom");
  badge.appendChild(badgeTxt);
  frame.appendChild(badge);

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
    leg.appendChild(el("span", cls, "b " + cls));
  });
  wrap.appendChild(leg);

  return wrap;
}

// -----------------------------------------------------------------------------
// Print Report Bundle Builder
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
    const l = el("strong", k + ": ");
    item.appendChild(l);
    const v = el("span");
    v.textContent = String(val);
    item.appendChild(v);
    sGrid.appendChild(item);
  };
  addSetting("Protocol", r.assay || r.mode);
  addSetting("Dimensions", `${$("rows")?.value || 8} × ${$("cols")?.value || 12}`);
  addSetting("Channel", $("channel")?.value || "B");
  addSetting("Diagnostic Cutoff", `${r.cutoff}%`);
  addSetting("Linear Slope (m)", $("slope")?.value || "1.000");
  addSetting("Intercept (c)", $("icpt")?.value || "0.000");
  addSetting("QC Evaluation", r.valid ? "PASS" : "FAIL");
  p.appendChild(sGrid);

  const hmTitle = el("div", "Photometric Heatmaps (OD & Positivity/Inhibition)", "print-section-title");
  p.appendChild(hmTitle);

  const hmRow = el("div", undefined, "print-heatmaps-row");
  hmRow.appendChild(heat(r, "od_cal", 3));
  hmRow.appendChild(heat(r, "value", 1));
  p.appendChild(hmRow);

  const tblTitle = el("div", "Well Quantification & Classification Table", "print-section-title print-page-break");
  p.appendChild(tblTitle);
  p.appendChild(renderTable(r));
}

// -----------------------------------------------------------------------------
// Main Render Entry
// -----------------------------------------------------------------------------
export function renderResults(r) {
  const res = $("results");
  if (!res) return;
  res.hidden = false;

  // QC Pill
  const qcText = r.valid ? "PASS" : "FAIL";
  const qcPill = $("qc-pill");
  if (qcPill) {
    qcPill.className = "qc-status-pill " + (r.valid ? "qc-pass" : "qc-fail");
    const txt = $("qc-pill-text");
    if (txt) txt.textContent = qcText;
  }
  const metaAssay = $("results-meta-assay");
  if (metaAssay) metaAssay.textContent = r.assay || (r.mode === "PI" ? "Competitive (PI)" : "Indirect (PP)");
  const metaTime = $("results-meta-time");
  if (metaTime) metaTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const metaChan = $("results-meta-channel");
  if (metaChan) {
    const ch = r.channel_used || r.channel || "B";
    metaChan.textContent = r.auto_channel ? `${ch} (Auto)` : ch;
  }

  // KPI cards
  const s = r.summary;
  const st = $("stats");
  if (st) {
    clearChildren(st);

    const addKpi = (label, val, iconName, cls = "", targetNumber = null) => {
      const card = el("div", undefined, "stat kpi-card" + (cls ? " " + cls : ""));
      const ic = el("div", undefined, "kpi-icon-wrap");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "15");
      svg.setAttribute("height", "15");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");

      if (iconName === "shield") {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z");
        svg.appendChild(path);
      } else if (iconName === "check") {
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        poly.setAttribute("points", "20 6 9 17 4 12");
        svg.appendChild(poly);
      } else {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", "10");
        svg.appendChild(circle);
      }
      ic.appendChild(svg);
      card.appendChild(ic);

      const b = el("b", undefined, "kpi-value");
      b.textContent = val;
      if (targetNumber !== null) {
        countUp(b, targetNumber, 600);
      }
      card.appendChild(b);

      const lbl = el("span", label, "kpi-label");
      card.appendChild(lbl);
      st.appendChild(card);
    };

    addKpi("Plate QC", r.valid ? "PASS" : "FAIL", "shield", r.valid ? "qc-pass" : "qc-fail");

    if (r.assay === "SPCE" || (r.mode === "PI" && s.pos_od === null)) {
      addKpi("Antigen (max) OD", fmt(s.neg_od, 3) + " OD", "circle");
    } else {
      addKpi("Positive ctrl OD", fmt(s.pos_od, 3) + " OD", "circle");
      addKpi("Negative ctrl OD", fmt(s.neg_od, 3) + " OD", "circle");
      addKpi("Delta OD (Pos - Neg)", fmt(s.delta_od, 3) + " OD", "circle");
    }
    addKpi("Blank baseline OD", fmt(s.blank_od, 3) + " OD", "circle");

    // Sample Counts
    addKpi("Positive Wells", String(s.positive || 0), "check", "Positive", s.positive || 0);
    addKpi("Negative Wells", String(s.negative || 0), "circle", "Negative", s.negative || 0);
    if ((s.doubtful || 0) > 0) {
      addKpi("Doubtful Wells", String(s.doubtful), "circle", "Doubtful", s.doubtful);
    }
    if ((s.invalid || 0) > 0) {
      addKpi("Invalid Wells", String(s.invalid), "circle", "Invalid", s.invalid);
    }
  }

  renderReferencePanel(r);
  renderSummaryStrip(r);
  draw();

  // Tabs
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
    t.setAttribute("aria-label", "Results view selector");

    names.forEach(([k, n], idx) => {
      const b = el("button", n, "tab-btn" + (k === S.tab ? " on" : ""));
      b.setAttribute("role", "tab");
      b.id = "tab-" + k;
      b.setAttribute("aria-selected", k === S.tab ? "true" : "false");
      b.setAttribute("aria-controls", "view");
      b.setAttribute("tabindex", k === S.tab ? "0" : "-1");

      b.onclick = () => {
        S.tab = k;
        renderResults(r);
      };

      b.onkeydown = (e) => {
        let targetIdx = null;
        if (e.key === "ArrowRight") targetIdx = (idx + 1) % names.length;
        else if (e.key === "ArrowLeft") targetIdx = (idx - 1 + names.length) % names.length;
        else if (e.key === "Home") targetIdx = 0;
        else if (e.key === "End") targetIdx = names.length - 1;

        if (targetIdx !== null) {
          e.preventDefault();
          S.tab = names[targetIdx][0];
          renderResults(r);
          const nextBtn = $("tab-" + S.tab);
          if (nextBtn) nextBtn.focus();
        }
      };

      t.appendChild(b);
    });
  }

  const v = $("view");
  if (v) {
    clearChildren(v);
    if (S.tab === "table") v.appendChild(renderTable(r));
    else if (S.tab === "od") v.appendChild(heat(r, "od_cal", 3));
    else if (S.tab === "val") v.appendChild(heat(r, "value", 1));
    else v.appendChild(annotatedView(r));
  }

  renderPrintBundle(r);
}

export function initResultsControls() {
  const btnPrint = $("btn-print-report");
  if (btnPrint) btnPrint.onclick = () => window.print();

  const btnExport = $("csv");
  if (btnExport) {
    btnExport.onclick = () => {
      if (!S.last) return;
      const q = S.last;
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
    };
  }

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
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lb) lb.hidden = true;
  });
}
