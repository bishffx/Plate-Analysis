"use strict";

/**
 * PlateOD Navigation & Site Helpers (navigation.js)
 * 
 * - Sticky header shrink + scroll progress bar
 * - Mobile hamburger navigation toggle
 * - Scroll-spy active link highlighting
 * - Typewriter-style rotating subline in hero
 * - Live demo meter count-up animation
 * - Pinned scroll story controller
 * - 3D tilt on assay cards
 * - Photo-tips interactive carousel (swipe, dots, keyboard)
 * - Accessible FAQ accordion
 * - Background network connectivity heartbeat
 */

import { $, $$ } from "./dom.js";
import { checkServerHealth } from "./api.js";
import { countUp, isReducedMotion } from "./effects.js";
import { updateStoryPlate } from "./plate-canvas.js";

export function initNavigation() {
  initStickyHeader();
  initMobileNav();
  initScrollSpy();
  initTypewriter();
  initDemoMeter();
  initHeroLivePreviewCard();
  initScrollStory();
  initAssayTilt();
  initPhotoTipsCarousel();
  initFaqAccordion();

  // Initial and periodic network health check
  checkServerHealth();
  setInterval(checkServerHealth, 25000);
}

// -----------------------------------------------------------------------------
// 1. Sticky Header Shrink & Scroll-Progress Bar
// -----------------------------------------------------------------------------
function initStickyHeader() {
  const header = $("site-header") || document.querySelector(".site-header");
  const progressBar = $("scroll-progress-bar");

  let ticking = false;
  let cachedDocHeight = 0;
  const updateCachedHeight = () => {
    cachedDocHeight = document.documentElement.scrollHeight - window.innerHeight;
  };
  window.addEventListener("resize", updateCachedHeight, { passive: true });
  updateCachedHeight();

  const onScroll = () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const scrollY = window.scrollY || window.pageYOffset || 0;
        const progress = cachedDocHeight > 0 ? Math.min(100, Math.max(0, (scrollY / cachedDocHeight) * 100)) : 0;

        if (progressBar) {
          progressBar.style.width = `${progress}%`;
          progressBar.setAttribute("aria-valuenow", String(Math.round(progress)));
        }

        if (header) {
          if (scrollY > 30) {
            header.classList.add("scrolled");
          } else {
            header.classList.remove("scrolled");
          }
        }
        ticking = false;
      });
      ticking = true;
    }
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

// -----------------------------------------------------------------------------
// 2. Mobile Navigation Toggle
// -----------------------------------------------------------------------------
function initMobileNav() {
  const toggleBtn = $("btn-mobile-menu");
  const mobileNav = $("mobile-nav");
  if (!toggleBtn || !mobileNav) return;

  toggleBtn.addEventListener("click", () => {
    const open = toggleBtn.getAttribute("aria-expanded") === "true";
    toggleBtn.setAttribute("aria-expanded", String(!open));
    mobileNav.classList.toggle("open", !open);
    mobileNav.setAttribute("aria-hidden", String(open));
  });

  mobileNav.querySelectorAll(".mobile-nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      toggleBtn.setAttribute("aria-expanded", "false");
      mobileNav.classList.remove("open");
      mobileNav.setAttribute("aria-hidden", "true");
    });
  });
}

// -----------------------------------------------------------------------------
// 3. Scroll Spy for Header Nav Links
// -----------------------------------------------------------------------------
function initScrollSpy() {
  const sections = $$("section[id]");
  const navLinks = $$(".site-nav .nav-link");

  if (typeof window === "undefined" || !("IntersectionObserver" in window) || sections.length === 0) {
    return;
  }

  const navObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute("id");
          navLinks.forEach((link) => {
            if (link.getAttribute("href") === `#${id}`) {
              link.classList.add("active");
              link.setAttribute("aria-current", "page");
            } else {
              link.classList.remove("active");
              link.removeAttribute("aria-current");
            }
          });
        }
      });
    },
    { threshold: 0.25, rootMargin: "-80px 0px -50% 0px" }
  );

  sections.forEach((s) => navObserver.observe(s));
}

// -----------------------------------------------------------------------------
// 4. Typewriter-Style Rotating Subline
// -----------------------------------------------------------------------------
function initTypewriter() {
  const el = $("hero-typewriter");
  if (!el) return;

  const phrases = [
    "From plate photo to OD in seconds",
    "Blank-referenced and QC-checked",
    "SPCE and DIVA presets"
  ];

  if (isReducedMotion()) {
    let index = 0;
    setInterval(() => {
      index = (index + 1) % phrases.length;
      el.textContent = phrases[index];
    }, 3500);
    return;
  }

  let phraseIndex = 0;
  let charIndex = 0;
  let isDeleting = false;
  let timeoutId = null;

  function tick() {
    const currentPhrase = phrases[phraseIndex];
    if (isDeleting) {
      charIndex--;
      el.textContent = currentPhrase.substring(0, charIndex);
    } else {
      charIndex++;
      el.textContent = currentPhrase.substring(0, charIndex);
    }

    let delay = isDeleting ? 30 : 60;

    if (!isDeleting && charIndex === currentPhrase.length) {
      // Pause at full text
      delay = 2400;
      isDeleting = true;
    } else if (isDeleting && charIndex === 0) {
      // Switch phrase
      isDeleting = false;
      phraseIndex = (phraseIndex + 1) % phrases.length;
      delay = 400;
    }

    timeoutId = setTimeout(tick, delay);
  }

  tick();
}

