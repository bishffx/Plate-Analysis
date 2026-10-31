"use strict";

/**
 * PlateOD Canvas Module (plate-canvas.js)
 * 
 * Offscreen cached photo rendering, throttled requestAnimationFrame redraws,
 * 4x magnifier loupe with crosshair, draggable corner handles with keyboard nudging.
 */

import { S, setState } from "./state.js";
import { $, roundRect } from "./dom.js";
import { fetchGrid } from "./api.js";
import { scheduleLivePreview } from "./live-preview.js";

let offscreen = null;
let animReq = null;
let gridTimeout = null;
let gridAbort = null;

// Pan, Zoom & Magnifier State
let panX = 0;
let panY = 0;
let zoomScale = 1.0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let circlesAnimStart = 0;

// Corner Movement Undo/Redo History
let cornerHistory = [];
let cornerHistoryIdx = -1;
let dragStartCornerSnapshot = null;

export function updateOffscreenCanvas() {
  if (!S.img) return;
  const cv = $("cv");
  if (!cv) return;
  if (!offscreen) {
    offscreen = document.createElement("canvas");
  }
  offscreen.width = cv.width;
  offscreen.height = cv.height;
  const oCtx = offscreen.getContext("2d");
  oCtx.drawImage(S.img, 0, 0, cv.width, cv.height);
}

export function cornerLabels() {
  const r = +($("rows")?.value) || 8;
  const c = +($("cols")?.value) || 12;
  const L = "ABCDEFGHIJKLMNOP"[r - 1] || "H";
  return ["A1", "A" + c, L + c, L + "1"];
}


export function pushCornerHistory() {
  if (!S.corners) return;
  const snapshot = JSON.parse(JSON.stringify(S.corners));
  if (cornerHistoryIdx >= 0 && cornerHistoryIdx < cornerHistory.length) {
    const prev = cornerHistory[cornerHistoryIdx];
    if (JSON.stringify(prev) === JSON.stringify(snapshot)) return;
  }
  cornerHistory = cornerHistory.slice(0, cornerHistoryIdx + 1);
  cornerHistory.push(snapshot);
  if (cornerHistory.length > 50) cornerHistory.shift();
  cornerHistoryIdx = cornerHistory.length - 1;
  updateHistoryUI();
}

export function undoCorners() {
  if (cornerHistoryIdx > 0) {
    cornerHistoryIdx--;
    S.corners = JSON.parse(JSON.stringify(cornerHistory[cornerHistoryIdx]));
    draw();
    refreshGrid();
    updateLiveReadout();
    updateHistoryUI();
    scheduleLivePreview();
  }
}

export function redoCorners() {
  if (cornerHistoryIdx < cornerHistory.length - 1) {
    cornerHistoryIdx++;
    S.corners = JSON.parse(JSON.stringify(cornerHistory[cornerHistoryIdx]));
    draw();
    refreshGrid();
    updateLiveReadout();
    updateHistoryUI();
    scheduleLivePreview();
  }
}

function updateHistoryUI() {
  const btnUndo = $("btn-undo");
  const btnRedo = $("btn-redo");
  const chip = $("history-chip");
  if (btnUndo) btnUndo.disabled = cornerHistoryIdx <= 0;
  if (btnRedo) btnRedo.disabled = cornerHistoryIdx >= cornerHistory.length - 1;
  if (chip) chip.textContent = `History: ${Math.max(0, cornerHistoryIdx + 1)} / ${cornerHistory.length}`;
}

export function setCanvasZoom(newZoom, originX = null, originY = null) {
  const cv = $("cv");
  if (!cv) return;
  const clamped = Math.max(0.6, Math.min(3.5, newZoom));
  if (Math.abs(clamped - zoomScale) < 0.001) return;

  if (originX !== null && originY !== null) {
    // Zoom centered around origin
    const ratio = clamped / zoomScale;
    panX = originX - (originX - panX) * ratio;
    panY = originY - (originY - panY) * ratio;
  } else {
    // Zoom towards center
    const cx = cv.width / 2;
    const cy = cv.height / 2;
    const ratio = clamped / zoomScale;
    panX = cx - (cx - panX) * ratio;
    panY = cy - (cy - panY) * ratio;
  }

  zoomScale = clamped;
  S.zoomLevel = clamped;

  // Update zoom button active state
  document.querySelectorAll(".zoom-btn").forEach((btn) => {
    const bz = parseFloat(btn.getAttribute("data-zoom")) || 1.0;
    btn.classList.toggle("active", Math.abs(bz - clamped) < 0.05);
  });

  draw();
}

export function resetCanvasPanZoom() {
  panX = 0;
  panY = 0;
  zoomScale = 1.0;
  S.zoomLevel = 1.0;
  document.querySelectorAll(".zoom-btn").forEach((btn) => {
    const bz = parseFloat(btn.getAttribute("data-zoom")) || 1.0;
    btn.classList.toggle("active", Math.abs(bz - 1.0) < 0.05);
  });
  draw();
}

function applyMagneticSnap(handleIdx) {
  if (!S.corners || !S.circles || !S.circles.length || handleIdx < 0) return;
  const [hx, hy] = S.corners[handleIdx];
  const snapTol = 8 / (S.scale * zoomScale);
  let bestDist = snapTol;
  let bestCircle = null;

  for (const [cx, cy] of S.circles) {
    const d = Math.hypot(hx - cx, hy - cy);
    if (d < bestDist) {
      bestDist = d;
      bestCircle = [cx, cy];
    }
  }

  if (bestCircle) {
    S.corners[handleIdx] = [bestCircle[0], bestCircle[1]];
  }
}

export function initCorners() {
  const rowsEl = $("rows");
  const colsEl = $("cols");
  const r = +(rowsEl?.value) || 8;
  const c = +(colsEl?.value) || 12;
  const mx = S.w / (2 * c);
  const my = S.h / (2 * r);
  S.corners = [
    [mx, my],
    [S.w - mx, my],
    [S.w - mx, S.h - my],
    [mx, S.h - my]
  ];
  S.circles = null;
  pushCornerHistory();
  updateLiveReadout();
}

export function sizeCanvas() {
  const cv = $("cv");
  if (!cv || !S.w) return;
  cv.width = Math.min(S.w, 1400);
  S.scale = cv.width / S.w;
  cv.height = Math.round(S.h * S.scale);
  updateOffscreenCanvas();
}

