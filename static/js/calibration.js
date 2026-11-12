"use strict";

/**
 * PlateOD Calibration Module (calibration.js)
 *
 * Single source of truth for calibration model selection ("linear", "quadratic",
 * "svr", "ann"), per-well model prediction storage, centralized
 * applySelectedCalibrationModel() downstream recalculation, and reader scatter fitting.
 */

import { S } from "./state.js";
import { $, showToast } from "./dom.js";
import { calibrateFit, predictMlCalibration } from "./api.js";
import { run, showMsgs } from "./analysis.js";
import { renderResults, refreshOpenInspector } from "./results.js";

const MIN_SEP = 0.05;

export const ALLOWED_CALIBRATION_MODELS = ["linear", "quadratic", "svr", "ann"];

const MODEL_LABELS = {
  linear: "Linear",
  quadratic: "Quadratic",
  svr: "SVR",
  ann: "ANN / MLP"
};

const mlPredictionCache = new Map();

const val = (id, def) => {
  const elem = $(id);
  if (!elem) return def;
  const v = elem.value.trim();
  if (v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const round4 = (v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Math.round(Number(v) * 10000) / 10000 : null);
const round2 = (v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);

export function normalizeCalibrationModel(mode) {
  const raw = String(mode || "linear").trim().toLowerCase();
  if (raw === "quadratic" || raw === "quad") return "quadratic";
  if (raw === "svr") return "svr";
  if (raw === "ann" || raw === "ann/mlp" || raw === "ann / mlp" || raw === "mlp") return "ann";
  return "linear";
}

export function getCalibrationModelLabel(mode) {
  return MODEL_LABELS[normalizeCalibrationModel(mode)] || "Linear";
}

export function readLinearQuadCoeffs(res = null) {
  const snap = res && res._coeffs ? res._coeffs : null;
  return {
    slope: val("slope", snap ? snap.slope : 1),
    intercept: val("icpt", snap ? snap.intercept : 0),
    a: val("cal-a", snap ? snap.a : 0),
    b: val("cal-b", snap ? snap.b : 1),
    c: val("cal-c", snap ? snap.c : 0)
  };
}

/**
 * Clears cached ML predictions when a new plate image is loaded so stale
 * predictions from a previous plate can never be reused.
 */
export function resetPlateMlPredictions() {
  mlPredictionCache.clear();
  updateMlStatusUI();
}

/**
 * Computes and stores independent Linear and Quadratic calibrated OD values
 * on every well without modifying original photographic Image OD (`w.od`).
 */
export function computeWellLinearQuadraticModels(res, coeffs = null) {
  if (!res || !Array.isArray(res.wells)) return;
  const c = coeffs || readLinearQuadCoeffs(res);
  res._coeffs = { ...c };

  res.wells.forEach((w) => {
    if (!w || typeof w !== "object") return;
    if (w.od !== null && w.od !== undefined && Number.isFinite(Number(w.od))) {
      const x = Number(w.od);
      w.od_linear = round4(c.slope * x + c.intercept);
      w.od_quadratic = round4(c.a * (x * x) + c.b * x + c.c);
    } else {
      w.od_linear = null;
      w.od_quadratic = null;
    }
    if (!Object.prototype.hasOwnProperty.call(w, "od_svr")) w.od_svr = null;
    if (!Object.prototype.hasOwnProperty.call(w, "od_ann")) w.od_ann = null;
  });
}

/**
 * Fetches SVR and ANN/MLP calibrated ODs in one batch request to the configured
 * ML API (`window.PLATEOD_CONFIG.ML_API_BASE_URL/calibrate/batch`) and merges
 * predictions strictly by well ID (`w.well`). Never alters `w.od`.
 */
export async function fetchAndAttachMlPredictions(res, signal = null) {
  if (!res || !Array.isArray(res.wells)) {
    return { ok: false, error: "No wells available for ML calibration." };
  }

  // Initialize fields cleanly; never fabricate or copy Image OD
  res.wells.forEach((w) => {
    if (w && typeof w === "object") {
      w.od_svr = null;
      w.od_ann = null;
    }
  });

  const mlPayload = res.wells
    .filter((w) => w && typeof w.well === "string" && w.od !== null && w.od !== undefined && Number.isFinite(Number(w.od)))
    .map((w) => ({ well: w.well, image_od: Number(w.od) }));

  if (mlPayload.length === 0) {
    res.mlCalibration = { ok: false, error: "No finite Image OD values available." };
    updateMlStatusUI(res);
    return res.mlCalibration;
  }

  const cacheKey = JSON.stringify(mlPayload);
  let mlRes = mlPredictionCache.get(cacheKey);

  if (!mlRes) {
    const mlStatusEl = $("ml-cal-status");
    if (mlStatusEl) mlStatusEl.textContent = "Running ML calibration (SVR & ANN/MLP)...";
    try {
      mlRes = await predictMlCalibration(mlPayload, signal);
      mlPredictionCache.set(cacheKey, mlRes);
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw err;
      }
      console.warn("[Calibration] ML API unavailable:", err);
      res.mlCalibration = {
        ok: false,
        error: err?.message || "ML calibration backend unavailable."
      };
      updateMlStatusUI(res);
      return res.mlCalibration;
    }
  }

  const predByWell = new Map();
  if (Array.isArray(mlRes.results)) {
    mlRes.results.forEach((item) => {
      if (item && typeof item.well === "string") {
        predByWell.set(item.well.trim().toUpperCase(), item);
      }
    });
  }

  res.wells.forEach((w) => {
    if (!w || typeof w.well !== "string") return;
    const pred = predByWell.get(w.well.trim().toUpperCase());
    const svrNum = pred ? Number(pred.svr_calibrated_od) : NaN;
    const annNum = pred ? Number(pred.ann_mlp_calibrated_od) : NaN;
    w.od_svr = Number.isFinite(svrNum) ? svrNum : null;
    w.od_ann = Number.isFinite(annNum) ? annNum : null;
  });

  res.mlCalibration = {
    ok: true,
    models: Array.isArray(mlRes.models) ? mlRes.models : ["SVR", "ANN/MLP"],
    count: predByWell.size
  };
  updateMlStatusUI(res);
  return res.mlCalibration;
}

/**
 * Central calibration projection & downstream recalculation function.
 * Maps the selected model ("linear" | "quadratic" | "svr" | "ann") onto
 * canonical `w.od_cal` (leaving `w.od` untouched) and recalculates PI/PP value,
 * class, control summaries, and QC status from `w.od_cal`.
 */
export function applySelectedCalibrationModel(results, selectedModel) {
  if (!results || !Array.isArray(results.wells)) return results;

  const model = normalizeCalibrationModel(selectedModel);
  results.selectedCalibrationModel = model;
  results.model = model;
  results.cal_mode = model;

  const usedReader = Boolean(results.reference && results.reference.used_reader_ods);

  // Capture base (optical/blank-brightness) errors once so model switches recompute control QC cleanly
  if (!Array.isArray(results._baseErrors)) {
    results._baseErrors = Array.isArray(results.errors)
      ? results.errors.filter((msg) => typeof msg === "string" && msg.startsWith("Blank wells are not brighter"))
      : [];
  }

  // 1. Set canonical `w.od_cal` from the selected stored model field
  results.wells.forEach((w) => {
    if (!w || typeof w !== "object") return;
    if (usedReader) {
      return; // Direct Reader/Paper mode preserves direct spectrophotometer ODs
    }
    if (model === "linear") {
      w.od_cal = w.od_linear !== undefined ? w.od_linear : null;
    } else if (model === "quadratic") {
      w.od_cal = w.od_quadratic !== undefined ? w.od_quadratic : null;
    } else if (model === "svr") {
      w.od_cal = w.od_svr !== undefined ? w.od_svr : null;
    } else if (model === "ann") {
      w.od_cal = w.od_ann !== undefined ? w.od_ann : null;
    }
  });

  if (usedReader) {
    return results;
  }

  // 2. Recalculate downstream PI / PP, classification, control ODs, and QC from w.od_cal
  const mode = String(results.mode || "PP").toUpperCase();
  const cutoff = Number.isFinite(Number(results.cutoff)) ? Number(results.cutoff) : (mode === "PP" ? 40.0 : 65.0);
  const cutLowRaw = results.cutoff_low !== undefined ? results.cutoff_low : results._cutoffLow;
  const cutLow = (cutLowRaw !== null && cutLowRaw !== undefined && cutLowRaw !== "" && Number.isFinite(Number(cutLowRaw)))
    ? Number(cutLowRaw)
    : null;
  results._cutoffLow = cutLow;

  const blankCorrection = results._blankCorrection !== undefined
    ? Boolean(results._blankCorrection)
    : ($("blank-correction") ? $("blank-correction").checked : true);
  results._blankCorrection = blankCorrection;

  const isBlankRole = (r) => r === "Blank";
  const isNegRole = (r) => r === "Negative ctrl" || (typeof r === "string" && r.includes("Antigen"));
  const isPosRole = (r) => r === "Positive ctrl";

  const collectFiniteCalOd = (pred) => results.wells
    .filter((w) => w && pred(w.role) && w.od_cal !== null && w.od_cal !== undefined && Number.isFinite(Number(w.od_cal)))
    .map((w) => Number(w.od_cal));

  const posWells = results.wells.filter((w) => w && isPosRole(w.role));
  const pv = collectFiniteCalOd(isPosRole);
  const nv = collectFiniteCalOd(isNegRole);
  const bv = collectFiniteCalOd(isBlankRole);

  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const posOd = pv.length > 0 ? mean(pv) : null;
  const negOd = nv.length > 0 ? mean(nv) : null;
  const blankOd = bv.length > 0 ? mean(bv) : 0.0;

  const errors = [...results._baseErrors];
  const computeVal = (odCal) => {
    if (odCal === null || odCal === undefined || !Number.isFinite(Number(odCal))) return null;
    const valNum = Number(odCal);
    if (mode === "PP") {
      const d = posOd - negOd;
      return 100.0 * (valNum - negOd) / d;
    }
    const useBlankSub = blankCorrection && Math.abs(blankOd) > 1e-4;
    const netNeg = useBlankSub ? (negOd - blankOd) : negOd;
    return useBlankSub
      ? 100.0 * (1.0 - (valNum - blankOd) / netNeg)
      : 100.0 * (1.0 - valNum / negOd);
  };

  const isMlSelected = model === "svr" || model === "ann";
  if (isMlSelected && results.mlCalibration && results.mlCalibration.ok === false) {
    errors.push(`ML calibration (${getCalibrationModelLabel(model)}) is unavailable for this plate.`);
  } else if (nv.length === 0 || (posWells.length > 0 && pv.length === 0)) {
    errors.push("Positive or negative control wells have no usable calibrated OD values.");
  } else if (mode === "PP") {
    const d = posOd - negOd;
    if (d < MIN_SEP) {
      const hint = d < 0 ? " (controls look swapped, or this is a competitive assay - use PI mode)" : "";
      errors.push(`Positive control OD ${posOd.toFixed(3)} is not clearly above negative control OD ${negOd.toFixed(3)}; PP cannot be computed${hint}.`);
    }
  } else {
    const useBlankSub = blankCorrection && Math.abs(blankOd) > 1e-4;
    const netNeg = useBlankSub ? (negOd - blankOd) : negOd;
    if (netNeg < MIN_SEP) {
      errors.push(`Negative (maximum-signal) control OD ${negOd.toFixed(3)} is too low for PI.`);
    } else if (posWells.length > 0 && pv.length > 0) {
      const pvVals = pv.map((v) => computeVal(v)).filter((v) => v !== null && Number.isFinite(v));
      const pvMean = mean(pvVals);
      if (pvMean !== null && pvMean < cutoff) {
        errors.push(`Positive control inhibition ${pvMean.toFixed(1)}% is below the cutoff ${cutoff}% - the plate fails QC.`);
      }
    }
  }

  const valid = errors.length === 0;
  results.errors = errors;
  results.valid = valid;

  let posCount = 0, negCount = 0, dbtCount = 0, invCount = 0;

  results.wells.forEach((w) => {
    if (!w || typeof w !== "object") return;
    const rawVal = valid ? computeVal(w.od_cal) : null;
    w.value = valid && rawVal !== null && Number.isFinite(rawVal) ? round2(rawVal) : null;

    if (isBlankRole(w.role)) {
      w.class = "Blank";
    } else if (w.role !== "Sample") {
      w.class = "Control";
    } else if (w.intensity === null || w.intensity === undefined || !Number.isFinite(Number(w.intensity))) {
      w.class = "No data";
      invCount++;
    } else if (!valid || w.value === null || !Number.isFinite(w.value)) {
      w.class = "Invalid";
      invCount++;
    } else if (w.value >= cutoff) {
      w.class = "Positive";
      posCount++;
    } else if (cutLow !== null && w.value >= cutLow) {
      w.class = "Doubtful";
      dbtCount++;
    } else {
      w.class = "Negative";
      negCount++;
    }
  });

  if (results.summary) {
    results.summary.pos_od = posOd !== null ? Math.round(posOd * 1e6) / 1e6 : null;
    results.summary.neg_od = negOd !== null ? Math.round(negOd * 1e6) / 1e6 : null;
    results.summary.blank_od = blankOd !== null ? Math.round(blankOd * 1e6) / 1e6 : 0.0;
    results.summary.delta_od = (posOd === null || negOd === null) ? null : Math.round((posOd - negOd) * 1e6) / 1e6;
    results.summary.positive = posCount;
    results.summary.negative = negCount;
    results.summary.doubtful = dbtCount;
    results.summary.invalid = invCount;
  }

  if (results.reference) {
    results.reference.pos_od = results.summary?.pos_od ?? null;
    results.reference.neg_od = results.summary?.neg_od ?? null;
    results.reference.blank_od = results.summary?.blank_od ?? 0.0;
    results.reference.calibration_model = getCalibrationModelLabel(model);
    if (mode === "PI") {
      results.reference.max_od = results.reference.neg_od;
      results.reference.cutoff_od = negOd !== null ? negOd * (1.0 - cutoff / 100.0) : null;
    } else {
      results.reference.cutoff_od = (posOd !== null && negOd !== null) ? negOd + (cutoff / 100.0) * (posOd - negOd) : null;
    }
  }

  return results;
}

export function updateMlStatusUI(res = S.last) {
  const statusEl = $("ml-cal-status");
  if (!statusEl) return;
  const model = S.selectedCalibrationModel || "linear";
  const label = getCalibrationModelLabel(model);

  if (!res) {
    statusEl.textContent = (model === "svr" || model === "ann")
      ? `${label} selected — run analysis to generate ML calibrated ODs.`
      : "Image OD is automatically sent to the ML calibration backend on Run.";
    statusEl.style.color = "";
    return;
  }

  if (res.mlCalibration && res.mlCalibration.ok === false) {
    statusEl.textContent = "ML calibration unavailable. Linear and Quadratic remain available.";
    statusEl.style.color = "var(--color-warning, #F5A524)";
    return;
  }

  if (res.mlCalibration && res.mlCalibration.ok) {
    statusEl.textContent = `${label} active — ML predictions loaded for ${res.mlCalibration.count} wells.`;
    statusEl.style.color = "var(--color-success, #34D3BE)";
    return;
  }

  statusEl.textContent = "ML predictions pending — click Run analysis to calibrate this plate.";
  statusEl.style.color = "";
}

export function setCalibrationModel(mode) {
  const normalized = normalizeCalibrationModel(mode);
  S.selectedCalibrationModel = normalized;
  S.calMode = normalized;

  const calModel = $("cal-model");
  if (calModel) calModel.value = normalized;

  const btnLinear = $("btn-cal-linear");
  const btnQuad = $("btn-cal-quad");
  if (btnLinear && btnQuad) {
    const isQuad = normalized === "quadratic";
    const isLin = normalized === "linear";
    btnLinear.classList.toggle("active", isLin);
    btnLinear.setAttribute("aria-checked", String(isLin));
    btnQuad.classList.toggle("active", isQuad);
    btnQuad.setAttribute("aria-checked", String(isQuad));
  }

  const linParams = $("linear-params");
  const quadParams = $("quad-params");
  const mlParams = $("ml-params");
  if (linParams) linParams.hidden = (normalized !== "linear");
  if (quadParams) quadParams.hidden = (normalized !== "quadratic");
  if (mlParams) mlParams.hidden = (normalized !== "svr" && normalized !== "ann");

  const chipCal = $("chip-status-cal");
  if (chipCal) {
    chipCal.textContent = getCalibrationModelLabel(normalized);
    chipCal.classList.toggle("is-active", normalized !== "linear" || $("chk-use-reader")?.checked);
  }

  updateMlStatusUI(S.last);

  if (S.lastCal && (normalized === "linear" || normalized === "quadratic")) {
    drawCalibrationPlot(S.lastCal);
  }

  // Live switching after analysis without re-upload or duplicate API requests
  if (S.last && Array.isArray(S.last.wells)) {
    computeWellLinearQuadraticModels(S.last);
    applySelectedCalibrationModel(S.last, normalized);
    renderResults(S.last);
    refreshOpenInspector();

    const warns = Array.isArray(S.last.warnings) ? [...S.last.warnings] : [];
    if ((normalized === "svr" || normalized === "ann") && S.last.mlCalibration && S.last.mlCalibration.ok === false) {
      const warnMsg = "ML calibration unavailable. Linear and Quadratic remain available.";
      if (!warns.includes(warnMsg)) warns.push(warnMsg);
      showToast(warnMsg, "warning");
    }
    showMsgs(S.last.problems || [], warns);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("plateod:calibration-changed", { detail: { model: normalized } }));
  }
}

