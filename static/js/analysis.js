"use strict";

/**
 * PlateOD Analysis Execution Module (analysis.js)
 * 
 * Single plate upload, client downscaling, HEIC/HEIF detection,
 * configuration assembly, running analysis via /api/analyze,
 * handling 410 image cache expiry retry, and dynamic range alerts.
 */

import { S, setState } from "./state.js";
import { startRunTimer, getActiveRunTimer } from "./perf.js";
import { $, el, clearChildren, showToast } from "./dom.js";
import { uploadImage, analyzePlate } from "./api.js";
import { isConvexQuad } from "./grid.js";
import { draw, initCorners, sizeCanvas, refreshGrid, updateLiveReadout, startAnalysisScan, finishAnalysisScan, resetCanvasPanZoom } from "./plate-canvas.js";
import { selectAssay } from "./presets.js";
import { updateStepperValidation, validateWellField, parseAndValidateWells } from "./validation.js";
import { ensureSectionOpenForElement, updateAccordionStatusChips, updateRunSummaryLine } from "./accordion.js";
import { renderResults } from "./results.js";
import { cancelLivePreview } from "./live-preview.js";
import { updateProblemsCard } from "./toast-system.js";

const val = (id, def) => {
  const elem = $(id);
  if (!elem) return def;
  const v = elem.value.trim();
  if (v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export function showMsgs(errs, warns) {
  const b = $("banner");
  if (!b) return;
  clearChildren(b);

  const lists = [[errs, "err"], [warns, "warn"]];
  let hasAny = false;

  lists.forEach(([items, kind]) => {
    if (items && items.length) {
      hasAny = true;
      const d = el("div", undefined, "msg " + kind);
      const bld = el("b", kind === "err" ? "Problems" : "Warnings");
      d.appendChild(bld);
      const u = el("ul");
      items.forEach((t) => u.appendChild(el("li", t)));
      d.appendChild(u);
      b.appendChild(d);
    }
  });

  b.className = hasAny ? "banner visible" : "banner hidden";
  updateProblemsCard(errs || [], warns || []);

  if (errs && errs.length) {
    showToast(errs[0], "error");
  } else if (warns && warns.length) {
    showToast(warns[0], "warning");
  }
}

export function cfg() {
  const useReader = Boolean($("chk-use-reader") && $("chk-use-reader").checked);
  const flatField = Boolean($("chk-flat-field") ? $("chk-flat-field").checked : true);
  const calMode = S.calMode || "linear";

  return {
    rows: val("rows", 8),
    cols: val("cols", 12),
    radius: val("radius", 0.28),
    corners: S.corners,
    channel: $("channel")?.value || "AUTO",
    flat_field: flatField,
    linearize: $("lin") ? $("lin").checked : false,
    dark_level: val("dark", 0),
    pos: $("pos")?.value || "",
    neg: $("neg")?.value || "",
    blank: $("blank")?.value || "",
    mode: $("mode")?.value || "PP",
    cutoff: val("cutoff", null),
    cutoff_low: val("cutlow", null),
    model: calMode,
    slope: val("slope", 1),
    intercept: val("icpt", 0),
    cal_mode: calMode,
    a: val("cal-a", 0),
    b: val("cal-b", 1),
    c: val("cal-c", 0),
    cal_a: val("cal-a", 0),
    cal_b: val("cal-b", 1),
    cal_c: val("cal-c", 0),
    assay: S.selectedAssay === "Custom" ? "" : (S.selectedAssay || "DIVA"),
    blank_correction: $("blank-correction") ? $("blank-correction").checked : true,
    use_reader: useReader,
    reader: $("reader") ? $("reader").value : ""
  };
}

// In-memory analysis result cache per photo + settings
const analysisResultCache = new Map();
let isRunInProgress = false;
let activeRunAbort = null;

/**
 * Downscale image in browser to at most maxDim pixels (default 2000)
 * using createImageBitmap + canvas with JPEG quality 0.92.
 */
async function downscaleImageFile(file, maxDim = 1400) {
  let source = null;
  let origW = 0;
  let origH = 0;

  if (typeof createImageBitmap === "function") {
    try {
      source = await createImageBitmap(file);
      origW = source.width;
      origH = source.height;
    } catch (_) {
      source = null;
    }
  }

  if (!source) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read image file"));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Invalid image format"));
      img.src = dataUrl;
    });
    source = img;
    origW = img.naturalWidth || img.width;
    origH = img.naturalHeight || img.height;
  }

  const maxSide = Math.max(origW, origH);
  if (maxSide <= maxDim) {
    const oc = document.createElement("canvas");
    oc.width = origW;
    oc.height = origH;
    const octx = oc.getContext("2d");
    octx.drawImage(source, 0, 0, origW, origH);
    const dataUrl = oc.toDataURL("image/jpeg", 0.88);
    if (source.close) source.close();
    return { dataUrl, width: origW, height: origH, origW, origH, scale: 1.0 };
  }

  const scale = maxDim / maxSide;
  const nw = Math.round(origW * scale);
  const nh = Math.round(origH * scale);
  const oc = document.createElement("canvas");
  oc.width = nw;
  oc.height = nh;
  const octx = oc.getContext("2d");
  octx.drawImage(source, 0, 0, nw, nh);
  const dataUrl = oc.toDataURL("image/jpeg", 0.88);
  if (source.close) source.close();
  return { dataUrl, width: nw, height: nh, origW, origH, scale };
}