export function updateLiveReadout() {
  const elD = $("readout-dims");
  const elR = $("readout-radius");
  const elH = $("readout-handle");
  if (!elD) return;

  const rows = +($("rows")?.value) || 8;
  const cols = +($("cols")?.value) || 12;
  const radRatio = +($("radius")?.value) || 0.28;

  let radPxStr = "–";
  if (S.circles && S.circles.length) {
    const avgRad = S.circles.reduce((acc, c) => acc + c[2], 0) / S.circles.length;
    radPxStr = `${avgRad.toFixed(1)} px`;
  }
  const lb = cornerLabels();
  const selStr = S.selHandle >= 0
    ? `${lb[S.selHandle]} selected (Arrows move 1px, Shift 10px)`
    : "Click a corner handle to nudge";

  elD.textContent = `${rows} × ${cols} plate`;
  elR.textContent = `ROI radius: ${radPxStr} (${radRatio.toFixed(2)}× pitch)`;
  elH.textContent = selStr;
}

export function refreshGrid() {
  clearTimeout(gridTimeout);
  gridTimeout = setTimeout(async () => {
    if (!S.corners) return;
    if (gridAbort) {
      gridAbort.abort();
    }
    gridAbort = new AbortController();
    const t = ++S.tok;
    try {
      const g = await fetchGrid({
        image_id: S.imageId,
        corners: S.corners,
        rows: +($("rows").value),
        cols: +($("cols").value),
        radius: +($("radius").value)
      }, gridAbort.signal);

      if (t !== S.tok) return;
      S.circles = g.wells;
      circlesAnimStart = performance.now();
      draw();
      updateLiveReadout();
      scheduleLivePreview();
    } catch (err) {
      if (err.name === "AbortError") return;
      if (t === S.tok) {
        S.circles = null;
        draw();
        updateLiveReadout();
      }
    }
  }, 120);
}

function drawDirect() {
  const cv = $("cv");
  if (!cv || !S.img) return;
  const g = cv.getContext("2d");

  g.clearRect(0, 0, cv.width, cv.height);

  // Apply Pan & Zoom Transform
  g.save();
  g.translate(panX, panY);
  g.scale(zoomScale, zoomScale);

  // 1. Scaled background photo
  if (offscreen && offscreen.width === cv.width && offscreen.height === cv.height) {
    g.drawImage(offscreen, 0, 0);
  } else {
    g.drawImage(S.img, 0, 0, cv.width, cv.height);
  }
  const k = S.scale;

  // 2. Measurement circles
  if (S.circles && !S.hideCircles) {
    g.lineWidth = 1.2;
    const cols = +($("cols")?.value) || 12;
    let roleMap = null;
    if (S.last && S.last.wells) {
      roleMap = {};
      S.last.wells.forEach((w) => { roleMap[w.row + "," + w.col] = w.role; });
    }

    const now = performance.now();
    let hasAnimatingCircles = false;

    S.circles.forEach(([x, y, r], idx) => {
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      const delay = (row + col) * 10;
      const age = now - circlesAnimStart - delay;

      let alpha = 1;
      let radScale = 1;
      if (age < 0) {
        alpha = 0;
        hasAnimatingCircles = true;
      } else if (age < 220) {
        alpha = age / 220;
        radScale = 0.6 + 0.4 * alpha;
        hasAnimatingCircles = true;
      }

      if (alpha <= 0) return;

      g.save();
      g.globalAlpha = alpha;

      let strokeCol = "rgba(45, 212, 191, 0.8)";
      if (roleMap) {
        const role = roleMap[row + "," + col];
        if (role === "Positive ctrl") {
          strokeCol = "#F0714F";
        } else if (role === "Blank") {
          strokeCol = "#6C97C4";
        } else {
          strokeCol = "rgba(42, 157, 143, 0.85)";
        }
      }
      g.strokeStyle = strokeCol;
      g.beginPath();
      g.arc(x * k, y * k, (r * k) * radScale, 0, 6.2832);
      g.stroke();
      g.restore();
    });

    if (hasAnimatingCircles) {
      draw();
    }
  }

  // 3. Bounding quadrilateral
  if (S.corners) {
    g.strokeStyle = "rgba(245, 165, 36, 0.65)";
    g.lineWidth = 1.5;
    g.beginPath();
    S.corners.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
    g.closePath();
    g.stroke();

    // 4. Corner handles
    const lb = cornerLabels();
    const hr = 11;

    S.corners.forEach(([x, y], i) => {
      const isDragged = (S.drag === i);
      const isSelected = (S.selHandle === i);
      const isHovered = (S.hoverHandle === i);
      const active = isDragged || isSelected || isHovered;

      g.save();
      if (active) {
        g.shadowColor = "#8B5CF6";
        g.shadowBlur = isDragged ? 22 : 14;
      }

      // Outer ring
      g.lineWidth = active ? 3 : 2.5;
      g.strokeStyle = "#A78BFA";
      g.fillStyle = isDragged
        ? "rgba(245, 165, 36, 0.4)"
        : (isSelected ? "rgba(245, 165, 36, 0.22)" : "rgba(11, 15, 20, 0.85)");
      g.beginPath();
      g.arc(x * k, y * k, hr, 0, 6.2832);
      g.fill();
      g.stroke();

      // Center dot
      g.fillStyle = "#FF7A18";
      g.beginPath();
      g.arc(x * k, y * k, 3, 0, 6.2832);
      g.fill();

      g.restore();

      // Corner label pill
      const lx = x * k + (i === 0 || i === 3 ? -36 : 16);
      const ly = y * k - 8;
      g.save();
      g.fillStyle = "rgba(11, 15, 20, 0.88)";
      g.strokeStyle = isSelected ? "#F5A524" : "rgba(255, 255, 255, 0.25)";
      g.lineWidth = 1;
      roundRect(g, lx, ly, 26, 17, 4);
      g.fill();
      g.stroke();

      g.font = "bold 10px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.strokeStyle = "rgba(0, 0, 0, 0.85)";
      g.lineWidth = 2.5;
      g.strokeText(lb[i], lx + 13, ly + 9);
      g.fillStyle = isSelected ? "#D946EF" : "#FFFFFF";
      g.fillText(lb[i], lx + 13, ly + 9);
      g.restore();
    });

  }

  // Restore untransformed context for viewport loupe overlay
  drawAnalysisScanOverlay(g, cv);
  g.restore();

  // 5. 4x Magnifier Loupe
  if (S.drag >= 0 && S.corners) {
    const pt = S.corners[S.drag];
    const k = S.scale;
    const px = pt[0], py = pt[1];
    // Map handle position to canvas viewport coordinates
    const viewHandleX = px * k * zoomScale + panX;
    const viewHandleY = py * k * zoomScale + panY;
    const loupeR = 52;
    const zoom = 4;

    let lx = viewHandleX;
    let ly = viewHandleY - loupeR - 28;
    if (ly - loupeR < 10) ly = viewHandleY + loupeR + 28;
    if (lx - loupeR < 10) lx = loupeR + 10;
    if (lx + loupeR > cv.width - 10) lx = cv.width - loupeR - 10;

    g.save();
    g.shadowColor = "rgba(0, 0, 0, 0.75)";
    g.shadowBlur = 18;
    g.shadowOffsetY = 6;

    g.beginPath();
    g.arc(lx, ly, loupeR, 0, 6.2832);
    g.clip();

    const sw = (loupeR * 2) / zoom;
    const sh = (loupeR * 2) / zoom;
    const sx = Math.max(0, Math.min(S.w - sw, px - sw / 2));
    const sy = Math.max(0, Math.min(S.h - sh, py - sh / 2));
    g.drawImage(S.img, sx, sy, sw, sh, lx - loupeR, ly - loupeR, loupeR * 2, loupeR * 2);

    // Loupe crosshairs
    g.strokeStyle = "rgba(245, 165, 36, 0.9)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(lx - loupeR, ly); g.lineTo(lx + loupeR, ly);
    g.moveTo(lx, ly - loupeR); g.lineTo(lx, ly + loupeR);
    g.stroke();

    // Loupe center ring
    g.strokeStyle = "#FFFFFF";
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(lx, ly, 6, 0, 6.2832);
    g.stroke();

    g.restore();

    // Loupe outer ring
    g.save();
    g.strokeStyle = "#A78BFA";
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(lx, ly, loupeR, 0, 6.2832);
    g.stroke();

    // 4x zoom badge
    g.fillStyle = "rgba(11, 15, 20, 0.9)";
    g.strokeStyle = "#A78BFA";
    g.lineWidth = 1;
    roundRect(g, lx - 18, ly + loupeR - 12, 36, 16, 4);
    g.fill();
    g.stroke();
    g.fillStyle = "#F5A524";
    g.font = "bold 9px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("4× ZOOM", lx, ly + loupeR - 4);
    g.restore();
    return;
  }
}

