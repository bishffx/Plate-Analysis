"use strict";

/**
 * PlateOD Batch Module (batch.js)
 * 
 * Multi-plate batch processing with automated per-plate perspective grid detection,
 * live progress reporting, failure isolation, summary table, and combined CSV export.
 */

import { S } from "./state.js";
import { $, el, clearChildren, showToast } from "./dom.js";
import { uploadImage, detectGrid, analyzePlate } from "./api.js";
import { cfg } from "./analysis.js";
import { validateConfig } from "./config.js";
import { draw, refreshGrid, updateLiveReadout } from "./plate-canvas.js";
import { renderResults } from "./results.js";

let batchResults = [];

export async function runBatch(files) {
  if (!files || !files.length) return;
  const progressWrap = $("batch-progress-wrap");
  const resultsWrap = $("batch-results-wrap");
  const batchCsvBtn = $("btn-batch-csv");

  if (progressWrap) progressWrap.hidden = false;
  if (resultsWrap) resultsWrap.hidden = false;
  if (batchCsvBtn) batchCsvBtn.disabled = true;

  batchResults = [];
  const tbody = $("batch-tbody");
  if (tbody) clearChildren(tbody);

  const baseCfg = S.batchConfig ? { ...S.batchConfig } : cfg();
  const useAutoDetect = Boolean($("chk-batch-auto-detect") && $("chk-batch-auto-detect").checked);
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const file = files[i];
    const pct = Math.round((i / total) * 100);
    const statusText = $("batch-status-text");
    const pctText = $("batch-pct-text");
    const pBar = $("batch-progress-bar");

    if (statusText) statusText.textContent = `Processing plate ${i + 1} of ${total} (${file.name})…`;
    if (pctText) pctText.textContent = `${pct}%`;
    if (pBar) pBar.style.width = `${pct}%`;

    let dataUrl = null;
    let needsReview = false;
    let r = null;

    try {
      dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });

      const up = await uploadImage(dataUrl);
      const plateCfg = { ...baseCfg };

      if (useAutoDetect) {
        try {
          const det = await detectGrid({
            image_id: up.id,
            rows: plateCfg.rows || 8,
            cols: plateCfg.cols || 12,
            config: { rows: plateCfg.rows || 8, cols: plateCfg.cols || 12 }
          });
          const suggested = det.suggested || det.corners;
          if (det.success && suggested && Array.isArray(suggested) && suggested.length === 4) {
            plateCfg.corners = suggested;
            needsReview = false;
          } else {
            needsReview = true;
            plateCfg.corners = baseCfg.corners;
          }
        } catch {
          needsReview = true;
          plateCfg.corners = baseCfg.corners;
        }
      } else {
        plateCfg.corners = baseCfg.corners;
      }

      r = await analyzePlate({ image_id: up.id, config: plateCfg });
      batchResults.push({ name: file.name, result: r, dataUrl, needsReview });

      if (tbody) {
        const tr = document.createElement("tr");

        const tdName = document.createElement("td");
        const strongName = document.createElement("strong");
        strongName.textContent = file.name;
        tdName.appendChild(strongName);
        tr.appendChild(tdName);

        const tdQC = document.createElement("td");
        const qcText = r.valid ? "PASS" : "FAIL";
        const pillQC = el("span", qcText, `qc-status-pill ${r.valid ? "qc-pass" : "qc-fail"}`);
        tdQC.appendChild(pillQC);
        if (needsReview) {
          const reviewBadge = el("span", "Needs Review", "badge");
          reviewBadge.style.marginLeft = "6px";
          reviewBadge.style.background = "var(--bg-warning)";
          reviewBadge.style.color = "var(--color-warning)";
          tdQC.appendChild(reviewBadge);
        }
        tr.appendChild(tdQC);

        tr.appendChild(el("td", String(r.summary.positive || 0), "num-col"));
        tr.appendChild(el("td", String(r.summary.negative || 0), "num-col"));
        tr.appendChild(el("td", String(r.summary.invalid || 0), "num-col"));

        const tdAction = document.createElement("td");
        const btnOpen = document.createElement("button");
        btnOpen.type = "button";
        btnOpen.className = "sec btn-xs";
        btnOpen.textContent = "Open Results";
        btnOpen.onclick = () => {
          S.last = r;
          S.dataUrl = dataUrl;
          if (r.image) {
            S.w = r.image.width;
            S.h = r.image.height;
          }
          const img = new Image();
          img.onload = () => {
            S.img = img;
            draw();
            refreshGrid();
            updateLiveReadout();
          };
          img.src = dataUrl;
          renderResults(r);
          showToast(`Loaded full results for ${file.name}`, "success");
          const resSection = $("results");
          if (resSection) {
            resSection.hidden = false;
            resSection.scrollIntoView({ behavior: "smooth" });
          }
        };
        tdAction.appendChild(btnOpen);
        tr.appendChild(tdAction);

        tbody.appendChild(tr);
      }
    } catch (err) {
      if (tbody) {
        const tr = document.createElement("tr");
        const tdName = document.createElement("td");
        const strongName = document.createElement("strong");
        strongName.textContent = file.name;
        tdName.appendChild(strongName);
        tr.appendChild(tdName);

        const tdQC = document.createElement("td");
        const pillErr = el("span", "ERROR", "qc-status-pill qc-fail");
        tdQC.appendChild(pillErr);
        const errBadge = el("span", err.message || "Failed", "badge");
        errBadge.style.marginLeft = "6px";
        errBadge.style.background = "var(--bg-danger)";
        errBadge.style.color = "var(--color-danger)";
        tdQC.appendChild(errBadge);
        tr.appendChild(tdQC);

        tr.appendChild(el("td", "–", "num-col"));
        tr.appendChild(el("td", "–", "num-col"));
        tr.appendChild(el("td", "–", "num-col"));

        const tdAction = document.createElement("td");
        tdAction.textContent = "Unavailable";
        tdAction.style.color = "var(--text-muted)";
        tdAction.style.fontSize = "11px";
        tr.appendChild(tdAction);

        tbody.appendChild(tr);
      }
    }
  }

  const successCount = batchResults.length;
  const statusText = $("batch-status-text");
  const pctText = $("batch-pct-text");
  const pBar = $("batch-progress-bar");
  if (statusText) statusText.textContent = `Batch completed · ${successCount} of ${total} plates analyzed.`;
  if (pctText) pctText.textContent = "100%";
  if (pBar) pBar.style.width = "100%";
  if (batchCsvBtn) batchCsvBtn.disabled = successCount === 0;
  showToast(`Batch completed: ${successCount} plates analyzed.`, "success");
}