export async function handleFileUpload(file) {
  if (!file) return;
  const tUploadStart = performance.now();

  // Detect HEIC/HEIF
  const name = file.name.toLowerCase();
  if (name.endsWith(".heic") || name.endsWith(".heif") || file.type.includes("heic") || file.type.includes("heif")) {
    showToast("Please export as JPG or PNG", "warning");
    showMsgs(["HEIC/HEIF files are not natively supported. Please export as JPG or PNG."], []);
    return;
  }

  // Update file chip with initial size
  const chip = $("file-chip");
  const szStr = file.size < 1048576
    ? (file.size / 1024).toFixed(1) + " KB"
    : (file.size / 1048576).toFixed(1) + " MB";
  if (chip) {
    chip.hidden = false;
    const nameEl = $("file-chip-name");
    if (nameEl) nameEl.textContent = file.name;
    const szEl = $("file-chip-size");
    if (szEl) szEl.textContent = `(${szStr})`;
  }

  try {
    const runBtn = $("run");
    if (runBtn) runBtn.disabled = true;

    // 1. Instant visual display via Object URL (< 25 ms)
    const previewUrl = URL.createObjectURL(file);
    const img = new Image();

    // 2. Concurrently start downscaling & server upload in background
    S.uploadPromise = (async () => {
      try {
        const scaled = await downscaleImageFile(file, 1400);
        S.dataUrl = scaled.dataUrl;
        S.downscaleScale = scaled.scale;
        S.origW = scaled.origW;
        S.origH = scaled.origH;
        const res = await uploadImage(scaled.dataUrl);
        S.imageId = res.id;
        S.imageFileSize = szStr;
        const szEl = $("file-chip-size");
        if (szEl) szEl.textContent = `(${szStr} • ${scaled.origW} × ${scaled.origH} px)`;
        return res;
      } catch (err) {
        console.warn("[Upload] Background upload failed:", err);
        return null;
      }
    })();

    await new Promise((resolve, reject) => {
      img.onload = () => {
        S.img = img;
        S.origW = img.naturalWidth;
        S.origH = img.naturalHeight;
        setState("w", img.naturalWidth);
        setState("h", img.naturalHeight);
        initCorners();

      const ph = $("ph");
      const cv = $("cv");
      const stage = $("stage");

      // FLIP Animation: thumbnail flies from dropzone into canvas
      const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!prefersReduced && ph && ph.offsetWidth > 0) {
        const startRect = ph.getBoundingClientRect();
        const flying = document.createElement("div");
        flying.className = "flip-flying-thumbnail";
        flying.style.position = "fixed";
        flying.style.top = `${startRect.top}px`;
        flying.style.left = `${startRect.left}px`;
        flying.style.width = `${startRect.width}px`;
        flying.style.height = `${startRect.height}px`;
        flying.style.backgroundImage = `url(${previewUrl})`;
        flying.style.backgroundSize = "contain";
        flying.style.backgroundRepeat = "no-repeat";
        flying.style.backgroundPosition = "center";
        flying.style.borderRadius = "14px";
        flying.style.zIndex = "9999";
        flying.style.boxShadow = "0 16px 48px rgba(0, 0, 0, 0.7), 0 0 24px rgba(245, 165, 36, 0.5)";
        flying.style.pointerEvents = "none";
        flying.style.transition = "transform 440ms cubic-bezier(.2,.8,.2,1), opacity 440ms ease";
        document.body.appendChild(flying);

        stage?.classList.add("has-image");
        if (ph) ph.hidden = true;
        if (cv) cv.hidden = false;
        sizeCanvas();
        resetCanvasPanZoom();
        draw();
        refreshGrid();
        updateLiveReadout();
        console.log(`[Upload Time] File to canvas display: ${(performance.now() - tUploadStart).toFixed(1)} ms`);

        const endRect = cv.getBoundingClientRect();
        const dx = (endRect.left + endRect.width / 2) - (startRect.left + startRect.width / 2);
        const dy = (endRect.top + endRect.height / 2) - (startRect.top + startRect.height / 2);
        const scale = (endRect.width || 400) / (startRect.width || 400);

        requestAnimationFrame(() => {
          flying.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
          flying.style.opacity = "0.75";
        });

        setTimeout(() => {
          if (flying.parentElement) flying.parentElement.removeChild(flying);
        }, 460);
      } else {
        stage?.classList.add("has-image");
        if (ph) ph.hidden = true;
        if (cv) cv.hidden = false;
        sizeCanvas();
        resetCanvasPanZoom();
        draw();
        refreshGrid();
        updateLiveReadout();
        console.log(`[Upload Time] File to canvas display: ${(performance.now() - tUploadStart).toFixed(1)} ms`);
      }

      const cardAssay = $("card-assay");
      if (cardAssay) cardAssay.hidden = false;
      selectAssay(S.selectedAssay || "SPCE");
      const runBtn = $("run");
      if (runBtn) runBtn.disabled = false;
      const customBadge = $("badge-customised");
      if (customBadge) customBadge.hidden = true;

      const modeEl = $("mode");
      if (modeEl) modeEl.disabled = false;

      const resultsEl = $("results");
      if (resultsEl) resultsEl.hidden = true;

      showMsgs([], []);
      if (window.pendingAssay) {
        selectAssay(window.pendingAssay);
        window.pendingAssay = null;
      }
      updateStepperValidation();
      updateAccordionStatusChips();
        resolve();
      };
      img.onerror = () => reject(new Error("Failed to load image element"));
      img.src = previewUrl;
    });
  } catch (err) {
    showMsgs([err.message], []);
  }
}