export function draw() {
  if (animReq) return;
  animReq = requestAnimationFrame(() => {
    animReq = null;
    drawDirect();
  });
}

function ptInImg(e) {
  const cv = $("cv");
  const r = cv.getBoundingClientRect();
  const cx = e.clientX - r.left;
  const cy = e.clientY - r.top;
  return [
    Math.max(0, Math.min(S.w, (cx - panX) / (S.scale * zoomScale))),
    Math.max(0, Math.min(S.h, (cy - panY) / (S.scale * zoomScale)))
  ];
}

function hitHandle(x, y) {
  if (!S.corners) return -1;
  const tol = 30 / (S.scale * zoomScale);
  let best = -1, bd = tol;
  S.corners.forEach(([cx, cy], i) => {
    const d = Math.hypot(x - cx, y - cy);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

export function initCanvasEvents() {
  const cv = $("cv");
  if (!cv) return;

  cv.addEventListener("pointerdown", (e) => {
    cv.setPointerCapture(e.pointerId);
    const [x, y] = ptInImg(e);
    const best = hitHandle(x, y);
    if (best >= 0) {
      S.drag = best;
      S.selHandle = best;
      draw();
      updateLiveReadout();
    } else {
      S.selHandle = -1;
      draw();
      updateLiveReadout();
    }
  });

  cv.addEventListener("pointermove", (e) => {
    const [x, y] = ptInImg(e);
    if (S.drag >= 0) {
      S.corners[S.drag] = [x, y];
      draw();
      refreshGrid();
      updateLiveReadout();
    } else {
      const best = hitHandle(x, y);
      if (S.hoverHandle !== best) {
        S.hoverHandle = best;
        cv.style.cursor = best >= 0 ? "crosshair" : "default";
        draw();
      }
    }
  });

  const endDrag = () => {
    if (S.drag >= 0) {
      S.drag = -1;
      draw();
      refreshGrid();
      updateLiveReadout();
    }
  };
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);

  window.addEventListener("resize", () => {
    if (S.img) {
      sizeCanvas();
      draw();
    }
  });

  // Keyboard nudging
  window.addEventListener("keydown", (e) => {
    if (S.selHandle < 0 || !S.corners) return;
    const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (!arrows.includes(e.key)) return;
    const active = document.activeElement;
    if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;

    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const pt = S.corners[S.selHandle];
    if (e.key === "ArrowUp") pt[1] = Math.max(0, pt[1] - step);
    if (e.key === "ArrowDown") pt[1] = Math.min(S.h, pt[1] + step);
    if (e.key === "ArrowLeft") pt[0] = Math.max(0, pt[0] - step);
    if (e.key === "ArrowRight") pt[0] = Math.min(S.w, pt[0] + step);

    draw();
    refreshGrid();
    updateLiveReadout();
  });

  // Toolbar Buttons
  const btnReset = $("btn-reset-grid");
  if (btnReset) {
    btnReset.onclick = (e) => {
      e.stopPropagation();
      if (!S.img) return;
      initCorners();
      S.selHandle = -1;
      draw();
      refreshGrid();
      updateLiveReadout();
    };
  }

  const btnFit = $("btn-fit-grid");
  if (btnFit) {
    btnFit.onclick = (e) => {
      e.stopPropagation();
      if (!S.img) return;
      const mx = Math.round(S.w * 0.05);
      const my = Math.round(S.h * 0.05);
      S.corners = [
        [mx, my],
        [S.w - mx, my],
        [S.w - mx, S.h - my],
        [mx, S.h - my]
      ];
      S.selHandle = -1;
      draw();
      refreshGrid();
      updateLiveReadout();
    };
  }

  const btnToggle = $("btn-toggle-circles");
  if (btnToggle) {
    btnToggle.onclick = (e) => {
      e.stopPropagation();
      S.hideCircles = !S.hideCircles;
      btnToggle.textContent = S.hideCircles ? "Show circles" : "Hide circles";
      draw();
    };
  }

  const radiusInput = $("radius");
  if (radiusInput) {
    radiusInput.oninput = () => {
      const rv = $("rv");
      if (rv) rv.textContent = (+radiusInput.value).toFixed(2);
      refreshGrid();
    };
  }


  // Toolbar Undo / Redo
  const btnUndo = $("btn-undo");
  if (btnUndo) {
    btnUndo.onclick = (e) => {
      e.stopPropagation();
      undoCorners();
    };
  }

  const btnRedo = $("btn-redo");
  if (btnRedo) {
    btnRedo.onclick = (e) => {
      e.stopPropagation();
      redoCorners();
    };
  }

  // Zoom +/- Step Buttons
  const btnZoomIn = $("btn-zoom-in");
  if (btnZoomIn) {
    btnZoomIn.onclick = () => setCanvasZoom(zoomScale * 1.25);
  }

  const btnZoomOut = $("btn-zoom-out");
  if (btnZoomOut) {
    btnZoomOut.onclick = () => setCanvasZoom(zoomScale / 1.25);
  }

  // Global Keyboard Shortcuts for Undo/Redo
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      if (e.shiftKey) {
        e.preventDefault();
        redoCorners();
      } else {
        e.preventDefault();
        undoCorners();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redoCorners();
    }
  });

  // Zoom controls
  document.querySelectorAll(".zoom-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".zoom-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const z = parseFloat(btn.getAttribute("data-zoom")) || 1.0;
      setCanvasZoom(z);
    });
  });
}


