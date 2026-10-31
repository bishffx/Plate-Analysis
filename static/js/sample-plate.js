"use strict";

/**
 * PlateOD Synthetic Sample Plate Generator (sample-plate.js)
 * 
 * Generates an in-memory 96-well ELISA microplate image:
 * - Clear polystyrene microplate tray with subtle bevels, rim reflection, and row/column coordinates
 * - 96 wells with realistic meniscus, liquid depth gradients, and specular reflections
 * - SPCE control wells: A1-B1 (High Positive amber OD ~1.85), C1-D1 (Negative OD ~0.15), E1-H1 (Blank water OD ~0.04)
 * - Clinical sample dilution series across columns 2-12
 * - Converts to a standard File object and pipes into handleFileUpload()
 * - Sets corner handles to known well centres and triggers analysis
 */

import { S } from "./state.js";
import { $, showToast } from "./dom.js";
import { handleFileUpload, run } from "./analysis.js";
import { selectAssay } from "./presets.js";
import { draw, refreshGrid, updateLiveReadout } from "./plate-canvas.js";

// Known well centre coordinates on the 1400x940 synthetic plate
export const SYNTHETIC_PLATE_DIMS = { width: 1400, height: 940 };
export const SYNTHETIC_CORNER_CENTERS = [
  [170, 150],   // A1
  [1226, 150],  // A12
  [1226, 822],  // H12
  [170, 822]    // H1
];

/**
 * Draws the high-fidelity 96-well plate onto an in-memory canvas and returns a Blob.
 */
