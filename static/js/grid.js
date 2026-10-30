"use strict";

/**
 * PlateOD Grid Module (grid.js)
 * 
 * Auto-detect grid via HoughCircles + RANSAC, corner convexity checks,
 * and dimension change listeners.
 */

import { S } from "./state.js";
import { $, showToast } from "./dom.js";
import { detectGrid } from "./api.js";
import { draw, initCorners, refreshGrid, updateLiveReadout } from "./plate-canvas.js";

const val = (id, def) => {
  const el = $(id);
  if (!el) return def;
  const v = el.value.trim();
  if (v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

/**
 * Checks whether 4 corners form a non-degenerate, strictly convex quadrilateral.
 */
export function isConvexQuad(corners) {
  if (!corners || corners.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % 4];
    const p3 = corners[(i + 2) % 4];
    const dx1 = p2[0] - p1[0], dy1 = p2[1] - p1[1];
    const dx2 = p3[0] - p2[0], dy2 = p3[1] - p2[1];
    const cross = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(cross) < 1e-4) return false;
    if (sign === 0) {
      sign = cross > 0 ? 1 : -1;
    } else if ((cross > 0 ? 1 : -1) !== sign) {
      return false;
    }
  }
  return true;
}

export function initGridControls() {
  const btnAutoGrid = $("btn-auto-grid");
  if (btnAutoGrid) {
    btnAutoGrid.onclick = async (e) => {
      e.stopPropagation();
      if (!S.img) {
        showToast("Upload a plate photo first.", "warning");
        return;
      }
      btnAutoGrid.disabled = true;
      btnAutoGrid.textContent = "Detecting…";
      try {
        const rows = val("rows", 8);
        const cols = val("cols", 12);
        const res = await detectGrid({
          image_id: S.imageId,
          image: S.dataUrl,
          rows,
          cols,
          config: { rows, cols }
        });

        const suggested = res.suggested || res.corners;
        if (res.success && suggested && Array.isArray(suggested) && suggested.length === 4) {
          S.corners = suggested;
          draw();
          refreshGrid();
          updateLiveReadout();
          showToast("Check and adjust", "success");
          const readout = $("readout-handle");
          if (readout) {
            readout.textContent = "Check and adjust";
          }
        } else {
          const reasonMsg = res.reason || res.message || "Detection confidence below 0.6. Corners untouched.";
          showToast(reasonMsg, "warning");
          const readout = $("readout-handle");
          if (readout) {
            readout.textContent = reasonMsg;
          }
        }
      } catch (err) {
        showToast("Could not auto-detect grid: " + err.message, "error");
      } finally {
        btnAutoGrid.disabled = false;
        btnAutoGrid.textContent = "Auto-detect grid";
      }
    };
  }

  // Row and col dimension changes: keep grid in bounds and rescale
  ["rows", "cols"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.onchange = () => {
      const r = +($(id === "rows" ? "rows" : "cols").value);
      if (!(r >= 2)) return;
      if (S.img) {
        initCorners();
        draw();
        refreshGrid();
      }
    };
  });

  const modeEl = $("mode");
  if (modeEl) {
    modeEl.onchange = () => {
      const cutoffEl = $("cutoff");
      if (cutoffEl) {
        cutoffEl.value = modeEl.value === "PP" ? 40 : 65;
      }
    };
  }
}
