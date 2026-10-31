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
import { $, $$, el, clearChildren, fmt, showToast } from "./dom.js";
import { countUp, initSpotlight } from "./effects.js";
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

    list.forEach((x) => {
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

  scrubSlider.oninput = () => {
    scrubThreshold = parseFloat(scrubSlider.value);
    scrubValText.textContent = fmt(scrubThreshold, 2);
    updateHeatmapScrubHighlights(scrubThreshold);
  };
  scrubWrap.appendChild(scrubSlider);
  scrubWrap.appendChild(scrubValText);

  const resetScrubBtn = el("button", "Clear", "sec btn-xs");
  resetScrubBtn.onclick = () => {
    scrubThreshold = null;
    scrubSlider.value = lo;
    scrubValText.textContent = "All";
    updateHeatmapScrubHighlights(null);
  };
  scrubWrap.appendChild(resetScrubBtn);
  cBar.appendChild(scrubWrap);

  container.appendChild(cBar);

  const g = el("div", undefined, "heat");
  g.id = "active-heatmap-grid";
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
      const cell = el("div", "", "heat-cell");
      cell.setAttribute("data-well", w.well);
      cell.setAttribute("data-class", w.class);
      cell.setAttribute("data-val", String(v));

      if (heatmapViewMode === "values") {
        cell.textContent = fmt(v, nd);
        if (v === null || !isFinite(v)) {
          cell.style.background = "#1E2633";
          cell.style.color = "#6B778C";
        } else if (!isVal) {
          const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
          const color = tmbAmberColor(t);
          cell.style.background = color.bg;
          cell.style.color = color.fg;
        } else {
          const color = divergingColor(v, activeCutoff, lo, hi);
          cell.style.background = color.bg;
          cell.style.color = color.fg;
          if (color.isAbove) cell.classList.add("cutoff-outline");
        }
      } else {
        // Classes mode
        cell.textContent = w.well;
        cell.style.background = getClassColor(w.class);
        cell.style.color = "#FFFFFF";
      }

      if (w.role === "Positive ctrl" || w.role === "Negative ctrl" || (w.role && w.role.includes("Antigen"))) {
        cell.appendChild(el("span", undefined, "corner-ctl"));
      } else if (w.role === "Blank") {
        cell.appendChild(el("span", undefined, "corner-blk"));
      }

      cell.onpointerenter = () => setHighlightedWell(w.well);
      cell.onpointerleave = () => setHighlightedWell(null);
      cell.onclick = () => openWellInspector(w);

      g.appendChild(cell);
    }
  }
  container.appendChild(g);

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

    // Draggable Cutoff Marker
    const cMark = el("div", undefined, "legend-cutoff-draggable");
    cMark.style.top = cutPos + "%";
    cMark.title = "Drag to adjust diagnostic cutoff preview";

    const labelSpan = el("span", `Cutoff: ${fmt(activeCutoff, 1)}%`, "cutoff-drag-label");
    cMark.appendChild(labelSpan);
    bWrap.appendChild(cMark);

    // Drag events on cutoff marker
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

  // Reset Cutoff Button if modified
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
  img.src = r.annotated;
  img.alt = "Annotated Plate";
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
    if (S.tab === "table") v.appendChild(renderTable(r));
    else if (S.tab === "od") v.appendChild(heat(r, "od_cal", 3));
    else if (S.tab === "val") v.appendChild(heat(r, "value", 1));
    else v.appendChild(annotatedView(r));
  }

  renderPrintBundle(r);
}

// -----------------------------------------------------------------------------
// Interactive Toolbar & Global Events
// -----------------------------------------------------------------------------
export function initResultsControls() {
  const btnPrint = $("btn-print-report");
  if (btnPrint) btnPrint.onclick = () => window.print();

  // CSV Export
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
