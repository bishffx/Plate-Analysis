"use strict";

/**
 * Workspace Scrollbar & Soft Fade Shadow Controller
 * 
 * Manages dual-column independent scroll areas for the desktop analyzer:
 * - Desktop (>= 1024px): height calc(100dvh - header - 24px)
 * - Toggles soft top/bottom fade shadows only when more content exists in that direction
 * - Listens to scroll, resize, and DOM content changes
 * - Synchronizes with responsive breakpoints (< 1024px disables inner scroll)
 */

export function initWorkspaceScroll() {
  const leftCol = document.getElementById("col-settings");
  const rightCol = document.getElementById("col-workbench");
  const leftPanel = document.querySelector("aside.stepper-aside");
  const rightPanel = document.querySelector("section.workbench-main");
  const runBar = document.getElementById("sticky-run-bar");
  const siteHeader = document.querySelector(".site-header");

  function syncDimensions() {
    if (siteHeader) {
      const h = siteHeader.offsetHeight || 64;
      document.documentElement.style.setProperty("--header-height", `${h}px`);
    }
    if (runBar) {
      const rbH = runBar.offsetHeight || 62;
      document.documentElement.style.setProperty("--run-bar-height", `${rbH}px`);
    }
  }

  function updatePanelShadows(panel, col) {
    if (!panel || !col) return;

    if (window.innerWidth < 1024) {
      col.classList.remove("has-scroll-top", "has-scroll-bottom");
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = panel;
    const maxScroll = scrollHeight - clientHeight;
    const canScroll = maxScroll > 4;

    if (!canScroll) {
      col.classList.remove("has-scroll-top", "has-scroll-bottom");
      return;
    }

    col.classList.toggle("has-scroll-top", scrollTop > 6);
    col.classList.toggle("has-scroll-bottom", scrollTop < maxScroll - 6);
  }

  function updateAll() {
    syncDimensions();
    updatePanelShadows(leftPanel, leftCol);
    updatePanelShadows(rightPanel, rightCol);
  }

  if (leftPanel && leftCol) {
    leftPanel.addEventListener("scroll", () => updatePanelShadows(leftPanel, leftCol), { passive: true });
  }

  if (rightPanel && rightCol) {
    rightPanel.addEventListener("scroll", () => updatePanelShadows(rightPanel, rightCol), { passive: true });
  }

  // Observe resizing on panels, runBar, header, and body
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      updateAll();
    });
    if (leftPanel) ro.observe(leftPanel);
    if (rightPanel) ro.observe(rightPanel);
    if (siteHeader) ro.observe(siteHeader);
    if (runBar) ro.observe(runBar);
    ro.observe(document.body);
  }

  window.addEventListener("resize", updateAll, { passive: true });
  window.addEventListener("orientationchange", updateAll, { passive: true });

  // Initial updates after layout settle
  updateAll();
  requestAnimationFrame(updateAll);
  setTimeout(updateAll, 150);
  setTimeout(updateAll, 500);

  // Expose update helper globally for programmatic refresh (e.g. after results load)
  window.updateWorkspaceScroll = updateAll;
}