export function initBatchControls() {
  const batchInput = $("batch-file-input");
  const batchDrop = $("batch-dropzone");
  const batchSelectBtn = $("btn-select-batch");
  const batchCsvBtn = $("btn-batch-csv");
  const batchCfgSelect = $("batch-config-select");
  const batchCfgInput = $("batch-cfg-input");
  const batchCfgUploadBtn = $("btn-batch-cfg-upload");
  const batchCfgName = $("batch-cfg-name");

  if (batchCfgSelect) {
    batchCfgSelect.onchange = () => {
      if (batchCfgSelect.value === "file") {
        if (batchCfgUploadBtn) batchCfgUploadBtn.style.display = "inline-block";
        if (batchCfgInput) batchCfgInput.click();
      } else {
        S.batchConfig = null;
        if (batchCfgUploadBtn) batchCfgUploadBtn.style.display = "none";
        if (batchCfgName) batchCfgName.textContent = "Using active settings";
      }
    };
  }

  if (batchCfgUploadBtn && batchCfgInput) {
    batchCfgUploadBtn.onclick = () => batchCfgInput.click();
  }

  if (batchCfgInput) {
    batchCfgInput.onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const data = JSON.parse(fr.result);
          const validated = validateConfig(data);
          S.batchConfig = validated;
          if (batchCfgName) batchCfgName.textContent = `Loaded: ${data.name || f.name} (v${data.version || "2.0"})`;
          showToast(`Batch configuration set to ${data.name || f.name}`, "success");
        } catch (err) {
          showToast("Invalid configuration file: " + err.message, "error");
          if (batchCfgSelect) batchCfgSelect.value = "current";
          if (batchCfgUploadBtn) batchCfgUploadBtn.style.display = "none";
          if (batchCfgName) batchCfgName.textContent = "Using active settings";
          S.batchConfig = null;
        }
        batchCfgInput.value = "";
      };
      fr.readAsText(f);
    };
  }

  if (batchSelectBtn && batchInput) {
    batchSelectBtn.onclick = () => batchInput.click();
  }

  if (batchDrop) {
    ["dragenter", "dragover"].forEach((evt) => {
      batchDrop.addEventListener(evt, (e) => {
        e.preventDefault();
        batchDrop.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach((evt) => {
      batchDrop.addEventListener(evt, (e) => {
        e.preventDefault();
        batchDrop.classList.remove("dragover");
      });
    });
    batchDrop.addEventListener("drop", (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        runBatch(Array.from(files));
      }
    });
  }

  if (batchInput) {
    batchInput.onchange = (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) runBatch(files);
    };
  }

  if (batchCsvBtn) {
    batchCsvBtn.onclick = () => {
      if (!batchResults.length) return;
      const rows = [
        ["plate", "well", "row", "col", "role", "intensity", "image_od", "calibrated_od", "value", "class", "flag"].join(",")
      ];
      batchResults.forEach(({ name, result }) => {
        if (!result || !result.wells) return;
        result.wells.forEach((w) => {
          rows.push([
            `"${name.replace(/"/g, '""')}"`,
            w.well,
            w.row,
            w.col,
            `"${(w.role || "").replace(/"/g, '""')}"`,
            w.intensity !== null && w.intensity !== undefined ? w.intensity : "",
            w.od !== null && w.od !== undefined ? w.od : "",
            w.od_cal !== null && w.od_cal !== undefined ? w.od_cal : "",
            w.value !== null && w.value !== undefined ? w.value : "",
            `"${(w.class || "").replace(/"/g, '""')}"`,
            `"${(w.flag || "").replace(/"/g, '""')}"`
          ].join(","));
        });
      });
      const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `plateod_batch_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast("Combined batch CSV downloaded.", "success");
    };
  }
}
