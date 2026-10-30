"use strict";

/**
 * PlateOD Calibration Module (calibration.js)
 * 
 * Supports linear & quadratic calibration model fitting,
 * canvas scatter plot rendering with R², RMSE, n, and diagnostic warnings.
 */

import { S } from "./state.js";
import { $ } from "./dom.js";
import { calibrateFit } from "./api.js";
import { run } from "./analysis.js";

const val = (id, def) => {
  const elem = $(id);
  if (!elem) return def;
  const v = elem.value.trim();
  if (v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export function setCalibrationModel(mode) {
  S.calMode = mode === "quadratic" ? "quadratic" : "linear";
  const calModel = $("cal-model");
  if (calModel) calModel.value = S.calMode;

  const btnLinear = $("btn-cal-linear");
  const btnQuad = $("btn-cal-quad");
  if (btnLinear && btnQuad) {
    const isQuad = S.calMode === "quadratic";
    btnLinear.classList.toggle("active", !isQuad);
    btnLinear.setAttribute("aria-checked", String(!isQuad));
    btnQuad.classList.toggle("active", isQuad);
    btnQuad.setAttribute("aria-checked", String(isQuad));
  }

  const linParams = $("linear-params");
  const quadParams = $("quad-params");
  if (linParams) linParams.hidden = (S.calMode === "quadratic");
  if (quadParams) quadParams.hidden = (S.calMode !== "quadratic");

  if (S.lastCal) {
    drawCalibrationPlot(S.lastCal);
  }
}

export function drawCalibrationPlot(cal) {
  const cv = $("cal-scatter-cv");
  if (!cv || !cal || !cal.points || !cal.points.length) return;
  cv.style.display = "block";
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = "rgba(13, 19, 27, 0.95)";
  ctx.fillRect(0, 0, w, h);

  const padL = 40, padR = 20, padT = 26, padB = 30;
  const pw = w - padL - padR, ph = h - padT - padB;

  const pts = cal.points;
  const nVal = cal.n || pts.length;
  const maxX = Math.max(0.5, ...pts.map((p) => p.image_od || 0)) * 1.15;
  const maxY = Math.max(0.5, ...pts.map((p) => p.reader_od || 0)) * 1.15;

  const toX = (x) => padL + (x / maxX) * pw;
  const toY = (y) => padT + ph - (y / maxY) * ph;

  // Grid lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const xVal = (maxX / 4) * i;
    const yVal = (maxY / 4) * i;
    const gx = toX(xVal), gy = toY(yVal);
    ctx.moveTo(gx, padT); ctx.lineTo(gx, padT + ph);
    ctx.moveTo(padL, gy); ctx.lineTo(padL + pw, gy);
  }
  ctx.stroke();

  // Axes
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + ph); ctx.lineTo(padL + pw, padT + ph);
  ctx.stroke();

  // Labels
  ctx.fillStyle = "#A3AFBF";
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Image OD", padL + pw / 2, h - 8);
  ctx.save();
  ctx.translate(12, padT + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Reader OD", 0, 0);
  ctx.restore();

  // Fitted curve or line
  const isQuad = S.calMode === "quadratic" && cal.quadratic;
  ctx.strokeStyle = isQuad ? "#2DD4BF" : "#F5A524";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const steps = 60;
  for (let s = 0; s <= steps; s++) {
    const x = (maxX / steps) * s;
    let y = 0;
    if (isQuad) {
      const q = cal.quadratic;
      y = q.a * (x ** 2) + q.b * x + q.c;
    } else {
      y = cal.slope * x + cal.intercept;
    }
    const px = toX(x), py = toY(y);
    if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Data points
  pts.forEach((p) => {
    const px = toX(p.image_od), py = toY(p.reader_od);
    ctx.fillStyle = "rgba(45, 212, 191, 0.85)";
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // Fit stats header in canvas
  const r2Val = isQuad ? (cal.quadratic ? cal.quadratic.r2 : null) : cal.r2;
  const rmseVal = isQuad ? (cal.quadratic ? cal.quadratic.rmse : null) : cal.rmse;
  const r2Str = (r2Val !== null && r2Val !== undefined) ? r2Val.toFixed(3) : "n/a";
  const rmseStr = (rmseVal !== null && rmseVal !== undefined) ? Number(rmseVal).toFixed(3) : "n/a";

  ctx.fillStyle = isQuad ? "#2DD4BF" : "#F5A524";
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.textAlign = "right";
  const statsLine = `${isQuad ? "Quad" : "Lin"} R²=${r2Str}, RMSE=${rmseStr}, n=${nVal}`;
  ctx.fillText(statsLine, padL + pw, padT - 6);

  // Warnings check: R2 < 0.95 or n < 10
  const warnMessages = [];
  if (nVal < 10) {
    warnMessages.push(`Fewer than 10 wells used for calibration (n = ${nVal}). At least 10 recommended for robust calibration.`);
  }
  if (r2Val !== null && r2Val !== undefined && r2Val < 0.95) {
    warnMessages.push(`Calibration R² (${r2Str}) is below 0.95 - correlation between image and reader is weak.`);
  }
  if (cal.warning && !warnMessages.length) {
    warnMessages.push(cal.warning);
  }

  const alertBox = $("cal-alert");
  if (alertBox) {
    if (warnMessages.length > 0) {
      alertBox.style.display = "block";
      alertBox.textContent = warnMessages.join(" ");
    } else {
      alertBox.style.display = "none";
      alertBox.textContent = "";
    }
  }

  const statsEl = $("cal-stats");
  if (statsEl) {
    statsEl.style.display = "block";
    statsEl.textContent = `Fit: ${isQuad ? "Quadratic" : "Linear"} | R²: ${r2Str} | RMSE: ${rmseStr} | n: ${nVal}`;
  }
}

export function initCalibration() {
  S.calMode = "linear";
  S.lastCal = null;

  const calModel = $("cal-model");
  if (calModel) {
    calModel.onchange = (e) => setCalibrationModel(e.target.value);
  }
  const btnLinear = $("btn-cal-linear");
  if (btnLinear) {
    btnLinear.onclick = () => setCalibrationModel("linear");
  }
  const btnQuad = $("btn-cal-quad");
  if (btnQuad) {
    btnQuad.onclick = () => setCalibrationModel("quadratic");
  }

  const fitBtn = $("fit");
  if (fitBtn) {
    fitBtn.onclick = async () => {
      const note = $("fitnote");
      if (note) note.textContent = "";
      if (!S.last) {
        if (note) note.textContent = "Run the analysis first.";
        return;
      }
      try {
        const od = {};
        S.last.wells.forEach((w) => {
          if (w.od !== null) od[w.well] = w.od;
        });
        const f = await calibrateFit({
          rows: val("rows", 8),
          cols: val("cols", 12),
          image_od: od,
          reader: $("reader")?.value || ""
        });
        S.lastCal = f;
        if ($("slope")) $("slope").value = f.slope.toFixed(4);
        if ($("icpt")) $("icpt").value = f.intercept.toFixed(4);
        if (f.quadratic && $("cal-a") && $("cal-b") && $("cal-c")) {
          $("cal-a").value = f.quadratic.a.toFixed(5);
          $("cal-b").value = f.quadratic.b.toFixed(5);
          $("cal-c").value = f.quadratic.c.toFixed(5);
        }
        const isQuad = S.calMode === "quadratic" && f.quadratic;
        const r2Val = isQuad ? f.quadratic.r2 : f.r2;
        const rmseVal = isQuad ? f.quadratic.rmse : f.rmse;
        const r2Str = (r2Val !== null && r2Val !== undefined) ? r2Val.toFixed(3) : "n/a";
        const rmseStr = (rmseVal !== null && rmseVal !== undefined) ? Number(rmseVal).toFixed(3) : "n/a";
        if (note) {
          note.textContent = `Fitted ${isQuad ? "quadratic" : "linear"} on ${f.n} wells: R² = ${r2Str}, RMSE = ${rmseStr} OD. Re-running…`;
        }

        drawCalibrationPlot(f);
        await run();
      } catch (err) {
        if (note) note.textContent = err.message;
      }
    };
  }
}
