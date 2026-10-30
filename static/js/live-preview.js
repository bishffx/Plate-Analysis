"use strict";

/**
 * PlateOD Live Preview Module (live-preview.js)
 * 
 * Debounced real-time optical density preview. Calls /api/analyze quietly
 * with AbortController whenever corners, wells, channel or radius change.
 * Renders a mini heatmap, blank-reference status, and control ODs.
 */

import { $, clearChildren } from "./dom.js";
import { S } from "./state.js";
import { cfg } from "./analysis.js";

let debounceTimer = null;
let activeAbortController = null;

export function scheduleLivePreview(delayMs = 600) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    executeLivePreview();
  }, delayMs);
}

export async function executeLivePreview() {
  if (!S.img || !S.corners) {
    const strip = $("live-preview-strip");
    if (strip) strip.hidden = true;
    return;
  }

  // Cancel prior in-flight preview request
  if (activeAbortController) {
    activeAbortController.abort();
  }
  activeAbortController = new AbortController();

  const strip = $("live-preview-strip");
  const pulseStatus = $("preview-pulse-status");
  const errorHint = $("preview-error-hint");

  if (strip) {
    strip.hidden = false;
    strip.classList.add("preview-pending");
  }
  if (pulseStatus) {
    pulseStatus.textContent = "Calculating…";
  }

  try {
    const payload = cfg();
    if (!payload.image_id && S.imageId) {
      payload.image_id = S.imageId;
    }
    if (!payload.image_id && S.dataUrl) {
      payload.image = S.dataUrl;
    }

    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: activeAbortController.signal
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson.detail || errJson.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    const data = await res.json();
    renderLivePreviewSuccess(data);
  } catch (err) {
    if (err.name === "AbortError") {
      return; // Request was aborted in favor of newer user edits
    }
    renderLivePreviewError(err);
  } finally {
    if (strip) {
      strip.classList.remove("preview-pending");
    }
  }
}

function renderLivePreviewSuccess(data) {
  const strip = $("live-preview-strip");
  const pulseStatus = $("preview-pulse-status");
  const tagBlank = $("preview-tag-blank");
  const tagControls = $("preview-tag-controls");
  const tagQC = $("preview-tag-qc");
  const quickSummary = $("preview-quick-summary");
  const errorHint = $("preview-error-hint");

  if (strip) strip.hidden = false;
  if (errorHint) errorHint.hidden = true;
  if (pulseStatus) pulseStatus.textContent = "Synchronised";

  // Blank status
  if (tagBlank && data.blank_mean !== undefined) {
    const blkVal = Number(data.blank_mean);
    const blkStatus = blkVal > 0.35 ? "Elevated" : (blkVal < 0.02 ? "Low" : "Optimal");
    tagBlank.textContent = `Blank: ${blkVal.toFixed(3)} OD (${blkStatus})`;
    tagBlank.className = blkStatus === "Optimal" ? "preview-tag tag-pass" : "preview-tag tag-warn";
  }

  // Controls status
  if (tagControls) {
    if (data.mode === "PI") {
      const agVal = Number(data.antigen_mean || 0);
      tagControls.textContent = `Max Signal: ${agVal.toFixed(3)} OD`;
    } else {
      const posVal = Number(data.pos_mean || 0);
      const negVal = Number(data.neg_mean || 0);
      const ratio = negVal > 0 ? (posVal / negVal).toFixed(1) : "–";
      tagControls.textContent = `Pos: ${posVal.toFixed(2)} | Neg: ${negVal.toFixed(2)} (${ratio}×)`;
    }
  }

  // QC status
  if (tagQC) {
    const qcPass = data.qc_pass !== false;
    tagQC.textContent = qcPass ? "QC: PASS" : "QC: REVIEW";
    tagQC.className = qcPass ? "preview-tag tag-pass" : "preview-tag tag-warn";
  }

  // Quick summary line
  if (quickSummary) {
    const ch = data.channel_used || $("channel")?.value || "AUTO";
    const ff = data.flat_field_applied ? "Flat-field on" : "Flat-field off";
    quickSummary.textContent = `Live readout (${ch} channel, ${ff}). 96 wells quantified.`;
  }

  // Mini heatmap rendering
  renderMiniHeatmap(data.grid_od || data.grid_pi || data.grid_pp);
}

function renderLivePreviewError(err) {
  const pulseStatus = $("preview-pulse-status");
  const errorHint = $("preview-error-hint");

  if (pulseStatus) pulseStatus.textContent = "Setup issue";
  if (errorHint) {
    errorHint.textContent = `Preview note: ${err.message || "Invalid configuration"}`;
    errorHint.hidden = false;
  }
}

function renderMiniHeatmap(gridMatrix) {
  const cv = $("preview-heatmap-cv");
  if (!cv || !gridMatrix || !gridMatrix.length) return;

  const ctx = cv.getContext("2d");
  const w = cv.width;
  const h = cv.height;

  ctx.clearRect(0, 0, w, h);

  const rows = gridMatrix.length;
  const cols = gridMatrix[0].length;
  const colW = w / cols;
  const rowH = h / rows;
  const pad = 2;

  // Background plate slab
  ctx.fillStyle = "rgba(11, 16, 26, 0.85)";
  ctx.fillRect(0, 0, w, h);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = gridMatrix[r][c];
      const cx = c * colW + pad;
      const cy = r * rowH + pad;
      const cw = colW - pad * 2;
      const ch = rowH - pad * 2;

      // Color mapping
      let fill = "rgba(255, 255, 255, 0.05)";
      if (val !== null && !isNaN(val)) {
        const num = Math.max(0, Math.min(2.5, Number(val)));
        const ratio = num / 2.5;

        if (ratio < 0.2) {
          fill = "#3CB8A8"; // low (teal)
        } else if (ratio < 0.55) {
          fill = "#FFD166"; // mid (yellow)
        } else if (ratio < 0.85) {
          fill = "#F5A524"; // high (amber)
        } else {
          fill = "#E8590C"; // peak (deep orange)
        }
      }

      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(cx + cw / 2, cy + ch / 2, cw / 2, ch / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