export async function run() {
  if (isRunInProgress) {
    console.log("[Run] Click ignored: analysis already in progress");
    return;
  }
  isRunInProgress = true;
  window.__isAnalysisRunning = true;

  // Cancel any active or scheduled live preview to prevent server concurrency contention
  cancelLivePreview();

  if (activeRunAbort) {
    activeRunAbort.abort();
  }
  activeRunAbort = new AbortController();

  const perfRunTimer = startRunTimer(S.selectedAssay || "Run");
  perfRunTimer.markPrepStart();
  if (!S.dataUrl && !S.imageId) {
    const fileInp = $("file") || $("stage");
    if (fileInp) ensureSectionOpenForElement(fileInp);
    showToast("Please upload a plate photo before running analysis.", "warning");
    return;
  }

  // Geometry validation: check crossed or degenerate corners
  if (S.corners && !isConvexQuad(S.corners)) {
    const cardPlate = $("step-card-1");
    if (cardPlate) ensureSectionOpenForElement(cardPlate);
    showToast("Grid corners are crossed or invalid. Please adjust the orange handles.", "error");
    showMsgs(["Grid corners are self-intersecting or degenerate. Please position A1, A12, H12, H1 onto the well corners."], []);
    return;
  }

  // Field validation with auto-expansion for collapsed accordion sections
  const posEl = $("pos");
  const negEl = $("neg");
  const blankEl = $("blank");
  const isSpce = (S.selectedAssay === "SPCE" && !posEl?.value.trim());

  if (posEl && !validateWellField(posEl, $("pos-err"), isSpce)) {
    ensureSectionOpenForElement(posEl);
    showToast("Invalid Positive control well address (e.g. A1, A1-B2)", "error");
    return;
  }
  if (negEl && !validateWellField(negEl, $("neg-err"), false)) {
    ensureSectionOpenForElement(negEl);
    showToast("Invalid Negative control well address (e.g. C1-D1)", "error");
    return;
  }
  if (blankEl && !validateWellField(blankEl, $("blank-err"), false)) {
    ensureSectionOpenForElement(blankEl);
    showToast("Invalid Blank reference well address (e.g. E1-H1)", "error");
    return;
  }

  // Check well role mutual exclusion
  const maxRows = +($("rows")?.value) || 8;
  const maxCols = +($("cols")?.value) || 12;
  const pSet = parseAndValidateWells(posEl?.value, maxRows, maxCols).wells;
  const nSet = parseAndValidateWells(negEl?.value, maxRows, maxCols).wells;
  const bSet = parseAndValidateWells(blankEl?.value, maxRows, maxCols).wells;
  const overlap = [...pSet].filter((w) => nSet.has(w) || bSet.has(w)).concat([...nSet].filter((w) => bSet.has(w)));
  if (overlap.length > 0) {
    ensureSectionOpenForElement(negEl || posEl);
    showToast(`Well ${overlap.join(", ")} assigned to multiple roles`, "error");
    return;
  }

  const cutoffEl = $("cutoff");
  if (cutoffEl && (isNaN(parseFloat(cutoffEl.value)) || parseFloat(cutoffEl.value) <= 0)) {
    ensureSectionOpenForElement(cutoffEl);
    showToast("Invalid Cutoff percentage threshold", "error");
    return;
  }

  const cutlowEl = $("cutlow");
  if (cutlowEl && cutlowEl.value.trim() !== "") {
    const val = parseFloat(cutlowEl.value);
    const cutVal = parseFloat(cutoffEl?.value);
    if (isNaN(val) || (!isNaN(cutVal) && val >= cutVal)) {
      ensureSectionOpenForElement(cutlowEl);
      showToast("Doubtful lower cutoff must be below cutoff", "error");
      return;
    }
  }

  const slopeEl = $("slope");
  const icptEl = $("icpt");
  if (slopeEl && isNaN(parseFloat(slopeEl.value))) {
    ensureSectionOpenForElement(slopeEl);
    showToast("Invalid Calibration slope value", "error");
    return;
  }
  if (icptEl && isNaN(parseFloat(icptEl.value))) {
    ensureSectionOpenForElement(icptEl);
    showToast("Invalid Calibration intercept value", "error");
    return;
  }

  const runBtn = $("run");
  if (runBtn) {
    runBtn.disabled = true;
    clearChildren(runBtn);
    const spinner = el("span", undefined, "btn-spinner");
    spinner.setAttribute("aria-hidden", "true");
    const textSpan = el("span", "Analysing…");
    runBtn.appendChild(spinner);
    runBtn.appendChild(textSpan);
  }

  const skeleton = $("skeleton-loader");
  if (skeleton) skeleton.hidden = false;

  startAnalysisScan();
  document.body.classList.add("analyzing-active");
  const scanStart = performance.now();

  try {
    perfRunTimer.markPrepEnd();

    // Ensure background upload finishes
    if (S.uploadPromise) {
      try {
        await S.uploadPromise;
      } catch (_) {}
    }

    const currentCfg = cfg();
    if (S.downscaleScale && S.downscaleScale !== 1.0 && currentCfg.corners) {
      currentCfg.corners = currentCfg.corners.map(([x, y]) => [
        x * S.downscaleScale,
        y * S.downscaleScale
      ]);
    }

    // Check in-memory result cache per photo + settings
    const cacheKey = `${S.imageId || S.dataUrl?.slice(0, 48)}_${JSON.stringify(currentCfg)}`;
    let res = analysisResultCache.get(cacheKey);

    if (res) {
      console.log("[Run] Serving result from in-memory cache");
      perfRunTimer.markUploadStart();
      perfRunTimer.markTtfb();
      perfRunTimer.markDownloadEnd();
      perfRunTimer.markJsonEnd();
    } else {
      // Send image_id only when available; fallback to image only if image_id is absent
      const payload = S.imageId
        ? { image_id: S.imageId, config: currentCfg }
        : { image: S.dataUrl, config: currentCfg };
      console.log("[Run Payload]", { hasImageId: !!payload.image_id, imageId: payload.image_id, hasImage: !!payload.image, imageLen: payload.image?.length });

      try {
        res = await analyzePlate(payload, activeRunAbort.signal);
      } catch (apiErr) {
        // 410 Expired: automatically re-upload and retry
        if (apiErr.status === 410 && S.dataUrl) {
          const up = await uploadImage(S.dataUrl);
          S.imageId = up.id;
          res = await analyzePlate({
            image_id: S.imageId,
            config: currentCfg
          }, activeRunAbort.signal);
        } else {
          throw apiErr;
        }
      }
      analysisResultCache.set(cacheKey, res);
    }

    finishAnalysisScan(res.valid, () => {
      document.body.classList.remove("analyzing-active");
      S.last = res;
      const emptyState = $("results-empty-state");
      if (emptyState) emptyState.hidden = true;
      renderResults(res);
    });

    // Show warnings if any
    const warns = [];
    if (res.warnings && res.warnings.length) {
      warns.push(...res.warnings);
    }
    if (res.channel_used && currentCfg.channel === "AUTO") {
      warns.push(`Auto Channel: used ${res.channel_used}${res.channel_reason ? " (" + res.channel_reason + ")" : ""}`);
    }
    showMsgs(res.problems || [], warns);

    showToast(
      res.valid ? "Analysis complete · QC PASS" : "Analysis complete with QC alerts",
      res.valid ? "success" : "warning"
    );

    // Redraw canvas with well classifications
    draw();
  } catch (err) {
    showMsgs([err.message], []);
    const resultsEl = $("results");
    if (resultsEl) resultsEl.hidden = true;
    const emptyState = $("results-empty-state");
    if (emptyState) emptyState.hidden = false;
  } finally {
    window.__isAnalysisRunning = false;
    isRunInProgress = false;
    if (skeleton) skeleton.hidden = true;
    if (runBtn) {
      runBtn.disabled = false;
      clearChildren(runBtn);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "18");
      svg.setAttribute("height", "18");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "currentColor");
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      poly.setAttribute("points", "5 3 19 12 5 21 5 3");
      svg.appendChild(poly);
      const textSpan = el("span", "Run analysis");
      runBtn.appendChild(svg);
      runBtn.appendChild(textSpan);
    }
  }
}