// =============================================================================
// HERO 8x12 PERSPECTIVE WELL PLATE CANVAS & SIMULATION
// =============================================================================

let heroCanvas = null;
let heroCtx = null;
let heroTooltip = null;
let heroAnimId = null;
let heroWells = [];
let heroPointer = { x: -1000, y: -1000, active: false };
let heroStartTime = 0;
let isHeroVisible = true;

const WELL_OD_DEMO = [
  [0.08, 0.09, 0.42, 0.88, 1.25, 1.64, 1.95, 2.15, 1.82, 1.45, 0.92, 0.45],
  [0.09, 0.10, 0.38, 0.79, 1.18, 1.58, 1.89, 2.08, 1.76, 1.39, 0.88, 0.41],
  [2.10, 2.05, 0.45, 0.92, 1.32, 1.71, 2.02, 2.22, 1.90, 1.51, 0.96, 0.48],
  [2.12, 2.08, 0.49, 0.95, 1.36, 1.75, 2.06, 2.26, 1.94, 1.55, 0.99, 0.51],
  [0.08, 0.08, 0.52, 0.99, 1.40, 1.79, 2.10, 2.30, 1.98, 1.59, 1.02, 0.54],
  [0.08, 0.09, 0.55, 1.02, 1.44, 1.83, 2.14, 2.34, 2.02, 1.63, 1.05, 0.57],
  [1.42, 1.38, 0.58, 1.05, 1.48, 1.87, 2.18, 2.38, 2.06, 1.67, 1.08, 0.60],
  [0.15, 0.18, 0.61, 1.09, 1.52, 1.91, 2.22, 2.42, 2.10, 1.71, 1.12, 0.63]
];

