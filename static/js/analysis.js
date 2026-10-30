"use strict";

/**
 * PlateOD Analysis Execution Module (analysis.js)
 * 
 * Single plate upload, client downscaling, HEIC/HEIF detection,
 * configuration assembly, running analysis via /api/analyze,
 * handling 410 image cache expiry retry, and dynamic range alerts.
 */

import { S, setState } from "./state.js";
import { $, el, clearChildren, showToast } from "./dom.js";
import { uploadImage, analyzePlate } from "./api.js";
import { isConvexQuad } from "./grid.js";
import { draw, initCorners, sizeCanvas, refreshGrid, updateLiveReadout, startAnalysisScan, finishAnalysisScan } from "./plate-canvas.js";
import { selectAssay } from "./presets.js";
import { updateStepperValidation } from "./validation.js";
import { renderResults } from "./results.js";
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
    assay: S.selectedAssay,
    blank_correction: $("blank-correction") ? $("blank-correction").checked : true,
    use_reader: useReader,
    reader: $("reader") ? $("reader").value : ""
  };
}

/**
 * Downscale image in browser to at most maxDim pixels before uploading.
 */
async function downscaleImageFile(file, maxDim = 2400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image format"));
      img.onload = () => {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (Math.max(w, h) <= maxDim) {
          resolve({ dataUrl: reader.result, width: w, height: h });
          return;
        }
        let scale = maxDim / Math.max(w, h);
        let nw = Math.round(w * scale);
        let nh = Math.round(h * scale);
        const oc = document.createElement("canvas");
        oc.width = nw;
        oc.height = nh;
        const octx = oc.getContext("2d");
        octx.drawImage(img, 0, 0, nw, nh);
        resolve({ dataUrl: oc.toDataURL("image/jpeg", 0.92), width: nw, height: nh });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function handleFileUpload(file) {
  if (!file) return;

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

    // Fast preview via object URL
    const previewUrl = URL.createObjectURL(file);
    const scaled = await downscaleImageFile(file, 2400);

    S.dataUrl = scaled.dataUrl;

    // Upload to server cache
    const res = await uploadImage(S.dataUrl);
    S.imageId = res.id;
    S.imageFileSize = szStr;
    setState("w", res.width || scaled.width);
    setState("h", res.height || scaled.height);

    // Update chip with dimensions
    const szEl = $("file-chip-size");
    if (szEl) szEl.textContent = `(${szStr} • ${S.w} × ${S.h} px)`;

    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(previewUrl);
      S.img = img;
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
        flying.style.backgroundImage = `url(${S.dataUrl})`;
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
        draw();
        refreshGrid();
        updateLiveReadout();

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
        draw();
        refreshGrid();
        updateLiveReadout();
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

      if (runBtn) runBtn.disabled = true;
      const resultsEl = $("results");
      if (resultsEl) resultsEl.hidden = true;

      showMsgs([], []);
      if (window.pendingAssay) {
        selectAssay(window.pendingAssay);
        window.pendingAssay = null;
      }
      updateStepperValidation();
    };
    img.src = previewUrl;
  } catch (err) {
    showMsgs([err.message], []);
  }
}

export async function run() {
  if (!S.dataUrl && !S.imageId) return;

  // Geometry validation: check crossed or degenerate corners
  if (S.corners && !isConvexQuad(S.corners)) {
    showToast("Grid corners are crossed or invalid. Please adjust the orange handles.", "error");
    showMsgs(["Grid corners are self-intersecting or degenerate. Please position A1, A12, H12, H1 onto the well corners."], []);
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
    const currentCfg = cfg();
    let res;
    try {
      res = await analyzePlate({
        image_id: S.imageId,
        image: S.dataUrl,
        config: currentCfg
      });
    } catch (apiErr) {
      // 410 Expired: automatically re-upload and retry
      if (apiErr.status === 410 && S.dataUrl) {
        const up = await uploadImage(S.dataUrl);
        S.imageId = up.id;
        res = await analyzePlate({
          image_id: S.imageId,
          image: S.dataUrl,
          config: currentCfg
        });
      } else {
        throw apiErr;
      }
    }

    // Ensure scanning runs for at least 900ms
    const elapsed = performance.now() - scanStart;
    if (elapsed < 900) {
      await new Promise((r) => setTimeout(r, 900 - elapsed));
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
