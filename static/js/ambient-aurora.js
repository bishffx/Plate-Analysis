"use strict";

/**
 * PlateOD Ambient Aurora Background (ambient-aurora.js)
 * 
 * Renders an ultra-lightweight, slow-moving blurred aurora of amber,
 * teal, and violet blobs behind the page. Pauses when hidden or when
 * prefers-reduced-motion is enabled.
 */

let canvas = null;
let ctx = null;
let animId = null;
let isRunning = false;
let isReducedMotion = false;

// Slow-moving gradient blobs
const blobs = [
  { cx: 0.25, cy: 0.35, r: 0.38, colorDark: "rgba(245, 165, 36, 0.08)", colorLight: "rgba(245, 165, 36, 0.04)", speedX: 0.00015, speedY: 0.00021, phaseX: 0, phaseY: 1.2 },
  { cx: 0.75, cy: 0.65, r: 0.42, colorDark: "rgba(45, 212, 191, 0.07)", colorLight: "rgba(45, 212, 191, 0.035)", speedX: 0.00018, speedY: 0.00014, phaseX: 2.1, phaseY: 0.5 },
  { cx: 0.50, cy: 0.85, r: 0.35, colorDark: "rgba(139, 92, 246, 0.06)", colorLight: "rgba(139, 92, 246, 0.03)", speedX: 0.00012, speedY: 0.00025, phaseX: 4.2, phaseY: 3.1 }
];

export function initAmbientAurora() {
  canvas = document.getElementById("ambient-aurora-cv");
  if (!canvas) return;

  ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  // Check reduced motion
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  isReducedMotion = mql.matches;
  mql.addEventListener("change", (e) => {
    isReducedMotion = e.matches;
    if (isReducedMotion) {
      stopAurora();
      drawSingleFrame();
    } else {
      startAurora();
    }
  });

  // Check document visibility
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAurora();
    } else if (!isReducedMotion) {
      startAurora();
    }
  });

  // Resize listener
  window.addEventListener("resize", handleResize, { passive: true });
  handleResize();

  if (isReducedMotion) {
    drawSingleFrame();
  } else {
    startAurora();
  }
}

function handleResize() {
  if (!canvas) return;
  // Use a modest resolution for high performance
  const w = Math.min(window.innerWidth, 1920);
  const h = Math.min(window.innerHeight, 1200);
  // Scale down for smooth blur & minimal GPU cost
  canvas.width = Math.floor(w / 2);
  canvas.height = Math.floor(h / 2);
}

function startAurora() {
  if (isRunning || isReducedMotion) return;
  isRunning = true;
  let lastTime = performance.now();

  function loop(now) {
    if (!isRunning) return;
    const dt = now - lastTime;
    lastTime = now;
    renderAurora(now);
    animId = requestAnimationFrame(loop);
  }

  animId = requestAnimationFrame(loop);
}

function stopAurora() {
  isRunning = false;
  if (animId) {
    cancelAnimationFrame(animId);
    animId = null;
  }
}

function drawSingleFrame() {
  renderAurora(performance.now());
}

function renderAurora(time) {
  if (!canvas || !ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return;

  ctx.clearRect(0, 0, w, h);

  const isLight = document.documentElement.getAttribute("data-theme") === "light";

  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    // Smooth sinusoidal motion
    const ox = Math.sin(time * b.speedX + b.phaseX) * 0.12;
    const oy = Math.cos(time * b.speedY + b.phaseY) * 0.10;

    const px = (b.cx + ox) * w;
    const py = (b.cy + oy) * h;
    const radius = b.r * Math.max(w, h);

    const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
    const color = isLight ? b.colorLight : b.colorDark;
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