export function drawCalibrationPlot(cal) {
  const cv = $("cal-scatter-cv");
  if (!cv || !cal || !cal.points || !cal.points.length) return;
  cv.style.display = "block";
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);

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

  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + ph); ctx.lineTo(padL + pw, padT + ph);
  ctx.stroke();

  ctx.fillStyle = "#A3AFBF";
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Image OD", padL + pw / 2, h - 8);
  ctx.save();
  ctx.translate(12, padT + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Reader OD", 0, 0);
  ctx.restore();

  const isQuad = S.selectedCalibrationModel === "quadratic" && cal.quadratic;
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

  const r2Val = isQuad ? (cal.quadratic ? cal.quadratic.r2 : null) : cal.r2;
  const rmseVal = isQuad ? (cal.quadratic ? cal.quadratic.rmse : null) : cal.rmse;
  const r2Str = (r2Val !== null && r2Val !== undefined) ? r2Val.toFixed(3) : "n/a";
  const rmseStr = (rmseVal !== null && rmseVal !== undefined) ? Number(rmseVal).toFixed(3) : "n/a";

  ctx.fillStyle = isQuad ? "#2DD4BF" : "#F5A524";
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.textAlign = "right";
  const statsLine = `${isQuad ? "Quad" : "Lin"} R²=${r2Str}, RMSE=${rmseStr}, n=${nVal}`;
  ctx.fillText(statsLine, padL + pw, padT - 6);

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
  const initialModel = normalizeCalibrationModel($("cal-model")?.value || S.selectedCalibrationModel || "linear");
  S.selectedCalibrationModel = initialModel;
  S.calMode = initialModel;
  S.lastCal = null;

  const calModel = $("cal-model");
  if (calModel) {
    calModel.value = initialModel;
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

  // Keep linear/quadratic edits synchronized with already-analyzed wells
  ["slope", "icpt", "cal-a", "cal-b", "cal-c"].forEach((id) => {
    $(id)?.addEventListener("change", () => {
      if (S.last && (S.selectedCalibrationModel === "linear" || S.selectedCalibrationModel === "quadratic")) {
        computeWellLinearQuadraticModels(S.last);
        applySelectedCalibrationModel(S.last, S.selectedCalibrationModel);
        renderResults(S.last);
        refreshOpenInspector();
      }
    });
  });

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
        const isQuad = S.selectedCalibrationModel === "quadratic" && f.quadratic;
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

  setCalibrationModel(initialModel);
}