export function initHeroPlateCanvas() {
  heroCanvas = document.getElementById("hero-plate-canvas");
  heroTooltip = document.getElementById("hero-well-tooltip");
  if (!heroCanvas) return;
  
  heroCtx = heroCanvas.getContext("2d");
  heroStartTime = performance.now();

  // Generate 8x12 wells data structure
  heroWells = [];
  const rows = 8;
  const cols = 12;
  const rowNames = "ABCDEFGH";

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const baseOD = WELL_OD_DEMO[r][c];
      heroWells.push({
        r,
        c,
        id: `${rowNames[r]}${c + 1}`,
        baseOD,
        waveDelay: (r + c) * 0.07, // diagonal wave delay (0 to ~1.3s)
        scale: 0,
        alpha: 0,
        lift: 0,
        vLift: 0,
        glow: 0,
        x: 0,
        y: 0,
        rx: 0,
        ry: 0
      });
    }
  }

  // Pointer event listeners (Mouse & Touch)
  const updatePointer = (clientX, clientY) => {
    const rect = heroCanvas.getBoundingClientRect();
    heroPointer.x = clientX - rect.left;
    heroPointer.y = clientY - rect.top;
    heroPointer.active = true;
  };

  heroCanvas.addEventListener("pointermove", (e) => {
    updatePointer(e.clientX, e.clientY);
  });

  heroCanvas.addEventListener("pointerleave", () => {
    heroPointer.active = false;
    heroPointer.x = -1000;
    heroPointer.y = -1000;
  });

  heroCanvas.addEventListener("touchstart", (e) => {
    if (e.touches.length > 0) {
      updatePointer(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  heroCanvas.addEventListener("touchmove", (e) => {
    if (e.touches.length > 0) {
      updatePointer(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  heroCanvas.addEventListener("touchend", () => {
    heroPointer.active = false;
  }, { passive: true });

  // Well click tooltip
  heroCanvas.addEventListener("click", (e) => {
    const rect = heroCanvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    let clickedWell = null;
    let minDist = Infinity;

    for (const w of heroWells) {
      const dx = (clickX - w.x) / (w.rx * 1.15 || 1);
      const dy = (clickY - w.y) / (w.ry * 1.15 || 1);
      const dist = dx * dx + dy * dy;
      if (dist <= 1.0 && dist < minDist) {
        minDist = dist;
        clickedWell = w;
      }
    }

    if (clickedWell && heroTooltip) {
      heroTooltip.textContent = `Well ${clickedWell.id} – OD ${clickedWell.baseOD.toFixed(2)} (demo)`;
      heroTooltip.style.left = `${clickedWell.x}px`;
      heroTooltip.style.top = `${clickedWell.y - clickedWell.ry - 10}px`;
      heroTooltip.hidden = false;

      // Auto hide tooltip after 3.5s
      clearTimeout(heroTooltip._hideTimeout);
      heroTooltip._hideTimeout = setTimeout(() => {
        heroTooltip.hidden = true;
      }, 3500);
    } else if (heroTooltip) {
      heroTooltip.hidden = true;
    }
  });

  // Size handler
  const resizeCanvas = () => {
    const wrap = heroCanvas.parentElement;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight || 560;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    
    heroCanvas.width = Math.round(w * dpr);
    heroCanvas.height = Math.round(h * dpr);
    heroCanvas.style.width = `${w}px`;
    heroCanvas.style.height = `${h}px`;

    heroCtx.resetTransform ? heroCtx.resetTransform() : heroCtx.setTransform(1, 0, 0, 1, 0, 0);
    heroCtx.scale(dpr, dpr);

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      renderHeroStatic(w, h);
    }
  };

  const ro = new ResizeObserver(resizeCanvas);
  if (heroCanvas.parentElement) {
    ro.observe(heroCanvas.parentElement);
  }
  resizeCanvas();

  // IntersectionObserver to pause loop when scrolled away
  const io = new IntersectionObserver((entries) => {
    isHeroVisible = entries[0].isIntersecting;
    if (isHeroVisible && !heroAnimId) {
      startHeroLoop();
    } else if (!isHeroVisible && heroAnimId) {
      cancelAnimationFrame(heroAnimId);
      heroAnimId = null;
    }
  }, { threshold: 0.05 });
  io.observe(heroCanvas);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (heroAnimId) {
        cancelAnimationFrame(heroAnimId);
        heroAnimId = null;
      }
    } else if (isHeroVisible && !heroAnimId) {
      startHeroLoop();
    }
  });

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    startHeroLoop();
  }
}

function startHeroLoop() {
  let lastTime = performance.now();

  const loop = (now) => {
    const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
    lastTime = now;

    renderHeroFrame(now, dt);

    if (isHeroVisible && !document.hidden) {
      heroAnimId = requestAnimationFrame(loop);
    } else {
      heroAnimId = null;
    }
  };

  heroAnimId = requestAnimationFrame(loop);
}

function renderHeroFrame(now, dt) {
  if (!heroCanvas || !heroCtx) return;
  const w = heroCanvas.clientWidth;
  const h = heroCanvas.clientHeight;
  if (!w || !h) return;

  heroCtx.clearRect(0, 0, w, h);

  const elapsed = (now - heroStartTime) / 1000;

  // Geometry calculations for soft perspective
  const plateW = Math.min(w * 0.88, 860);
  const plateH = Math.min(h * 0.74, 460);
  const centerX = w / 2;
  const centerY = h / 2 + 15;

  const topScale = 0.82;
  const botScale = 1.08;

  // Draw 3D plate slab in perspective
  const plateLeftTop = centerX - (plateW * topScale) / 2;
  const plateRightTop = centerX + (plateW * topScale) / 2;
  const plateTopY = centerY - plateH / 2;

  const plateLeftBot = centerX - (plateW * botScale) / 2;
  const plateRightBot = centerX + (plateW * botScale) / 2;
  const plateBotY = centerY + plateH / 2;

  // Plate base drop shadow & ambient glow
  heroCtx.save();
  heroCtx.beginPath();
  heroCtx.moveTo(plateLeftTop, plateTopY);
  heroCtx.lineTo(plateRightTop, plateTopY);
  heroCtx.lineTo(plateRightBot, plateBotY + 12);
  heroCtx.lineTo(plateLeftBot, plateBotY + 12);
  heroCtx.closePath();
  heroCtx.fillStyle = "rgba(0, 0, 0, 0.45)";
  heroCtx.shadowColor = "rgba(0, 0, 0, 0.5)";
  heroCtx.shadowBlur = 20;
  heroCtx.shadowOffsetY = 6;
  heroCtx.fill();
  heroCtx.restore();

  // Plate slab body
  heroCtx.save();
  heroCtx.beginPath();
  heroCtx.moveTo(plateLeftTop, plateTopY);
  heroCtx.lineTo(plateRightTop, plateTopY);
  heroCtx.lineTo(plateRightBot, plateBotY);
  heroCtx.lineTo(plateLeftBot, plateBotY);
  heroCtx.closePath();

  // Subtle ink glass gradient
  const slabGrad = heroCtx.createLinearGradient(centerX, plateTopY, centerX, plateBotY);
  slabGrad.addColorStop(0, "rgba(28, 16, 52, 0.85)");
  slabGrad.addColorStop(1, "rgba(10, 7, 24, 0.94)");
  heroCtx.fillStyle = slabGrad;
  heroCtx.fill();

  heroCtx.lineWidth = 1.5;
  heroCtx.strokeStyle = "rgba(167, 139, 250, 0.25)";
  heroCtx.stroke();
  heroCtx.restore();

  // Slab front bevel depth
  heroCtx.save();
  heroCtx.beginPath();
  heroCtx.moveTo(plateLeftBot, plateBotY);
  heroCtx.lineTo(plateRightBot, plateBotY);
  heroCtx.lineTo(plateRightBot + 2, plateBotY + 10);
  heroCtx.lineTo(plateLeftBot - 2, plateBotY + 10);
  heroCtx.closePath();
  heroCtx.fillStyle = "rgba(18, 10, 36, 0.96)";
  heroCtx.fill();
  heroCtx.strokeStyle = "rgba(217, 70, 239, 0.35)";
  heroCtx.lineWidth = 1;
  heroCtx.stroke();
  heroCtx.restore();

  // Assay Sweep wave parameters (cycles every 4.8s)
  const sweepCycle = 4.8;
  const sweepTime = elapsed % sweepCycle;
  const sweepProgress = sweepTime / 2.8; // sweep active for first 2.8s of cycle
  const sweepActive = sweepProgress <= 1.0;
  const sweepPosNorm = sweepActive ? -0.25 + sweepProgress * 1.5 : -2;

  // Ripple radius around pointer
  const rippleRadius = 135;

  // Draw wells
  const rows = 8;
  const cols = 12;

  for (const well of heroWells) {
    const normX = (well.c + 0.5) / cols;
    const normY = (well.r + 0.5) / rows;

    // Perspective interpolation
    const rowScale = topScale + (botScale - topScale) * normY;
    const rowW = plateW * rowScale * 0.92;
    const rowStartX = centerX - rowW / 2;
    const posX = rowStartX + normX * rowW;
    const posY = plateTopY + 24 + normY * (plateH - 44);

    const baseRadius = (plateW / cols) * 0.34 * rowScale;
    const rx = baseRadius;
    const ry = baseRadius * 0.72; // perspective flattening

    well.x = posX;
    well.y = posY + well.lift;
    well.rx = rx;
    well.ry = ry;

    // 1. Diagonal Wave fill on load
    if (elapsed > well.waveDelay) {
      const waveAge = elapsed - well.waveDelay;
      if (well.alpha < 1) {
        well.alpha = Math.min(1, well.alpha + dt * 2.5);
      }
      if (waveAge < 0.6) {
        // Spring overshoot on entry
        const p = waveAge / 0.6;
        well.scale = 1 + 0.35 * Math.sin(p * Math.PI) * Math.exp(-p * 3);
      } else {
        well.scale = 1;
      }
    } else {
      well.alpha = 0;
      well.scale = 0;
    }

    if (well.alpha <= 0) continue;

    // 2. Ripple & Spring physics around pointer
    let targetLift = 0;
    let targetGlow = 0;
    if (heroPointer.active) {
      const dx = heroPointer.x - posX;
      const dy = heroPointer.y - posY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < rippleRadius) {
        const falloff = 1 - dist / rippleRadius;
        const smoothed = falloff * falloff;
        targetLift = -14 * smoothed;
        targetGlow = smoothed * 1.2;
      }
    }

    // Spring mechanics: F = -k*(x - target) - damping*v
    const k = 140;
    const damping = 12;
    const force = -k * (well.lift - targetLift) - damping * well.vLift;
    well.vLift += force * dt;
    well.lift += well.vLift * dt;

    // Glow lerp
    well.glow += (targetGlow - well.glow) * Math.min(1, dt * 14);

    // 3. Assay sweep light modulation
    let sweepBoost = 0;
    if (sweepActive) {
      const distToSweep = Math.abs(normX - sweepPosNorm);
      if (distToSweep < 0.16) {
        sweepBoost = Math.exp(-Math.pow(distToSweep / 0.08, 2));
      }
    }

    // Determine well color: amber-to-orange gradient
    // Base color shifts dynamically during assay sweep
    const effectiveOD = Math.max(0.05, Math.min(2.5, well.baseOD + sweepBoost * 0.45));
    const odRatio = effectiveOD / 2.5; // 0 to 1

    // Draw Well outer rim (well collar)

    heroCtx.beginPath();
    heroCtx.ellipse(well.x, well.y, rx * well.scale, ry * well.scale, 0, 0, Math.PI * 2);
    heroCtx.fillStyle = "rgba(15, 10, 30, 0.92)";
    heroCtx.fill();
    heroCtx.lineWidth = 1.2;
    heroCtx.strokeStyle = `rgba(167, 139, 250, ${0.12 + well.glow * 0.4})`;
    heroCtx.stroke();

    // Well inner glowing liquid disc
    const innerRx = rx * 0.84 * well.scale;
    const innerRy = ry * 0.84 * well.scale;

    heroCtx.beginPath();
    heroCtx.ellipse(well.x, well.y, innerRx, innerRy, 0, 0, Math.PI * 2);

    // Color gradient based on OD & glow
    const wellGrad = heroCtx.createRadialGradient(
      well.x - innerRx * 0.25,
      well.y - innerRy * 0.35,
      innerRx * 0.05,
      well.x,
      well.y,
      innerRx
    );

    // TMB Amber Palette: #FFD166 (pale) -> #F5A524 (vivid amber) -> #E8590C (deep orange)
    if (odRatio < 0.25) {
      // Substrate blank / very low signal: translucent pale amber
      wellGrad.addColorStop(0, `rgba(255, 209, 102, ${0.4 + well.glow * 0.3 + sweepBoost * 0.3})`);
      wellGrad.addColorStop(1, `rgba(245, 165, 36, ${0.2 + well.glow * 0.2})`);
    } else if (odRatio < 0.65) {
      // Mid OD: warm luminous amber
      wellGrad.addColorStop(0, `rgba(255, 215, 110, ${0.85 + well.glow * 0.15})`);
      wellGrad.addColorStop(0.7, `rgba(245, 165, 36, ${0.75 + well.glow * 0.2})`);
      wellGrad.addColorStop(1, `rgba(217, 119, 6, ${0.65 + well.glow * 0.2})`);
    } else {
      // High OD / max antigen: deep fiery amber-orange
      wellGrad.addColorStop(0, `rgba(251, 146, 60, ${0.95 + well.glow * 0.05})`);
      wellGrad.addColorStop(0.65, `rgba(234, 88, 12, ${0.9 + well.glow * 0.1})`);
      wellGrad.addColorStop(1, `rgba(154, 52, 18, ${0.85 + well.glow * 0.15})`);
    }

    heroCtx.fillStyle = wellGrad;
    heroCtx.fill();

    // Specular crescent highlight on top rim of liquid
    heroCtx.beginPath();
    heroCtx.ellipse(
      well.x - innerRx * 0.15,
      well.y - innerRy * 0.22,
      innerRx * 0.45,
      innerRy * 0.22,
      0,
      0,
      Math.PI * 2
    );
    heroCtx.fillStyle = `rgba(255, 255, 255, ${0.22 + well.glow * 0.35})`;
    heroCtx.fill();

    // Outer aura glow if hovered or swept
    if (well.glow > 0.05 || sweepBoost > 0.2) {
      heroCtx.beginPath();
      heroCtx.ellipse(well.x, well.y, rx * 1.35 * well.scale, ry * 1.35 * well.scale, 0, 0, Math.PI * 2);
      const auraGrad = heroCtx.createRadialGradient(well.x, well.y, rx * 0.8, well.x, well.y, rx * 1.35);
      const intensity = Math.min(1, well.glow * 0.5 + sweepBoost * 0.45);
      auraGrad.addColorStop(0, `rgba(245, 165, 36, ${intensity * 0.3})`);
      auraGrad.addColorStop(1, "rgba(245, 165, 36, 0)");
      heroCtx.fillStyle = auraGrad;
      heroCtx.fill();
    }


  }

  // Draw the passing Assay Sweep Light Bar overlay across the plate
  if (sweepActive) {

    const barCenterNorm = sweepPosNorm;
    const barW = plateW * 0.22;
    const barX = centerX - (plateW * topScale) / 2 + barCenterNorm * (plateW * topScale);

    const sweepGrad = heroCtx.createLinearGradient(barX - barW / 2, 0, barX + barW / 2, 0);
    sweepGrad.addColorStop(0, "rgba(255, 209, 102, 0)");
    sweepGrad.addColorStop(0.5, "rgba(255, 209, 102, 0.16)");
    sweepGrad.addColorStop(1, "rgba(255, 209, 102, 0)");

    heroCtx.beginPath();
    heroCtx.moveTo(barX - barW / 2, plateTopY - 10);
    heroCtx.lineTo(barX + barW / 2, plateTopY - 10);
    heroCtx.lineTo(barX + barW / 2 + 30, plateBotY + 10);
    heroCtx.lineTo(barX - barW / 2 + 30, plateBotY + 10);
    heroCtx.closePath();

    heroCtx.fillStyle = sweepGrad;
    heroCtx.fill();

  }
}

function renderHeroStatic(w, h) {
  if (!heroCanvas || !heroCtx) return;
  heroCtx.clearRect(0, 0, w, h);
  for (const wll of heroWells) {
    wll.alpha = 1;
    wll.scale = 1;
    wll.lift = 0;
    wll.glow = 0;
  }
  renderHeroFrame(performance.now(), 0.016);
}

// =============================================================================
// SCROLL STORY MINI PLATE CANVAS & PROCESSING STAGES
// =============================================================================

let storyCanvas = null;
let storyCtx = null;
let currentStoryStep = 1;
let storyAnimProgress = 1;
let storyAnimTarget = 1;

export function initStoryMiniPlate() {
  storyCanvas = document.getElementById("story-plate-canvas");
  if (!storyCanvas) return;
  storyCtx = storyCanvas.getContext("2d");
  updateStoryPlate(1);
}

export function updateStoryPlate(step) {
  currentStoryStep = Math.max(1, Math.min(4, step));
  const statusLabel = document.getElementById("story-status-label");
  
  const labels = [
    "Stage 1: Photographing Plate",
    "Stage 2: Automatic Grid Detection & RANSAC",
    "Stage 3: Setting Controls & QC Baselines",
    "Stage 4: Calibrated Optical Density Heatmap"
  ];

  if (statusLabel) {
    statusLabel.textContent = labels[currentStoryStep - 1];
  }

  renderStoryFrame();
}

function renderStoryFrame() {
  if (!storyCanvas || !storyCtx) return;
  const w = storyCanvas.width || 460;
  const h = storyCanvas.height || 320;

  storyCtx.clearRect(0, 0, w, h);

  // Background plate frame
  const pw = 400;
  const ph = 260;
  const px = (w - pw) / 2;
  const py = (h - ph) / 2;

  // Plate plastic base
  storyCtx.save();
  storyCtx.fillStyle = "rgba(14, 22, 34, 0.9)";
  storyCtx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  storyCtx.lineWidth = 1.5;
  storyCtx.beginPath();
  storyCtx.roundRect ? storyCtx.roundRect(px, py, pw, ph, 12) : storyCtx.rect(px, py, pw, ph);
  storyCtx.fill();
  storyCtx.stroke();
  storyCtx.restore();

  // Grid coordinates
  const rows = 8;
  const cols = 12;
  const colW = (pw - 40) / cols;
  const rowH = (ph - 40) / rows;
  const startX = px + 20 + colW / 2;
  const startY = py + 20 + rowH / 2;

  // Render 8x12 wells according to stage
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = startX + c * colW;
      const cy = startY + r * rowH;
      const rad = 10;
      const demoOD = WELL_OD_DEMO[r][c];

      storyCtx.save();

      // Outer circle
      storyCtx.beginPath();
      storyCtx.arc(cx, cy, rad, 0, Math.PI * 2);

      if (currentStoryStep === 1) {
        // Step 1: Photograph - diffuse photo look with subtle amber liquids
        storyCtx.fillStyle = `rgba(245, 165, 36, ${0.15 + (demoOD / 2.5) * 0.45})`;
        storyCtx.fill();
        storyCtx.strokeStyle = "rgba(255, 255, 255, 0.12)";
        storyCtx.lineWidth = 1;
        storyCtx.stroke();
      } else if (currentStoryStep === 2) {
        // Step 2: Grid detection - well circle outlines
        storyCtx.fillStyle = `rgba(245, 165, 36, ${0.15 + (demoOD / 2.5) * 0.45})`;
        storyCtx.fill();
        storyCtx.strokeStyle = "rgba(45, 212, 191, 0.85)"; // cyan circle detection
        storyCtx.lineWidth = 1.2;
        storyCtx.stroke();
      } else if (currentStoryStep === 3) {
        // Step 3: Controls highlighted
        // SPCE layout: A1-D1 Antigen, E1-F1 Blank
        if (c === 0 && r < 4) {
          // Antigen (coral)
          storyCtx.fillStyle = "#F0714F";
          storyCtx.shadowColor = "#F0714F";
          storyCtx.shadowBlur = 8;
        } else if (c === 0 && (r === 4 || r === 5)) {
          // Blank (slate blue)
          storyCtx.fillStyle = "#6C97C4";
          storyCtx.shadowColor = "#6C97C4";
          storyCtx.shadowBlur = 6;
        } else {
          // Sample wells
          storyCtx.fillStyle = "rgba(245, 165, 36, 0.25)";
        }
        storyCtx.fill();
        storyCtx.strokeStyle = "rgba(255, 255, 255, 0.2)";
        storyCtx.lineWidth = 1;
        storyCtx.stroke();
      } else if (currentStoryStep === 4) {
        // Step 4: Calibrated OD heatmap
        const odRatio = demoOD / 2.5;
        if (odRatio < 0.2) {
          storyCtx.fillStyle = "#3CB8A8"; // low OD (teal)
        } else if (odRatio < 0.55) {
          storyCtx.fillStyle = "#FFD166"; // mid OD (yellow)
        } else if (odRatio < 0.85) {
          storyCtx.fillStyle = "#F5A524"; // high OD (amber)
        } else {
          storyCtx.fillStyle = "#E8590C"; // peak OD (deep red-orange)
        }
        storyCtx.shadowColor = storyCtx.fillStyle;
        storyCtx.shadowBlur = 4;
        storyCtx.fill();
        storyCtx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        storyCtx.lineWidth = 1;
        storyCtx.stroke();
      }

      storyCtx.restore();
    }
  }

  // Step 2 Overlay: Corner handles and RANSAC quad
  if (currentStoryStep === 2) {
    storyCtx.save();
    storyCtx.strokeStyle = "#F5A524";
    storyCtx.lineWidth = 2;
    storyCtx.setLineDash([4, 4]);
    storyCtx.strokeRect(startX - 12, startY - 12, cols * colW - 4, rows * rowH - 4);

    // 4 Corner handles
    const corners = [
      [startX - 12, startY - 12, "A1"],
      [startX + (cols - 1) * colW + 12, startY - 12, "A12"],
      [startX + (cols - 1) * colW + 12, startY + (rows - 1) * rowH + 12, "H12"],
      [startX - 12, startY + (rows - 1) * rowH + 12, "H1"]
    ];

    storyCtx.setLineDash([]);
    for (const [cx, cy, label] of corners) {
      storyCtx.fillStyle = "#F5A524";
      storyCtx.beginPath();
      storyCtx.arc(cx, cy, 6, 0, Math.PI * 2);
      storyCtx.fill();
      storyCtx.strokeStyle = "#FFFFFF";
      storyCtx.lineWidth = 2;
      storyCtx.stroke();
    }
    storyCtx.restore();
  }

  // Step 3 Legend Overlay
  if (currentStoryStep === 3) {
    storyCtx.save();
    storyCtx.font = "10px ui-monospace, monospace";
    storyCtx.fillStyle = "#F0714F";
    storyCtx.fillText("● A1-D1 Antigen Max", px + 16, py + ph - 8);
    storyCtx.fillStyle = "#6C97C4";
    storyCtx.fillText("● E1-F1 Substrate Blank", px + 170, py + ph - 8);
    storyCtx.restore();
  }

  // Step 4 Legend Overlay
  if (currentStoryStep === 4) {
    storyCtx.save();
    storyCtx.font = "10px ui-monospace, monospace";
    storyCtx.fillStyle = "#2DD4BF";
    storyCtx.fillText("Beer-Lambert Optical Density Heatmap (0.00 – 2.50 OD)", px + 16, py + ph - 8);
    storyCtx.restore();
  }
}

