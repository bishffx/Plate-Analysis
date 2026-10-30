"use strict";

/**
 * PlateOD Status Bar & Connectivity Manager (status-bar.js)
 * 
 * - Fixed bottom status bar with live server status, request latency,
 *   image dimensions/size, and assay information.
 * - Server offline banner with retry button.
 * - Inline SVG illustrations for empty, error, and offline states.
 */

import { $, el, clearChildren, showToast } from "./dom.js";
import { S, subscribeState } from "./state.js";
import { checkServerHealth } from "./api.js";

let heartbeatInterval = null;

export function initStatusBar() {
  updateStatusBar();
  initOfflineBanner();
  startServerHeartbeat();

  // Subscribe to state updates
  subscribeState((prop, val) => {
    if (prop === "online" || prop === "lastLatency" || prop === "w" || prop === "h" || prop === "selectedAssay") {
      updateStatusBar();
    }
  });

  window.addEventListener("plateod:api", (e) => {
    if (e.detail && e.detail.dur) {
      updateLatency(e.detail.dur);
    }
  });
}

export function updateStatusBar() {
  // 1. Server online status
  const dot = $("sb-status-dot");
  const statusText = $("sb-status-text");
  const isOnline = S.online !== false;

  if (dot) {
    dot.className = `status-dot ${isOnline ? "green" : "red"}`;
  }
  if (statusText) {
    statusText.textContent = isOnline ? "Connected" : "Offline";
  }

  // 2. Image dimensions / size
  const imgEl = $("sb-image-info");
  if (imgEl) {
    if (S.w && S.h) {
      const sizeStr = S.imageFileSize ? ` · ${S.imageFileSize}` : "";
      imgEl.textContent = `Image: ${S.w}×${S.h}px${sizeStr}`;
    } else {
      imgEl.textContent = "No photo loaded";
    }
  }

  // 3. Current assay
  const assayEl = $("sb-assay-info");
  if (assayEl) {
    const assay = S.selectedAssay || "SPCE";
    const mode = assay === "SPCE" ? "PI" : "PP";
    assayEl.textContent = `Assay: ${assay} (${mode})`;
  }
}

export function updateLatency(durMs) {
  const latEl = $("sb-latency-info");
  if (latEl) {
    latEl.textContent = `Last run: ${durMs} ms`;
  }
}

function initOfflineBanner() {
  const retryBtn = $("server-retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = "Checking...";
      const isUp = await checkServerHealth();
      retryBtn.disabled = false;
      retryBtn.textContent = "Retry";
      if (isUp) {
        hideOfflineBanner();
        showToast("Server reconnected successfully!", "success");
      } else {
        showToast("Server is still unreachable. Please check server.py.", "error");
      }
    });
  }
}

export function showOfflineBanner() {
  const banner = $("server-offline-banner");
  if (banner) {
    banner.hidden = false;
    banner.classList.add("visible");
  }
}

export function hideOfflineBanner() {
  const banner = $("server-offline-banner");
  if (banner) {
    banner.classList.remove("visible");
    setTimeout(() => { banner.hidden = true; }, 200);
  }
}

function startServerHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  // Ping health every 15s
  heartbeatInterval = setInterval(async () => {
    // Only check if window is visible to save battery/network
    if (document.hidden) return;
    const isUp = await checkServerHealth();
    if (!isUp) {
      showOfflineBanner();
    } else {
      hideOfflineBanner();
    }
  }, 15000);
}

/**
 * Inline SVG Illustrations for Empty, Error, and Offline states
 */
export const SVGIcons = {
  emptyPlate: `
    <svg class="state-illustration" viewBox="0 0 160 110" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="10" y="10" width="140" height="90" rx="8" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
      <circle cx="35" cy="35" r="8" fill="rgba(245,165,36,0.15)" stroke="#F5A524" stroke-width="1.2" stroke-dasharray="2 2"/>
      <circle cx="65" cy="35" r="8" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.15)"/>
      <circle cx="95" cy="35" r="8" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.15)"/>
      <circle cx="125" cy="35" r="8" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.15)"/>
      <circle cx="35" cy="65" r="8" fill="rgba(45,212,191,0.15)" stroke="#2DD4BF" stroke-width="1.2" stroke-dasharray="2 2"/>
      <circle cx="65" cy="65" r="8" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.15)"/>
      <circle cx="95" cy="65" r="8" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.15)"/>
      <circle cx="125" cy="65" r="8" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.15)"/>
      <path d="M72 82L80 74M80 74L88 82M80 74V95" stroke="#F5A524" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,
  emptyFilter: `
    <svg class="state-illustration" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="55" cy="45" r="28" stroke="rgba(255,255,255,0.18)" stroke-width="2" stroke-dasharray="3 3"/>
      <path d="M75 65L98 88" stroke="#F5A524" stroke-width="3" stroke-linecap="round"/>
      <circle cx="55" cy="45" r="14" fill="rgba(245,165,36,0.1)"/>
      <line x1="45" y1="45" x2="65" y2="45" stroke="#F5A524" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `,
  serverOffline: `
    <svg class="state-illustration" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="20" y="25" width="80" height="50" rx="6" fill="rgba(240,113,79,0.08)" stroke="#F0714F" stroke-width="1.5"/>
      <circle cx="35" cy="40" r="3" fill="#F0714F"/>
      <circle cx="45" cy="40" r="3" fill="rgba(255,255,255,0.2)"/>
      <line x1="20" y1="55" x2="100" y2="55" stroke="rgba(255,255,255,0.1)"/>
      <path d="M15 85L105 15" stroke="#F0714F" stroke-width="2.5" stroke-linecap="round"/>
    </svg>
  `
};
