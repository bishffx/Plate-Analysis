"use strict";

/**
 * PlateOD Effects Toolkit (effects.js)
 * 
 * - Single shared requestAnimationFrame loop with subscriber management
 * - Automatic pause when document.hidden
 * - IntersectionObserver reveal helper
 * - Count-up number animator with easing
 * - Magnetic-hover helper for buttons
 * - Pointer-spotlight radial gradient helper for cards
 * - Respects prefers-reduced-motion
 */

// Prefers-reduced-motion detector
const motionQuery = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null;

let reducedMotion = motionQuery ? motionQuery.matches : false;
if (motionQuery) {
  motionQuery.addEventListener("change", (e) => {
    reducedMotion = e.matches;
  });
}

export function isReducedMotion() {
  return reducedMotion;
}

// -----------------------------------------------------------------------------
// Shared requestAnimationFrame Loop
// -----------------------------------------------------------------------------
const subscribers = new Set();
let animFrameId = null;
let lastTimestamp = 0;
let isLoopRunning = false;

function loopTick(timestamp) {
  if (document.hidden) {
    stopLoop();
    return;
  }
  const delta = timestamp - (lastTimestamp || timestamp);
  lastTimestamp = timestamp;

  // Execute subscribers
  for (const fn of subscribers) {
    try {
      fn(timestamp, delta);
    } catch (err) {
      console.error("[Effects Loop Error]", err);
    }
  }

  if (subscribers.size > 0 && !document.hidden) {
    animFrameId = requestAnimationFrame(loopTick);
  } else {
    isLoopRunning = false;
  }
}

function startLoop() {
  if (!isLoopRunning && subscribers.size > 0 && !document.hidden) {
    isLoopRunning = true;
    lastTimestamp = 0;
    animFrameId = requestAnimationFrame(loopTick);
  }
}

function stopLoop() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  isLoopRunning = false;
}

// Pause and resume on document visibility
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopLoop();
    } else if (subscribers.size > 0) {
      startLoop();
    }
  });
}

/**
 * Subscribe a callback to the shared rAF loop.
 * @param {Function} fn (timestamp, delta) => void
 * @returns {Function} unsubscribe function
 */
export function subscribe(fn) {
  subscribers.add(fn);
  startLoop();
  return () => unsubscribe(fn);
}

/**
 * Unsubscribe a callback from the loop.
 * @param {Function} fn
 */
export function unsubscribe(fn) {
  subscribers.delete(fn);
  if (subscribers.size === 0) {
    stopLoop();
  }
}

// -----------------------------------------------------------------------------
// Count-Up Number Animator
// -----------------------------------------------------------------------------
/**
 * Smoothly animates a numeric readout.
 * @param {HTMLElement} el
 * @param {number} targetValue
 * @param {number} duration
 * @param {Function} formatter (value) => formatted string
 */
export function countUp(el, targetValue, duration = 600, formatter = (n) => String(Math.round(n))) {
  if (!el) return;
  const target = Number(targetValue);
  if (isNaN(target)) return;

  if (isReducedMotion() || duration <= 0) {
    el.textContent = formatter(target);
    return;
  }

  const rawText = el.textContent ? el.textContent.replace(/[^\d.-]/g, "") : "0";
  const start = parseFloat(rawText) || 0;
  if (Math.abs(start - target) < 0.0001) {
    el.textContent = formatter(target);
    return;
  }

  const startTime = performance.now();
  const un = subscribe((time) => {
    const elapsed = time - startTime;
    const progress = Math.min(1, elapsed / duration);
    // Cubic ease-out
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * eased;
    el.textContent = formatter(current);

    if (progress >= 1) {
      el.textContent = formatter(target);
      un();
    }
  });
}

// -----------------------------------------------------------------------------
// IntersectionObserver Reveal Helper
// -----------------------------------------------------------------------------
let sharedObserver = null;

export function initScrollReveal(selector = ".scroll-reveal, .timeline-item") {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;

  if (isReducedMotion()) {
    document.querySelectorAll(selector).forEach((el) => {
      el.classList.add("visible");
    });
    return;
  }

  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          obs.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.08,
      rootMargin: "0px 0px -40px 0px"
    });
  }

  document.querySelectorAll(selector).forEach((el) => {
    sharedObserver.observe(el);
  });
}

export function observeReveal(element) {
  if (!element) return;
  if (isReducedMotion()) {
    element.classList.add("visible");
    return;
  }
  if (!sharedObserver) {
    initScrollReveal();
  }
  if (sharedObserver) {
    sharedObserver.observe(element);
  }
}

// -----------------------------------------------------------------------------
// Magnetic-Hover Helper for Buttons
// -----------------------------------------------------------------------------
export function initMagnetic(btn, strength = 0.22) {
  if (!btn || isReducedMotion()) return;
  btn.classList.add("btn-magnetic");

  const onPointerMove = (e) => {
    if (isReducedMotion()) return;
    const rect = btn.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = (e.clientX - centerX) * strength;
    const dy = (e.clientY - centerY) * strength;
    btn.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
  };

  const onPointerLeave = () => {
    btn.style.transform = "translate3d(0, 0, 0)";
  };

  btn.addEventListener("pointermove", onPointerMove);
  btn.addEventListener("pointerleave", onPointerLeave);
}

export function initAllMagnetics(selector = ".btn-primary, .btn-run, .btn-magnetic") {
  if (typeof document === "undefined") return;
  document.querySelectorAll(selector).forEach((b) => initMagnetic(b));
}

// -----------------------------------------------------------------------------
// Pointer-Spotlight Helper for Cards
// -----------------------------------------------------------------------------
export function initSpotlight(card) {
  if (!card) return;

  const onPointerMove = (e) => {
    if (isReducedMotion()) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    card.style.setProperty("--mouse-x", `${x.toFixed(1)}px`);
    card.style.setProperty("--mouse-y", `${y.toFixed(1)}px`);
  };

  const onPointerLeave = () => {
    card.style.setProperty("--mouse-x", "-1000px");
    card.style.setProperty("--mouse-y", "-1000px");
  };

  card.addEventListener("pointermove", onPointerMove);
  card.addEventListener("pointerleave", onPointerLeave);
}

export function initAllSpotlights(selector = ".card, .preset-card, .kpi-card, .summary-card, .faq-item") {
  if (typeof document === "undefined") return;
  document.querySelectorAll(selector).forEach((c) => initSpotlight(c));
}