// =============================================================================
// ANALYSIS SCANNING LIGHT BAR & MOMENT ANIMATION
// =============================================================================

let isAnalysisScanning = false;
let scanStartTime = 0;
let scanResultStatus = null; // null | 'success' | 'fail'
let scanResultStartTime = 0;

export function startAnalysisScan() {
  isAnalysisScanning = true;
  scanStartTime = performance.now();
  scanResultStatus = null;
  scanResultStartTime = 0;
  draw();
}

export function finishAnalysisScan(isSuccess, onFinished) {
  scanResultStatus = isSuccess ? 'success' : 'fail';
  scanResultStartTime = performance.now();

  const cv = $("cv");
  if (!isSuccess && cv) {
    cv.classList.remove("plate-shake");
    // Force reflow
    void cv.offsetWidth;
    cv.classList.add("plate-shake");
  }

  setTimeout(() => {
    isAnalysisScanning = false;
    scanResultStatus = null;
    draw();
    if (cv) cv.classList.remove("plate-shake");
    if (onFinished) onFinished();
  }, isSuccess ? 350 : 500);
}

export function drawAnalysisScanOverlay(g, cv) {
  if (!isAnalysisScanning || !S.img || !S.corners) return;

  const now = performance.now();
  const elapsed = (now - scanStartTime) / 1000;
  const k = S.scale * zoomScale;

  // Quad bounding box
  const c = S.corners;
  const topY = Math.min(c[0][1], c[1][1]) * k + panY;
  const botY = Math.max(c[2][1], c[3][1]) * k + panY;
  const leftX = Math.min(c[0][0], c[3][0]) * k + panX;
  const rightX = Math.max(c[1][0], c[2][0]) * k + panX;
  const quadH = botY - topY;
  const quadW = rightX - leftX;

  // Scan progress (row-by-row top-to-bottom cycle every 0.8s)
  const cycleTime = 0.8;
  const cycleProgress = (elapsed % cycleTime) / cycleTime;
  const barY = topY + cycleProgress * quadH;

  g.save();

  // Color depends on status
  let barColor = "rgba(45, 212, 191, 0.9)"; // cyan
  let haloColor = "rgba(45, 212, 191, 0.25)";
  if (scanResultStatus === 'fail') {
    barColor = "rgba(240, 113, 79, 0.95)"; // red
    haloColor = "rgba(240, 113, 79, 0.35)";
  } else if (scanResultStatus === 'success') {
    barColor = "rgba(45, 212, 191, 1.0)";
    haloColor = "rgba(45, 212, 191, 0.4)";
  }

  // Draw scanning laser bar
  const scanGrad = g.createLinearGradient(0, barY - 18, 0, barY + 18);
  scanGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
  scanGrad.addColorStop(0.5, haloColor);
  scanGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

  g.fillStyle = scanGrad;
  g.fillRect(leftX - 20, barY - 18, quadW + 40, 36);

  // Sharp laser line
  g.strokeStyle = barColor;
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(leftX - 10, barY);
  g.lineTo(rightX + 10, barY);
  g.stroke();

  // Well flashing as laser passes over
  if (S.circles && S.circles.length) {
    for (const [cx, cy, rad] of S.circles) {
      const wellScreenY = cy * k + panY;
      const dist = Math.abs(barY - wellScreenY);
      if (dist < 20) {
        const flashIntensity = 1 - dist / 20;
        const wellScreenX = cx * k + panX;
        g.beginPath();
        g.arc(wellScreenX, wellScreenY, rad * k * 1.2, 0, Math.PI * 2);
        g.fillStyle = `rgba(255, 255, 255, ${flashIntensity * 0.55})`;
        g.fill();
      }
    }
  }

  g.restore();

  // Request next frame while scanning
  if (isAnalysisScanning) {
    draw();
  }
}