export async function generateSyntheticPlateBlob() {
  const width = SYNTHETIC_PLATE_DIMS.width;
  const height = SYNTHETIC_PLATE_DIMS.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  // 1. Studio Backdrop (clean lab bench top with soft vignette)
  const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 100, width / 2, height / 2, width * 0.75);
  bgGrad.addColorStop(0, "#232630");
  bgGrad.addColorStop(0.5, "#171922");
  bgGrad.addColorStop(1, "#0D0E14");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Soft bench light glow
  const benchGlow = ctx.createRadialGradient(width / 2, height * 0.45, 50, width / 2, height * 0.45, 600);
  benchGlow.addColorStop(0, "rgba(255, 255, 255, 0.05)");
  benchGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = benchGlow;
  ctx.fillRect(0, 0, width, height);

  // 2. Microplate Body (Standard 127.8 x 85.5 mm ANSI footprint)
  const plateX = 85;
  const plateY = 65;
  const plateW = 1230;
  const plateH = 810;
  const plateR = 24;

  // Outer plate drop shadow
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 16;
  ctx.beginPath();
  ctx.roundRect(plateX, plateY, plateW, plateH, plateR);
  ctx.fillStyle = "#E5E7EB";
  ctx.fill();
  ctx.restore();

  // Clear polystyrene acrylic frame gradient
  const plateGrad = ctx.createLinearGradient(plateX, plateY, plateX + plateW, plateY + plateH);
  plateGrad.addColorStop(0, "#F8FAFC");
  plateGrad.addColorStop(0.2, "#EEF2F6");
  plateGrad.addColorStop(0.8, "#E2E8F0");
  plateGrad.addColorStop(1, "#CBD5E1");
  ctx.beginPath();
  ctx.roundRect(plateX, plateY, plateW, plateH, plateR);
  ctx.fillStyle = plateGrad;
  ctx.fill();

  // Outer plate rim bevel highlight & stroke
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.stroke();

  // Inner skirt bevel
  ctx.beginPath();
  ctx.roundRect(plateX + 10, plateY + 10, plateW - 20, plateH - 20, plateR - 6);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // A1 corner chamfer notch (standard well plate orientation feature)
  ctx.fillStyle = "#CBD5E1";
  ctx.beginPath();
  ctx.moveTo(plateX, plateY + 36);
  ctx.lineTo(plateX + 36, plateY);
  ctx.lineTo(plateX, plateY);
  ctx.closePath();
  ctx.fill();

  // 3. Coordinate Labels on the Plate Deck (A-H and 1-12)
  ctx.fillStyle = "#64748B";
  ctx.font = "bold 17px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const rows = 8;
  const cols = 12;
  const rowLabels = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const startX = 170;
  const startY = 150;
  const pitchX = 96;
  const pitchY = 96;
  const wellRadius = 35;

  // Column headers (1 to 12)
  for (let c = 0; c < cols; c++) {
    const cx = startX + c * pitchX;
    ctx.fillText(String(c + 1), cx, plateY + 42);
  }

  // Row labels (A to H)
  for (let r = 0; r < rows; r++) {
    const cy = startY + r * pitchY;
    ctx.fillText(rowLabels[r], plateX + 44, cy);
  }

  // 4. Well Density Matrix (SPCE / Clinical Simulation)
  // Optical density values (OD):
  // Col 1: A1, B1: Positives (~1.85); C1, D1: Negatives (~0.15); E1-H1: Blanks (~0.04)
  // Cols 2-12: Sample dilution series & varied patient sera
  const OD_MATRIX = [
    // A: High responders
    [1.85, 1.72, 1.54, 1.32, 1.10, 0.88, 0.65, 0.44, 0.28, 0.18, 0.12, 0.08],
    // B: Strong positives
    [1.89, 1.68, 1.49, 1.28, 1.05, 0.82, 0.60, 0.41, 0.25, 0.16, 0.10, 0.07],
    // C: Negative controls & moderate titers
    [0.15, 0.95, 0.84, 0.72, 0.58, 0.46, 0.34, 0.22, 0.15, 0.11, 0.08, 0.06],
    // D: Negative controls & weak positives
    [0.14, 0.52, 0.48, 0.42, 0.36, 0.30, 0.24, 0.18, 0.14, 0.10, 0.07, 0.05],
    // E: Blank reference & borderline gray-zone
    [0.04, 0.38, 0.36, 0.34, 0.32, 0.28, 0.22, 0.16, 0.12, 0.09, 0.06, 0.05],
    // F: Blank reference & clear negatives
    [0.04, 0.14, 0.13, 0.12, 0.11, 0.10, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04],
    // G: Blank reference & negative screening
    [0.04, 0.12, 0.11, 0.10, 0.09, 0.08, 0.07, 0.07, 0.06, 0.05, 0.05, 0.04],
    // H: Blank reference & spiked QC check
    [0.04, 1.45, 1.12, 0.85, 0.62, 0.45, 0.31, 0.21, 0.14, 0.09, 0.06, 0.04]
  ];

  // Helper to convert OD to TMB Peroxidase yellow-amber color
  const odToColor = (od) => {
    // OD ~ 0.04 (water/blank): pale neutral translucent cream
    // OD ~ 0.50 (low): golden straw
    // OD ~ 1.20 (medium): rich honey amber
    // OD ~ 1.85+ (high): deep amber-orange / brown-gold
    const t = Math.max(0, Math.min(2.2, od)) / 2.2;
    const r = Math.round(250 - t * 60);
    const g = Math.round(245 - t * 140);
    const b = Math.round(230 - t * 215);
    const alpha = Math.min(0.96, 0.25 + t * 0.72);
    return { r, g, b, alpha };
  };

  // 5. Render 96 Microplate Wells
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = startX + c * pitchX;
      const cy = startY + r * pitchY;
      const od = OD_MATRIX[r][c];
      const col = odToColor(od);

      // Well bottom plastic cavity recess
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, wellRadius + 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(148, 163, 184, 0.35)";
      ctx.fill();
      ctx.restore();

      // Well cylindrical wall shadow
      const wallGrad = ctx.createRadialGradient(cx, cy - 3, wellRadius * 0.4, cx, cy, wellRadius);
      wallGrad.addColorStop(0, "rgba(255, 255, 255, 0.85)");
      wallGrad.addColorStop(0.85, "rgba(226, 232, 240, 0.95)");
      wallGrad.addColorStop(1, "rgba(100, 116, 139, 0.55)");
      ctx.beginPath();
      ctx.arc(cx, cy, wellRadius, 0, Math.PI * 2);
      ctx.fillStyle = wallGrad;
      ctx.fill();

      // Liquid body (TMB chromogen)
      const liqR = wellRadius - 3.5;
      const liqGrad = ctx.createRadialGradient(
        cx - liqR * 0.25,
        cy - liqR * 0.25,
        liqR * 0.1,
        cx,
        cy,
        liqR
      );
      // Meniscus edge has deeper optical path length -> darker
      liqGrad.addColorStop(0, `rgba(${col.r + 15}, ${col.g + 15}, ${col.b + 10}, ${Math.max(0.2, col.alpha - 0.15)})`);
      liqGrad.addColorStop(0.7, `rgba(${col.r}, ${col.g}, ${col.b}, ${col.alpha})`);
      liqGrad.addColorStop(1, `rgba(${Math.max(0, col.r - 35)}, ${Math.max(0, col.g - 35)}, ${Math.max(0, col.b - 15)}, ${Math.min(1, col.alpha + 0.15)})`);

      ctx.beginPath();
      ctx.arc(cx, cy, liqR, 0, Math.PI * 2);
      ctx.fillStyle = liqGrad;
      ctx.fill();

      // Meniscus ring stroke
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = `rgba(${Math.max(0, col.r - 45)}, ${Math.max(0, col.g - 40)}, ${Math.max(0, col.b - 20)}, 0.45)`;
      ctx.stroke();

      // Specular highlight glint (curved reflection in top-left)
      ctx.beginPath();
      ctx.ellipse(cx - liqR * 0.38, cy - liqR * 0.38, liqR * 0.32, liqR * 0.14, -Math.PI / 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
      ctx.fill();

      // Secondary soft rim reflection in bottom-right
      ctx.beginPath();
      ctx.arc(cx, cy, liqR - 1, 0.2, 1.2);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
      ctx.stroke();
    }
  }

  // 6. Subtle realistic camera sensor noise & optical vignette
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  // Apply mild laboratory sensor noise
  for (let i = 0; i < data.length; i += 16) {
    const noise = (Math.random() - 0.5) * 6;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
  }
  ctx.putImageData(imgData, 0, 0);

  // Return canvas as PNG Blob
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * Generates and loads the synthetic plate through the real application pipeline.
 */