export function initUpload() {
  const stage = $("stage");
  if (stage) {
    const phBox = $("ph");
    ["dragenter", "dragover"].forEach((evt) => {
      stage.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        stage.classList.add("dragover");
        if (phBox) phBox.classList.add("drag-active");
        const ghost = $("ghost-plate-wrap");
        if (ghost) ghost.classList.add("visible");
      });
    });
    ["dragleave", "drop"].forEach((evt) => {
      stage.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        stage.classList.remove("dragover");
        if (phBox) phBox.classList.remove("drag-active");
        const ghost = $("ghost-plate-wrap");
        if (ghost) ghost.classList.remove("visible");
      });
    });
    stage.addEventListener("drop", (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        handleFileUpload(files[0]);
      }
    });
    stage.addEventListener("click", (e) => {
      const ph = $("ph");
      if (!S.img || e.target === ph || ph?.contains(e.target)) {
        $("file")?.click();
      }
    });
  }

  const fileInput = $("file");
  if (fileInput) {
    fileInput.onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleFileUpload(f);
    };
  }
}

export function initAnalysis() {
  const runBtn = $("run");
  if (runBtn) runBtn.onclick = run;

  // Direct reader / paper mode checkboxes
  const chkUseReader = $("chk-use-reader");
  if (chkUseReader) {
    chkUseReader.onchange = async () => {
      if (S.last) await run();
    };
  }

  const btnUseReader = $("btn-use-reader");
  if (btnUseReader) {
    btnUseReader.onclick = async () => {
      const txt = $("reader")?.value.trim();
      if (!txt) {
        showToast("Paste plate-reader OD values into the box first.", "warning");
        $("reader")?.focus();
        return;
      }
      if (chkUseReader) chkUseReader.checked = true;
      showToast("Evaluating plate with direct Reader ODs...", "info");
      await run();
    };
  }

  const blankCorr = $("blank-correction");
  if (blankCorr) {
    blankCorr.onchange = async () => {
      if (S.last) await run();
    };
  }
}