// -----------------------------------------------------------------------------
// 5. Live Demo Meter Animation
// -----------------------------------------------------------------------------
function initDemoMeter() {
  const statWrap = $("hero-stat-strip") || $("hero-demo-meter");
  if (!statWrap) return;

  const elWells = $("stat-wells") || $("meter-wells");
  const elQC = $("stat-qc") || $("meter-qc");
  const elTime = $("stat-time") || $("meter-time");
  const elRes = $("stat-res");

  let animated = false;

  const triggerAnimation = () => {
    if (animated) return;
    animated = true;

    if (elWells) {
      countUp(elWells, 96, 900, (n) => String(Math.round(n)));
    }
    if (elQC) {
      countUp(elQC, 6, 700, (n) => String(Math.round(n)));
    }

  };

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        triggerAnimation();
        observer.unobserve(statWrap);
      }
    }, { threshold: 0.1 });
    observer.observe(statWrap);
  } else {
    triggerAnimation();
  }
}

// Floating Live Preview Card in Hero
function initHeroLivePreviewCard() {
  const cv = $("hero-mini-heatmap");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;

  const rows = 8;
  const cols = 12;
  const cellW = cv.width / cols;
  const cellH = cv.height / rows;

  const demoODs = [
    [1.85, 1.72, 1.54, 1.32, 1.10, 0.88, 0.65, 0.44, 0.28, 0.18, 0.12, 0.08],
    [1.89, 1.68, 1.49, 1.28, 1.05, 0.82, 0.60, 0.41, 0.25, 0.16, 0.10, 0.07],
    [0.15, 0.95, 0.84, 0.72, 0.58, 0.46, 0.34, 0.22, 0.15, 0.11, 0.08, 0.06],
    [0.14, 0.52, 0.48, 0.42, 0.36, 0.30, 0.24, 0.18, 0.14, 0.10, 0.07, 0.05],
    [0.04, 0.38, 0.36, 0.34, 0.32, 0.28, 0.22, 0.16, 0.12, 0.09, 0.06, 0.05],
    [0.04, 0.14, 0.13, 0.12, 0.11, 0.10, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04],
    [0.04, 0.12, 0.11, 0.10, 0.09, 0.08, 0.07, 0.07, 0.06, 0.05, 0.05, 0.04],
    [0.04, 1.45, 1.12, 0.85, 0.62, 0.45, 0.31, 0.21, 0.14, 0.09, 0.06, 0.04]
  ];

  function drawHeatmap(shift = 0) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = Math.max(0.02, Math.min(2.2, demoODs[r][c] + Math.sin(shift + r * 0.4 + c * 0.3) * 0.05));
        const t = val / 2.2;
        
        const red = Math.round(250 - t * 40);
        const grn = Math.round(240 - t * 130);
        const blu = Math.round(210 - t * 190);
        const alpha = 0.3 + t * 0.65;

        const x = c * cellW + 1.5;
        const y = r * cellH + 1.5;
        const w = cellW - 3;
        const h = cellH - 3;

        ctx.fillStyle = `rgba(${red}, ${grn}, ${blu}, ${alpha})`;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, y, w, h, 2);
        } else {
          ctx.rect(x, y, w, h);
        }
        ctx.fill();
      }
    }
  }

  drawHeatmap(0);

  if (isReducedMotion()) return;

  let step = 0;
  setInterval(() => {
    if (document.hidden) return;
    step += 0.4;
    drawHeatmap(step);

    const blankEl = $("hero-preview-blank");
    const posEl = $("hero-preview-pos");
    if (blankEl) {
      const bVal = (0.041 + Math.sin(step) * 0.002).toFixed(3);
      blankEl.textContent = `${bVal} OD`;
    }
    if (posEl) {
      const pVal = (1.84 + Math.cos(step) * 0.03).toFixed(2);
      posEl.textContent = `${pVal} OD`;
    }
  }, 3200);
}

