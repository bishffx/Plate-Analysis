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

let offscreen = null;
let animReq = null;
let gridTimeout = null;
let gridAbort = null;

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
      draw();
      updateLiveReadout();
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

    S.circles.forEach(([x, y, r], idx) => {
      let strokeCol = "rgba(45, 212, 191, 0.65)";
      if (roleMap) {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        const role = roleMap[row + "," + col];
        if (role === "Positive ctrl") {
          strokeCol = "rgba(76, 120, 168, 0.85)";
        } else if (role === "Blank") {
          strokeCol = "rgba(138, 143, 152, 0.85)";
        } else {
          strokeCol = "rgba(42, 157, 143, 0.75)";
        }
      }
      g.strokeStyle = strokeCol;
      g.beginPath();
      g.arc(x * k, y * k, r * k, 0, 6.2832);
      g.stroke();
    });
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
        g.shadowColor = "#F5A524";
        g.shadowBlur = isDragged ? 22 : 14;
      }

      // Outer ring
      g.lineWidth = active ? 3 : 2.5;
      g.strokeStyle = "#F5A524";
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
      g.fillStyle = isSelected ? "#F5A524" : "#FFFFFF";
      g.fillText(lb[i], lx + 13, ly + 9);
      g.restore();
    });

    // 5. 4x Magnifier Loupe
    if (S.drag >= 0) {
      const pt = S.corners[S.drag];
      const px = pt[0], py = pt[1];
      const loupeR = 54;
      const zoom = 4;

      let lx = px * k;
      let ly = py * k - loupeR - 28;
      if (ly - loupeR < 10) ly = py * k + loupeR + 28;
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
      g.strokeStyle = "#F5A524";
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(lx, ly, loupeR, 0, 6.2832);
      g.stroke();

      // 4x zoom badge
      g.fillStyle = "rgba(11, 15, 20, 0.9)";
      g.strokeStyle = "#F5A524";
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
    }
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
    Math.max(0, Math.min(S.w, cx / S.scale)),
    Math.max(0, Math.min(S.h, cy / S.scale))
  ];
}

function hitHandle(x, y) {
  if (!S.corners) return -1;
  const tol = 30 / S.scale;
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

  // Zoom controls
  document.querySelectorAll(".zoom-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".zoom-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const z = parseFloat(btn.getAttribute("data-zoom")) || 1.0;
      S.zoomLevel = z;
      if (cv) {
        cv.style.width = z === 1.0 ? "100%" : (z * 100) + "%";
      }
    });
  });
}
