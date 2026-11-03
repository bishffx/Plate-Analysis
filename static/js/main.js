"use strict";

/**
 * PlateOD Main Entrypoint (main.js)
 * 
 * ES Module orchestrating theme, canvas, state, presets, grid,
 * analysis, results, calibration, config, batch processing,
 * and micro-effects (spotlights, magnetic buttons, scroll reveal).
 */

import { S, TBL } from "./state.js";
import { initTheme } from "./theme.js";
import { initNavigation } from "./navigation.js";
import { initCanvasEvents, initHeroPlateCanvas, initStoryMiniPlate } from "./plate-canvas.js";
import { initPresets } from "./presets.js";
import { initWellPainter } from "./painter.js";
import { initAccordion } from "./accordion.js";
import { initValidation } from "./validation.js";
import { initGridControls } from "./grid.js";
import { initUpload, initAnalysis } from "./analysis.js";
import { initSamplePlateControls } from "./sample-plate.js";
import { initResultsControls } from "./results.js";
import { initCalibration } from "./calibration.js";
import { initConfigControls } from "./config.js";
import { initBatchControls } from "./batch.js";
import { initScrollReveal, initAllSpotlights, initAllMagnetics } from "./effects.js";
import { initAmbientAurora } from "./ambient-aurora.js";
import { initCommandPalette } from "./command-palette.js";
import { initShortcuts } from "./shortcuts.js";
import { initToastSystem } from "./toast-system.js";
import { initMicroInteractions } from "./interactions.js";
import { initTour } from "./tour.js";
import { initStatusBar } from "./status-bar.js";
import { initAesthetics } from "./aesthetics.js";
import { initWorkspaceScroll } from "./workspace-scroll.js";
import { initPerfOverlay } from "./perf.js";
import { initHero3D } from "./hero-3d.js";
import { initQualityUI } from "./adaptive-quality.js";

// Expose state globally for browser console debugging and testing
if (typeof window !== "undefined") {
  window.S = S;
  window.TBL = TBL;
}

function bootstrap() {
  // 1. Initialize Theme
  initTheme();

  // 2. Initialize Navigation & Connectivity
  initNavigation();

  // 3. Initialize Canvas & Drag Handles
  initCanvasEvents();
  initQualityUI();
  try {
    initHero3D();
  } catch (err) {
    console.warn("Falling back to 2D hero plate:", err);
    initHeroPlateCanvas();
  }
  initStoryMiniPlate();

  // 4. Initialize Presets & Assays
  initPresets();
  initWellPainter();
  initAccordion();

  // 5. Initialize Form Validation
  initValidation();

  // 6. Initialize Grid Controls
  initGridControls();

  // 7. Initialize Upload & Analysis Execution
  initUpload();
  initAnalysis();
  initSamplePlateControls();

  // 8. Initialize Results & Lightbox
  initResultsControls();

  // 9. Initialize Calibration
  initCalibration();

  // 10. Initialize Configuration Save/Load
  initConfigControls();

  // 11. Initialize Batch Mode
  initBatchControls();

  // 12. Initialize Premium Micro-Effects & Finishing Interactions
  initScrollReveal(".scroll-reveal, .timeline-item, .card, .preset-card, .summary-card, .bento-card, .assay-pricing-card, .principles-panel, .final-cta-section, .reveal");
  initAllSpotlights(".card, .preset-card, .kpi-card, .summary-card, .faq-item, .summary-strip-card, .bento-card, .assay-pricing-card, .principle-card");
  initAllMagnetics(".btn-primary, .btn-run, .btn-magnetic");
  initAmbientAurora();
  initCommandPalette();
  initShortcuts();
  initToastSystem();
  initMicroInteractions();
  initTour();
  initStatusBar();
  initAesthetics();
  initWorkspaceScroll();
  initPerfOverlay();

  console.log("%c[PlateOD]%c Initialized modular frontend (ES modules). Ready.", "color: #F5A524; font-weight: bold;", "color: inherit;");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