export async function loadSamplePlate() {
  try {
    showToast("Generating synthetic 96-well ELISA plate…", "info");

    const blob = await generateSyntheticPlateBlob();
    if (!blob) throw new Error("Could not generate synthetic plate");

    const sampleFile = new File([blob], "demo_synthetic_plate.png", { type: "image/png" });

    // Feed through standard upload path
    await handleFileUpload(sampleFile);

    // Pre-align corner handles to exact known coordinates
    S.corners = JSON.parse(JSON.stringify(SYNTHETIC_CORNER_CENTERS));

    // Preselect SPCE assay protocol
    selectAssay("SPCE");

    // Redraw plate canvas & refresh grid
    draw();
    refreshGrid();
    updateLiveReadout();

    // Set clear synthetic demo label on file chip
    const nameEl = $("file-chip-name");
    if (nameEl) nameEl.textContent = "Demo plate (synthetic 96-well)";

    // Smoothly scroll to the Analyzer section
    const analyzer = $("analyzer");
    if (analyzer) {
      analyzer.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    showToast("Demo plate loaded! Running photometric analysis…", "success");

    // Run analysis automatically after a short settle time
    setTimeout(() => {
      run();
    }, 500);

  } catch (err) {
    console.error("[PlateOD] Failed to load sample plate:", err);
    showToast("Could not load sample plate: " + err.message, "error");
  }
}

/**
 * Initializes button listeners for "Try a sample plate".
 */
export function initSamplePlateControls() {
  const btnHero = $("btn-try-sample");
  if (btnHero) {
    btnHero.addEventListener("click", (e) => {
      e.preventDefault();
      loadSamplePlate();
    });
  }

  const btnDropzone = $("btn-sample-dropzone");
  if (btnDropzone) {
    btnDropzone.addEventListener("click", (e) => {
      e.preventDefault();
      loadSamplePlate();
    });
  }

  const btnEmptyState = $("btn-sample-empty-state");
  if (btnEmptyState) {
    btnEmptyState.addEventListener("click", (e) => {
      e.preventDefault();
      loadSamplePlate();
    });
  }

  const btnCta = $("btn-try-sample-cta");
  if (btnCta) {
    btnCta.addEventListener("click", (e) => {
      e.preventDefault();
      loadSamplePlate();
    });
  }
}