// -----------------------------------------------------------------------------
// 6. Scroll Story ("How it works")
// -----------------------------------------------------------------------------
function initScrollStory() {
  const stepCards = $$(".story-step-card");
  if (stepCards.length === 0) return;

  if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const step = parseInt(entry.target.getAttribute("data-step"), 10) || 1;
        stepCards.forEach((c) => c.classList.remove("active"));
        entry.target.classList.add("active");
        updateStoryPlate(step);
      }
    });
  }, {
    threshold: 0.5,
    rootMargin: "-15% 0px -25% 0px"
  });

  stepCards.forEach((c) => observer.observe(c));
}

// -----------------------------------------------------------------------------
// 7. 3D Tilt on Assay Cards
// -----------------------------------------------------------------------------
function initAssayTilt() {
  const tiltCards = $$(".assay-protocol-card.tilt-card, .assay-pricing-card.tilt-card");
  if (isReducedMotion() || tiltCards.length === 0) return;

  tiltCards.forEach((card) => {
    const maxTilt = parseFloat(card.getAttribute("data-tilt-max")) || 6;

    card.addEventListener("pointermove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const normX = (x / rect.width - 0.5) * 2; // -1 to 1
      const normY = (y / rect.height - 0.5) * 2; // -1 to 1

      const tiltX = (-normY * maxTilt).toFixed(2);
      const tiltY = (normX * maxTilt).toFixed(2);

      card.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateY(-4px)`;
    });

    card.addEventListener("pointerleave", () => {
      card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)";
    });
  });
}

// -----------------------------------------------------------------------------
// 8. Photo-Tips Interactive Carousel
// -----------------------------------------------------------------------------
function initPhotoTipsCarousel() {
  const wrap = $("tips-carousel-wrap");
  const track = $("tips-carousel-track");
  const prevBtn = $("btn-tips-prev");
  const nextBtn = $("btn-tips-next");
  const dots = $$("#tips-dots .dot-btn");
  const slides = $$(".tips-slide");

  if (!track || slides.length === 0) return;

  let currentSlide = 0;
  const totalSlides = slides.length;

  const goToSlide = (idx) => {
    currentSlide = (idx + totalSlides) % totalSlides;
    track.style.transform = `translateX(-${currentSlide * (100 / totalSlides)}%)`;

    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === currentSlide);
      dot.setAttribute("aria-current", String(i === currentSlide));
    });

    slides.forEach((sl, i) => {
      sl.classList.toggle("active", i === currentSlide);
    });
  };

  if (prevBtn) {
    prevBtn.addEventListener("click", () => goToSlide(currentSlide - 1));
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => goToSlide(currentSlide + 1));
  }

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const idx = parseInt(dot.getAttribute("data-slide"), 10) || 0;
      goToSlide(idx);
    });
  });

  // Keyboard navigation when carousel region has focus
  if (wrap) {
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToSlide(currentSlide - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToSlide(currentSlide + 1);
      }
    });
  }

  // Touch Swipe Gesture
  let touchStartX = 0;
  let touchEndX = 0;

  track.addEventListener("touchstart", (e) => {
    if (e.touches.length > 0) {
      touchStartX = e.touches[0].clientX;
    }
  }, { passive: true });

  track.addEventListener("touchend", (e) => {
    if (e.changedTouches.length > 0) {
      touchEndX = e.changedTouches[0].clientX;
      const diffX = touchEndX - touchStartX;
      if (Math.abs(diffX) > 40) {
        if (diffX < 0) {
          goToSlide(currentSlide + 1); // swipe left -> next
        } else {
          goToSlide(currentSlide - 1); // swipe right -> prev
        }
      }
    }
  }, { passive: true });
}

// -----------------------------------------------------------------------------
// 9. Accessible FAQ Accordion
// -----------------------------------------------------------------------------
function initFaqAccordion() {
  $$(".accordion-header, .faq-question").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".accordion-item, .faq-item");
      if (!item) return;
      const isOpen = item.classList.contains("open");

      // Close other accordion items
      $$(".accordion-item, .faq-item").forEach((other) => {
        if (other !== item) {
          other.classList.remove("open");
          const otherBtn = other.querySelector(".accordion-header, .faq-question");
          const otherPanel = other.querySelector(".accordion-panel, .faq-answer");
          if (otherBtn) otherBtn.setAttribute("aria-expanded", "false");
          if (otherPanel) {
            otherPanel.setAttribute("aria-hidden", "true");
            setTimeout(() => {
              if (!other.classList.contains("open")) otherPanel.hidden = true;
            }, 320);
          }
        }
      });

      const panel = item.querySelector(".accordion-panel, .faq-answer");
      if (isOpen) {
        item.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
        if (panel) {
          panel.setAttribute("aria-hidden", "true");
          setTimeout(() => {
            if (!item.classList.contains("open")) panel.hidden = true;
          }, 320);
        }
      } else {
        if (panel) {
          panel.hidden = false;
          panel.setAttribute("aria-hidden", "false");
        }
        // Force reflow so transition runs
        void item.offsetHeight;
        item.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });
}
