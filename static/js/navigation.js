"use strict";

/**
 * PlateOD Navigation & Site Helpers (navigation.js)
 * 
 * - Mobile hamburger navigation toggle
 * - Scroll-spy active link highlighting
 * - Accessible FAQ accordion
 * - Background network connectivity heartbeat
 */

import { $, $$ } from "./dom.js";
import { checkServerHealth } from "./api.js";

export function initNavigation() {
  // Mobile Hamburger Toggle
  const toggleBtn = $("btn-mobile-menu");
  const mobileNav = $("mobile-nav");
  if (toggleBtn && mobileNav) {
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

  // Scroll Spy for Header Nav Links
  const sections = $$("section[id]");
  const navLinks = $$(".site-nav .nav-link");

  if (typeof window !== "undefined" && "IntersectionObserver" in window && sections.length > 0) {
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

  // Accessible FAQ Accordion
  $$(".faq-question").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".faq-item");
      if (!item) return;
      const isOpen = item.classList.contains("open");

      // Close other accordion items
      $$(".faq-item.open").forEach((other) => {
        if (other !== item) {
          other.classList.remove("open");
          const otherBtn = other.querySelector(".faq-question");
          if (otherBtn) otherBtn.setAttribute("aria-expanded", "false");
        }
      });

      item.classList.toggle("open", !isOpen);
      btn.setAttribute("aria-expanded", String(!isOpen));
    });
  });

  // Initial and periodic network health check
  checkServerHealth();
  setInterval(checkServerHealth, 25000);
}
