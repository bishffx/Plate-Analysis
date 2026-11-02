"use strict";

/**
 * PlateOD Dynamic Background Engine (ambient-aurora.js)
 * 
 * Renders a high-end, responsive dark obsidian background with:
 * - Shifting dark charcoal, graphite & slate atmospheric smoke plumes
 * - Dynamic twinkling starry sparkle constellation with 4-point diamond flares
 * - Interactive mouse parallax reactivity
 * - Pauses automatically when document is hidden or prefers-reduced-motion is active
 */

let canvas = null;
let ctx = null;
let animId = null;
let isRunning = false;
let isReducedMotion = false;
let mouseX = 0.5;
let mouseY = 0.5;
let targetMouseX = 0.5;
let targetMouseY = 0.5;

// Atmosphere smoke plumes (dark slate, charcoal, graphite)
const plumes = [
  { cx: 0.25, cy: 0.30, r: 0.45, color: "rgba(28, 33, 42, 0.35)", colorMid: "rgba(28, 33, 42, 0.12)", speedX: 0.00012, speedY: 0.00018, phaseX: 0.4, phaseY: 1.1 },
  { cx: 0.75, cy: 0.65, r: 0.50, color: "rgba(20, 24, 30, 0.40)", colorMid: "rgba(20, 24, 30, 0.15)", speedX: 0.00016, speedY: 0.00012, phaseX: 2.5, phaseY: 0.8 },
  { cx: 0.50, cy: 0.85, r: 0.42, color: "rgba(15, 18, 23, 0.45)", colorMid: "rgba(15, 18, 23, 0.18)", speedX: 0.00010, speedY: 0.00020, phaseX: 4.1, phaseY: 3.2 }
];

// Sparkle Starfield (55 delicate twinkling stars)
const sparkles = [];
const SPARKLE_COUNT = 55;

function initSparkles() {
  sparkles.length = 0;
  for (let i = 0; i < SPARKLE_COUNT; i++) {
    sparkles.push({
      x: Math.random(),
      y: Math.random(),
      size: 0.8 + Math.random() * 2.2,
      baseAlpha: 0.15 + Math.random() * 0.45,
      speedX: (Math.random() - 0.5) * 0.00004,
      speedY: (Math.random() - 0.5) * 0.00004,
      twinkleSpeed: 0.0015 + Math.random() * 0.0035,
      twinklePhase: Math.random() * Math.PI * 2,
      isDiamond: Math.random() > 0.45 // 4-point cross sparkle
    });
  }
}

export function initAmbientAurora() {
  canvas = document.getElementById("ambient-aurora-cv");
  if (!canvas) return;

  ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  initSparkles();

  // Pointer listener for dynamic gentle parallax
  window.addEventListener("pointermove", (e) => {
    targetMouseX = e.clientX / window.innerWidth;
    targetMouseY = e.clientY / window.innerHeight;
  }, { passive: true });

  // Reduced motion support
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

  // Page visibility auto-pause
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAurora();
    } else if (!isReducedMotion) {
      startAurora();
    }
  });

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
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}

function startAurora() {
  if (isRunning || isReducedMotion) return;
  isRunning = true;
  let lastTime = performance.now();

  function loop(now) {
    if (!isRunning) return;
    if (now - lastTime >= 24) { // Cap ~40fps for great performance
      lastTime = now;
      renderFrame(now);
    }
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
  renderFrame(performance.now());
}

function renderFrame(time) {
  if (!ctx || !canvas) return;

  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return;

  // Smooth mouse lerp
  mouseX += (targetMouseX - mouseX) * 0.05;
  mouseY += (targetMouseY - mouseY) * 0.05;

  ctx.clearRect(0, 0, w, h);

  // 1. Render shifting atmospheric dark smoke plumes
  plumes.forEach((p) => {
    const cx = (p.cx + Math.sin(time * p.speedX + p.phaseX) * 0.08 + (mouseX - 0.5) * 0.04) * w;
    const cy = (p.cy + Math.cos(time * p.speedY + p.phaseY) * 0.08 + (mouseY - 0.5) * 0.04) * h;
    const r = p.r * Math.min(w, h);

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, p.color);
    grad.addColorStop(0.6, p.colorMid);
    grad.addColorStop(1, "transparent");

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });

  // 2. Render dynamic sparkling stars
  const parallaxX = (mouseX - 0.5) * 16;
  const parallaxY = (mouseY - 0.5) * 16;

  for (let i = 0; i < sparkles.length; i++) {
    const s = sparkles[i];
    s.x += s.speedX;
    s.y += s.speedY;

    if (s.x < 0) s.x += 1;
    if (s.x > 1) s.x -= 1;
    if (s.y < 0) s.y += 1;
    if (s.y > 1) s.y -= 1;

    const sx = s.x * w + parallaxX * s.size;
    const sy = s.y * h + parallaxY * s.size;

    // Twinkle modulation
    const twinkle = 0.5 + 0.5 * Math.sin(time * s.twinkleSpeed + s.twinklePhase);
    const alpha = s.baseAlpha * (0.4 + 0.6 * twinkle);

    ctx.save();
    ctx.translate(sx, sy);

    // Soft glow halo
    ctx.beginPath();
    ctx.arc(0, 0, s.size * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.25})`;
    ctx.fill();

    // Sharp star center
    ctx.beginPath();
    ctx.arc(0, 0, s.size * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fill();

    // 4-point diamond cross flare for bright sparkles
    if (s.isDiamond && twinkle > 0.65) {
      const flareLen = s.size * (2.8 + twinkle * 2.5);
      ctx.strokeStyle = `rgba(255, 255, 255, ${(twinkle - 0.65) * 2.5 * alpha})`;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-flareLen, 0);
      ctx.lineTo(flareLen, 0);
      ctx.moveTo(0, -flareLen);
      ctx.lineTo(0, flareLen);
      ctx.stroke();
    }

    ctx.restore();
  }
}
