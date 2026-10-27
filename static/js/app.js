"use strict";

/* ==========================================================================
   PlateOD · Client Application Logic
   ========================================================================== */

const $ = id => document.getElementById(id);
const S = {
  dataUrl: null, w: 0, h: 0, img: null, corners: null, circles: null, scale: 1,
  drag: -1, selHandle: -1, hoverHandle: -1, hideCircles: false, tok: 0, last: null, zoomLevel: 1.0,
  tab: "table", selectedAssay: null, isCustomised: false, presets: null
};
window.S = S;
const TBL = { search: "", sortCol: "well", sortAsc: true };

const el = (t, txt, cls) => {
  const e = document.createElement(t);
  if (txt !== undefined) e.textContent = txt;
  if (cls) e.className = cls;
  return e;
};

const fmt = (v, n) => (v === null || v === undefined ? "–" : Number(v).toFixed(n));

function roundRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y + w, x, y, r);
  ctx.closePath();
}

/* ---------- Theme Manager (Light / Dark / System) ---------- */
const THEME_STORAGE_KEY = "plateod_theme_pref";

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || "dark";
  } catch (err) {
    return "system";
  }
}

function setStoredTheme(pref) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch (err) {}
}

function applyTheme(pref) {
  const root = document.documentElement;
  let resolved = pref;
  if (pref === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  root.setAttribute("data-theme", resolved);

  document.querySelectorAll(".theme-btn").forEach(btn => {
    const val = btn.getAttribute("data-theme-val");
    if (val === pref) {
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
    } else {
      btn.classList.remove("active");
      btn.setAttribute("aria-pressed", "false");
    }
  });

  // Re-draw canvas overlay to maintain crispness
  if (S.img) draw();
}

document.querySelectorAll(".theme-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const chosen = btn.getAttribute("data-theme-val");
    setStoredTheme(chosen);
    applyTheme(chosen);
  });
});

window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (getStoredTheme() === "system") {
    applyTheme("system");
  }
});

// Initial theme application
applyTheme(getStoredTheme());

/* ---------- Mobile Navigation Toggle ---------- */
const navToggle = $("nav-toggle");
const mobileNav = $("mobile-nav");
if (navToggle && mobileNav) {
  navToggle.addEventListener("click", () => {
    const isHidden = mobileNav.hidden;
    mobileNav.hidden = !isHidden;
    navToggle.setAttribute("aria-expanded", String(isHidden));
  });

  mobileNav.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", () => {
      mobileNav.hidden = true;
      navToggle.setAttribute("aria-expanded", "false");
    });
  });
}

/* ---------- Smooth Scroll Active Nav Link Highlight ---------- */
const sections = document.querySelectorAll("section[id], div[id].analyzer-section, div[id].info-section");
const allNavLinks = document.querySelectorAll(".site-nav .nav-link, .mobile-nav .nav-link");

function onWindowScroll() {
  const scrollPos = window.scrollY + 140;
  sections.forEach(sec => {
    const top = sec.offsetTop;
    const height = sec.offsetHeight;
    const id = sec.getAttribute("id");
    if (scrollPos >= top && scrollPos < top + height) {
      allNavLinks.forEach(link => {
        if (link.getAttribute("href") === `#${id}`) {
          link.classList.add("active");
        } else {
          link.classList.remove("active");
        }
      });
    }
  });
}
window.addEventListener("scroll", onWindowScroll, { passive: true });

/* ---------- Network Health Monitor ---------- */
async function checkServerHealth() {
  const chip = $("server-status");
  if (!chip) return;
  try {
    const r = await fetch("/", { method: "GET", cache: "no-store" });
    if (r.ok) {
      chip.className = "status-chip online";
      chip.querySelector(".status-text").textContent = "Connected";
    } else {
      chip.className = "status-chip offline";
      chip.querySelector(".status-text").textContent = "Offline";
    }
  } catch (err) {
    chip.className = "status-chip offline";
    chip.querySelector(".status-text").textContent = "Offline";
  }
}
window.addEventListener("online", checkServerHealth);
window.addEventListener("offline", checkServerHealth);
checkServerHealth();

/* ---------- API Helper ---------- */
async function api(path, body) {
  let r;
  try {
    r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (e) {
    checkServerHealth();
    throw new Error("Cannot reach the server. Is server.py still running?");
  }
  let j;
  try {
    j = await r.json();
  } catch (e) {
    throw new Error("Server sent an unreadable response (HTTP " + r.status + ")");
  }
  if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
  return j;
}

/* ---------- Presets Loading ---------- */
async function loadPresets() {
  try {
    const p = await api("/api/presets", {});
    S.presets = p;
  } catch (e) {
    console.error("Could not load presets", e);
  }
}
loadPresets();

/* ---------- Messages Banner ---------- */
function banner(items, kind) {
  const b = $("banner");
  b.innerHTML = "";
  if (!items || !items.length) return;
  const d = el("div", null, "msg " + kind);
  const u = el("ul");
  items.forEach(t => u.appendChild(el("li", t)));
  d.appendChild(u);
  b.appendChild(d);
}

function showMsgs(errs, warns) {
  const b = $("banner");
  b.innerHTML = "";
  [[errs, "err"], [warns, "warn"]].forEach(([a, k]) => {
    if (a && a.length) {
      const d = el("div", null, "msg " + k);
      d.appendChild(el("b", k === "err" ? "Problems" : "Warnings"));
      const u = el("ul");
      a.forEach(t => u.appendChild(el("li", t)));
      d.appendChild(u);
      b.appendChild(d);
    }
  });
  if (errs && errs.length) {
    showToast(errs[0], "error");
  } else if (warns && warns.length) {
    showToast(warns[0], "warning");
  }
}

/* ---------- Drag & Drop on Stage ---------- */
const stage = $("stage");
["dragenter", "dragover"].forEach(evt => {
  stage.addEventListener(evt, e => {
    e.preventDefault();
    e.stopPropagation();
    stage.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach(evt => {
  stage.addEventListener(evt, e => {
    e.preventDefault();
    e.stopPropagation();
    stage.classList.remove("dragover");
  });
});
stage.addEventListener("drop", e => {
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length > 0) {
    $("file").files = files;
    $("file").dispatchEvent(new Event("change"));
  }
});
stage.addEventListener("click", e => {
  if (!S.img || e.target === $("ph") || $("ph").contains(e.target)) {
    $("file").click();
  }
});

/* ---------- Image Upload + Grid Init ---------- */
$("file").onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  
  // Update file chip
  const chip = $("file-chip");
  if (chip) {
    chip.hidden = false;
    $("file-chip-name").textContent = f.name;
    const sz = f.size < 1048576 ? (f.size / 1024).toFixed(1) + " KB" : (f.size / 1048576).toFixed(1) + " MB";
    $("file-chip-size").textContent = "(" + sz + ")";
  }

  const fr = new FileReader();
  fr.onload = async () => {
    try {
      $("run").disabled = true;
      S.dataUrl = fr.result;
      const p = await api("/api/prepare", { image: S.dataUrl });
      S.w = p.width;
      S.h = p.height;
      const img = new Image();
      img.onload = () => {
        S.img = img;
        initCorners();
        $("stage").classList.add("has-image");
        $("ph").hidden = true;
        $("cv").hidden = false;
        sizeCanvas();
        draw();
        refreshGrid();
        updateLiveReadout();

        // Reset assay selection on new upload
        S.selectedAssay = null;
        S.isCustomised = false;
        $("card-assay").hidden = false;
        $("btn-assay-spce").classList.remove("active");
        $("btn-assay-spce").setAttribute("aria-checked", "false");
        $("btn-assay-diva").classList.remove("active");
        $("btn-assay-diva").setAttribute("aria-checked", "false");
        $("assay-info").hidden = true;
        $("badge-customised").hidden = true;
        $("mode").disabled = false;
        $("run").disabled = true; // Stays disabled until an assay is chosen
        $("results").hidden = true;
        showMsgs([], []);
        if (window.pendingAssay) {
          selectAssay(window.pendingAssay);
          window.pendingAssay = null;
        }
        updateStepperValidation();
      };
      img.src = p.preview;
    } catch (err) {
      showMsgs([err.message], []);
    }
  };
  fr.onerror = () => showMsgs(["Could not read that file."], []);
  fr.readAsDataURL(f);
};

/* ---------- Assay Presets Handling ---------- */
function selectAssay(name) {
  if (!S.presets || !S.presets[name]) return;
  S.selectedAssay = name;
  S.isCustomised = false;
  const p = S.presets[name];

  const btnSpce = $("btn-assay-spce"), btnDiva = $("btn-assay-diva");
  if (name === "SPCE") {
    btnSpce.classList.add("active");
    btnSpce.setAttribute("aria-checked", "true");
    btnDiva.classList.remove("active");
    btnDiva.setAttribute("aria-checked", "false");
  } else {
    btnDiva.classList.add("active");
    btnDiva.setAttribute("aria-checked", "true");
    btnSpce.classList.remove("active");
    btnSpce.setAttribute("aria-checked", "false");
  }

  $("badge-customised").hidden = true;
  $("customise-wells").checked = false;
  $("pos").readOnly = true;
  $("neg").readOnly = true;
  $("blank").readOnly = true;

  // Fill fields from preset
  $("pos").value = p.pos || "";
  $("neg").value = p.neg || "";
  $("blank").value = p.blank || "";
  $("mode").value = p.mode;
  $("mode").disabled = true; // locked to preset's mode while a preset is active
  $("cutoff").value = p.cutoff;

  // For SPCE, hide the positive-control field (there is none)
  if (name === "SPCE") {
    $("pos-wrap").hidden = true;
  } else {
    $("pos-wrap").hidden = false;
  }

  // Info panel
  const info = $("assay-info");
  info.hidden = false;
  info.textContent = "";
  if (name === "SPCE") {
    info.textContent = `${p.neg} = antigen (max-signal) wells, ${p.blank} = blank. Competitive assay, result is % inhibition (PI).`;
  } else {
    info.textContent = `${p.pos} = positive control, ${p.neg} = negative control, ${p.blank} = blank. Result is percentage positivity (PP).`;
  }

  $("run").disabled = false;
  updateStepperValidation();
}

$("btn-assay-spce").onclick = () => selectAssay("SPCE");
$("btn-assay-diva").onclick = () => selectAssay("DIVA");

$("customise-wells").onchange = e => {
  const on = e.target.checked;
  $("pos").readOnly = !on;
  $("neg").readOnly = !on;
  $("blank").readOnly = !on;
};

function onWellEdit() {
  if (S.selectedAssay) {
    S.isCustomised = true;
    $("badge-customised").hidden = false;
  }
}
["pos", "neg", "blank"].forEach(id => $(id).addEventListener("input", onWellEdit));

function initCorners() {
  const r = +$("rows").value, c = +$("cols").value, mx = S.w / (2 * c), my = S.h / (2 * r);
  S.corners = [[mx, my], [S.w - mx, my], [S.w - mx, S.h - my], [mx, S.h - my]];
  S.circles = null;
  updateLiveReadout();
}

function cornerLabels() {
  const r = +$("rows").value, c = +$("cols").value, L = "ABCDEFGHIJKLMNOP"[r - 1];
  return ["A1", "A" + c, L + c, L + "1"];
}

function sizeCanvas() {
  const cv = $("cv");
  cv.width = Math.min(S.w, 1400);
  S.scale = cv.width / S.w;
  cv.height = Math.round(S.h * S.scale);
}

/* ---------- Canvas Rendering ---------- */
function draw() {
  const cv = $("cv"), g = cv.getContext("2d");
  if (!S.img) return;
  g.drawImage(S.img, 0, 0, cv.width, cv.height);
  const k = S.scale;

  // 1. Measurement circles (thin semi-transparent stroke, colour-coded by well role once results exist)
  if (S.circles && !S.hideCircles) {
    g.lineWidth = 1.2;
    const cols = +($("cols").value) || 12;
    let roleMap = null;
    if (S.last && S.last.wells) {
      roleMap = {};
      S.last.wells.forEach(w => { roleMap[w.row + "," + w.col] = w.role; });
    }

    S.circles.forEach(([x, y, r], idx) => {
      let strokeCol = "rgba(45, 212, 191, 0.65)"; // Teal before results
      if (roleMap) {
        const row = Math.floor(idx / cols), col = idx % cols;
        const role = roleMap[row + "," + col];
        if (role === "Positive ctrl") {
          strokeCol = "rgba(76, 120, 168, 0.85)"; // Positive control blue
        } else if (role === "Blank") {
          strokeCol = "rgba(138, 143, 152, 0.85)"; // Blank grey
        } else {
          strokeCol = "rgba(42, 157, 143, 0.75)"; // Others green/teal
        }
      }
      g.strokeStyle = strokeCol;
      g.beginPath();
      g.arc(x * k, y * k, r * k, 0, 6.2832);
      g.stroke();
    });
  }

  // 2. Bounding quadrilateral
  g.strokeStyle = "rgba(245, 165, 36, 0.65)";
  g.lineWidth = 1.5;
  g.beginPath();
  S.corners.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
  g.closePath();
  g.stroke();

  // 3. Corner handles: 22px ring with corner label pill beside it, soft glow on hover and drag
  const lb = cornerLabels();
  const hr = 11; // 22px ring diameter

  S.corners.forEach(([x, y], i) => {
    const isDragged = (S.drag === i);
    const isSelected = (S.selHandle === i);
    const isHovered = (S.hoverHandle === i);
    const active = isDragged || isSelected || isHovered;

    g.save();
    if (active) {
      g.shadowColor = "#F5A524";
      g.shadowBlur = isDragged ? 22 : 14;
    }

    // Outer 22px ring
    g.lineWidth = active ? 3 : 2.5;
    g.strokeStyle = "#F5A524";
    g.fillStyle = isDragged ? "rgba(245, 165, 36, 0.4)" : (isSelected ? "rgba(245, 165, 36, 0.22)" : "rgba(11, 15, 20, 0.85)");
    g.beginPath();
    g.arc(x * k, y * k, hr, 0, 6.2832);
    g.fill();
    g.stroke();

    // Inner center bullseye dot
    g.fillStyle = "#FF7A18";
    g.beginPath();
    g.arc(x * k, y * k, 3, 0, 6.2832);
    g.fill();

    g.restore();

    // Corner label pill
    const lx = x * k + (i === 0 || i === 3 ? -36 : 16);
    const ly = y * k - 8;
    g.save();
    g.fillStyle = "rgba(11, 15, 20, 0.88)";
    g.strokeStyle = isSelected ? "#F5A524" : "rgba(255, 255, 255, 0.25)";
    g.lineWidth = 1;
    roundRect(g, lx, ly, 26, 17, 4);
    g.fill();
    g.stroke();

    g.font = "bold 10px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.strokeStyle = "rgba(0, 0, 0, 0.85)";
    g.lineWidth = 2.5;
    g.strokeText(lb[i], lx + 13, ly + 9);
    g.fillStyle = isSelected ? "#F5A524" : "#FFFFFF";
    g.fillText(lb[i], lx + 13, ly + 9);
    g.restore();
  });

  // 4. Magnifier Loupe (4x zoom loupe active while dragging a handle)
  if (S.drag >= 0) {
    const pt = S.corners[S.drag];
    const px = pt[0], py = pt[1];
    const loupeR = 54;
    const zoom = 4;

    let lx = px * k;
    let ly = py * k - loupeR - 28;
    if (ly - loupeR < 10) ly = py * k + loupeR + 28;
    if (lx - loupeR < 10) lx = loupeR + 10;
    if (lx + loupeR > cv.width - 10) lx = cv.width - loupeR - 10;

    g.save();
    g.shadowColor = "rgba(0, 0, 0, 0.75)";
    g.shadowBlur = 18;
    g.shadowOffsetY = 6;

    g.beginPath();
    g.arc(lx, ly, loupeR, 0, 6.2832);
    g.clip();

    // Draw 4x magnified image centered on current pointer
    const sw = (loupeR * 2) / zoom;
    const sh = (loupeR * 2) / zoom;
    const sx = Math.max(0, Math.min(S.w - sw, px - sw / 2));
    const sy = Math.max(0, Math.min(S.h - sh, py - sh / 2));
    g.drawImage(S.img, sx, sy, sw, sh, lx - loupeR, ly - loupeR, loupeR * 2, loupeR * 2);

    // Subtle crosshairs in loupe
    g.strokeStyle = "rgba(245, 165, 36, 0.9)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(lx - loupeR, ly); g.lineTo(lx + loupeR, ly);
    g.moveTo(lx, ly - loupeR); g.lineTo(lx, ly + loupeR);
    g.stroke();

    // Center targeting ring in loupe
    g.strokeStyle = "#FFFFFF";
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(lx, ly, 6, 0, 6.2832);
    g.stroke();

    g.restore();

    // Loupe boundary ring & badge
    g.save();
    g.strokeStyle = "#F5A524";
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(lx, ly, loupeR, 0, 6.2832);
    g.stroke();

    // 4x zoom badge
    g.fillStyle = "rgba(11, 15, 20, 0.9)";
    g.strokeStyle = "#F5A524";
    g.lineWidth = 1;
    roundRect(g, lx - 18, ly + loupeR - 12, 36, 16, 4);
    g.fill();
    g.stroke();
    g.fillStyle = "#F5A524";
    g.font = "bold 9px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("4× ZOOM", lx, ly + loupeR - 4);
    g.restore();
  }
}

/* ---------- Pointer Events (Mouse + Touch Screen Support) ---------- */
function ptInImg(e) {
  const r = $("cv").getBoundingClientRect();
  const cx = e.clientX - r.left, cy = e.clientY - r.top;
  return [Math.max(0, Math.min(S.w, cx / S.scale)), Math.max(0, Math.min(S.h, cy / S.scale))];
}

function hitHandle(x, y) {
  if (!S.corners) return -1;
  const tol = 30 / S.scale;
  let best = -1, bd = tol;
  S.corners.forEach(([cx, cy], i) => {
    const d = Math.hypot(x - cx, y - cy);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

$("cv").addEventListener("pointerdown", e => {
  $("cv").setPointerCapture(e.pointerId);
  const [x, y] = ptInImg(e);
  const best = hitHandle(x, y);
  if (best >= 0) {
    S.drag = best;
    S.selHandle = best;
    draw();
    updateLiveReadout();
  } else {
    S.selHandle = -1;
    draw();
    updateLiveReadout();
  }
});

$("cv").addEventListener("pointermove", e => {
  const [x, y] = ptInImg(e);
  if (S.drag >= 0) {
    S.corners[S.drag] = [x, y];
    draw();
    refreshGrid();
    updateLiveReadout();
  } else {
    const best = hitHandle(x, y);
    if (S.hoverHandle !== best) {
      S.hoverHandle = best;
      $("cv").style.cursor = best >= 0 ? "crosshair" : "default";
      draw();
    }
  }
});

const endDrag = () => {
  if (S.drag >= 0) {
    S.drag = -1;
    draw();
    refreshGrid();
    updateLiveReadout();
  }
};
$("cv").addEventListener("pointerup", endDrag);
$("cv").addEventListener("pointercancel", endDrag);
window.addEventListener("resize", () => {
  if (S.img) {
    sizeCanvas();
    draw();
  }
});

/* ---------- Keyboard Nudging ---------- */
window.addEventListener("keydown", e => {
  if (S.selHandle < 0 || !S.corners) return;
  const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  if (!arrows.includes(e.key)) return;
  const active = document.activeElement;
  if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;

  e.preventDefault();
  const step = e.shiftKey ? 10 : 1;
  const pt = S.corners[S.selHandle];
  if (e.key === "ArrowUp") pt[1] = Math.max(0, pt[1] - step);
  if (e.key === "ArrowDown") pt[1] = Math.min(S.h, pt[1] + step);
  if (e.key === "ArrowLeft") pt[0] = Math.max(0, pt[0] - step);
  if (e.key === "ArrowRight") pt[0] = Math.min(S.w, pt[0] + step);

  draw();
  refreshGrid();
  updateLiveReadout();
});

/* ---------- Toolbar Buttons ---------- */
$("btn-reset-grid").onclick = e => {
  e.stopPropagation();
  if (!S.img) return;
  initCorners();
  S.selHandle = -1;
  draw();
  refreshGrid();
  updateLiveReadout();
};

$("btn-fit-grid").onclick = e => {
  e.stopPropagation();
  if (!S.img) return;
  const mx = Math.round(S.w * 0.05), my = Math.round(S.h * 0.05);
  S.corners = [[mx, my], [S.w - mx, my], [S.w - mx, S.h - my], [mx, S.h - my]];
  S.selHandle = -1;
  draw();
  refreshGrid();
  updateLiveReadout();
};

$("btn-toggle-circles").onclick = e => {
  e.stopPropagation();
  S.hideCircles = !S.hideCircles;
  $("btn-toggle-circles").textContent = S.hideCircles ? "Show circles" : "Hide circles";
  draw();
};

function updateLiveReadout() {
  const elD = $("readout-dims"), elR = $("readout-radius"), elH = $("readout-handle");
  if (!elD) return;
  const rows = +($("rows").value) || 8;
  const cols = +($("cols").value) || 12;
  const radRatio = +($("radius").value) || 0.28;
  let radPxStr = "–";
  if (S.circles && S.circles.length) {
    const avgRad = S.circles.reduce((acc, c) => acc + c[2], 0) / S.circles.length;
    radPxStr = `${avgRad.toFixed(1)} px`;
  }
  const lb = cornerLabels();
  const selStr = S.selHandle >= 0 ? `${lb[S.selHandle]} selected (Arrows move 1px, Shift 10px)` : "Click a corner handle to nudge";

  elD.textContent = `${rows} × ${cols} plate`;
  elR.textContent = `ROI radius: ${radPxStr} (${radRatio.toFixed(2)}× pitch)`;
  elH.textContent = selStr;
}

let gt = null;
function refreshGrid() {
  clearTimeout(gt);
  gt = setTimeout(async () => {
    if (!S.corners) return;
    const t = ++S.tok;
    try {
      const g = await api("/api/grid", {
        corners: S.corners,
        rows: +$("rows").value,
        cols: +$("cols").value,
        radius: +$("radius").value
      });
      if (t !== S.tok) return;
      S.circles = g.wells;
      draw();
      updateLiveReadout();
    } catch (err) {
      if (t === S.tok) {
        S.circles = null;
        draw();
        updateLiveReadout();
        showMsgs([err.message], []);
      }
    }
  }, 120);
}

$("radius").oninput = () => {
  $("rv").textContent = (+($("radius").value)).toFixed(2);
  refreshGrid();
};

["rows", "cols"].forEach(id => {
  $(id).onchange = () => {
    const r = +$(id === "rows" ? "rows" : "cols").value;
    if (!(r >= 2)) return;
    if (S.img) {
      initCorners();
      draw();
      refreshGrid();
    }
  };
});

$("mode").onchange = () => {
  $("cutoff").value = $("mode").value === "PP" ? 40 : 50;
};

/* ---------- Analysis Run & Calibrate ---------- */
const val = (id, def) => {
  const v = $(id).value.trim();
  if (v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

function cfg() {
  return {
    rows: val("rows", 8),
    cols: val("cols", 12),
    radius: val("radius", 0.28),
    corners: S.corners,
    channel: $("channel").value,
    linearize: $("lin").checked,
    dark_level: val("dark", 0),
    pos: $("pos").value,
    neg: $("neg").value,
    blank: $("blank").value,
    mode: $("mode").value,
    cutoff: val("cutoff", null),
    cutoff_low: val("cutlow", null),
    slope: val("slope", 1),
    intercept: val("icpt", 0),
    assay: S.selectedAssay
  };
}

async function run() {
  if (!S.dataUrl) return;
  const b = $("run");
  b.disabled = true;
  b.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span> <span>Analysing…</span>';
  showSkeletonLoading();
  try {
    const r = await api("/api/analyze", { image: S.dataUrl, config: cfg() });
    S.last = r;
    render(r);
    showToast(r.valid ? "Analysis complete · QC PASS" : "Analysis complete with QC alerts", r.valid ? "success" : "warning");
  } catch (err) {
    showMsgs([err.message], []);
    $("results").hidden = true;
  } finally {
    b.disabled = false;
    b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> <span>Run analysis</span>';
  }
}
$("run").onclick = run;

$("fit").onclick = async () => {
  const note = $("fitnote");
  note.textContent = "";
  if (!S.last) {
    note.textContent = "Run the analysis first.";
    return;
  }
  try {
    const od = {};
    S.last.wells.forEach(w => {
      if (w.od !== null) od[w.well] = w.od;
    });
    const f = await api("/api/calibrate", {
      rows: val("rows", 8),
      cols: val("cols", 12),
      image_od: od,
      reader: $("reader").value
    });
    $("slope").value = f.slope.toFixed(4);
    $("icpt").value = f.intercept.toFixed(4);
    note.textContent = `Fitted on ${f.n} wells: R² = ${f.r2 === null ? "n/a" : f.r2.toFixed(3)}, RMSE = ${f.rmse.toFixed(3)} OD. Re-running…`;
    await run();
  } catch (err) {
    note.textContent = err.message;
  }
};

/* ---------- Color Math & Ramps ---------- */
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpRgb(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
}
function contrastColor(rgb) {
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 145 ? "#0B0F14" : "#FFFFFF";
}

// 1. Sequential "TMB Amber" ramp: #FFF3C4 (low) -> #F5A524 -> #C2560C -> #5B1E08 (high)
const TMB_STOPS = [
  { t: 0.0, rgb: [246, 234, 188] },
  { t: 0.333, rgb: [245, 165, 36] },
  { t: 0.667, rgb: [194, 86, 12] },
  { t: 1.0, rgb: [91, 30, 8] }
];

function tmbAmberColor(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < TMB_STOPS.length - 1; i++) {
    const s1 = TMB_STOPS[i], s2 = TMB_STOPS[i + 1];
    if (t >= s1.t && t <= s2.t) {
      const segT = (t - s1.t) / (s2.t - s1.t);
      const rgb = lerpRgb(s1.rgb, s2.rgb, segT);
      return { bg: rgbToHex(...rgb), fg: contrastColor(rgb) };
    }
  }
  const last = TMB_STOPS[TMB_STOPS.length - 1].rgb;
  return { bg: rgbToHex(...last), fg: contrastColor(last) };
}

// 2. PI/PP Diverging scale centred on cutoff:
// Below cutoff: Teal #2A9D8F -> Near white #F8FAFC
// Above cutoff: Near white #F8FAFC -> Vermilion #E4572E
function divergingColor(val, cutoff, lo, hi) {
  if (val === null || !isFinite(val)) {
    return { bg: "#1E2633", fg: "#8B97A8", isAbove: false };
  }
  const isAbove = val >= cutoff;
  const TEAL = [60, 184, 168];     // #3CB8A8
  const WHITE = [232, 236, 242];   // #E8ECF2
  const VERMILION = [240, 113, 79]; // #F0714F
  let rgb;
  if (val < cutoff) {
    const span = Math.max(1e-4, cutoff - lo);
    const t = Math.max(0, Math.min(1, (val - lo) / span));
    rgb = lerpRgb(TEAL, WHITE, t);
  } else {
    const span = Math.max(1e-4, hi - cutoff);
    const t = Math.max(0, Math.min(1, (val - cutoff) / span));
    rgb = lerpRgb(WHITE, VERMILION, t);
  }
  return { bg: rgbToHex(...rgb), fg: contrastColor(rgb), isAbove };
}

/* ---------- Results Rendering (Professional Dashboard) ---------- */
function render(r) {
  showMsgs(r.errors, r.warnings);
  const res = $("results");
  res.hidden = false;

  // 1. Header row: Large QC pill, assay name, run time, action buttons
  const qcText = r.valid ? "PASS" : "FAIL";
  const qcPill = $("qc-pill");
  if (qcPill) {
    qcPill.className = "qc-status-pill " + (r.valid ? "qc-pass" : "qc-fail");
    const txt = $("qc-pill-text");
    if (txt) txt.textContent = qcText;
  }
  const metaAssay = $("results-meta-assay");
  if (metaAssay) metaAssay.textContent = r.assay || (r.mode === "PI" ? "Competitive (PI)" : "Indirect (PP)");
  const metaTime = $("results-meta-time");
  if (metaTime) metaTime.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const btnPrint = $("btn-print-report");
  if (btnPrint) btnPrint.onclick = () => window.print();
  const btnRerun = $("btn-rerun");
  if (btnRerun) btnRerun.onclick = () => run();

  // 2. KPI cards with subtle gradient borders and small icons
  const s = r.summary, st = $("stats");
  st.innerHTML = "";

  const addKpi = (label, val, iconSvg, cls = "") => {
    const card = el("div", null, "stat kpi-card" + (cls ? " " + cls : ""));
    const ic = el("div", null, "kpi-icon-wrap");
    ic.innerHTML = iconSvg;
    card.appendChild(ic);
    const b = el("b", null, "kpi-value");
    b.textContent = val;
    card.appendChild(b);
    const lbl = el("span", null, "kpi-label");
    lbl.textContent = label;
    card.appendChild(lbl);
    st.appendChild(card);
  };

  // Plate QC
  addKpi("Plate QC", r.valid ? "PASS" : "FAIL", '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>', r.valid ? "qc-pass" : "qc-fail");

  // Controls & Delta OD
  if (r.assay === "SPCE" || (r.mode === "PI" && s.pos_od === null)) {
    addKpi("Antigen (max) OD", fmt(s.neg_od, 3) + " OD", '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>');
  } else {
    addKpi("Positive ctrl OD", fmt(s.pos_od, 3) + " OD", '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>');
    addKpi("Negative ctrl OD", fmt(s.neg_od, 3) + " OD", '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>');
    if (s.delta_od !== null && s.delta_od !== undefined) {
      addKpi("Control ΔOD", fmt(s.delta_od, 3) + " OD", '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 22 22 2 22"></polygon></svg>');
    }
  }

  // Cutoff
  const cutPct = r.cutoff || (r.mode === "PP" ? 40 : 50);
  const cutOdStr = r.reference && r.reference.cutoff_od ? ` (${fmt(r.reference.cutoff_od, 3)} OD)` : "";
  addKpi("Cutoff", `${cutPct}%${cutOdStr}`, '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>');

  // Sample counts
  addKpi("Positive", String(s.positive || 0), '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>');
  addKpi("Negative", String(s.negative || 0), '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line></svg>');
  if (s.doubtful) addKpi("Doubtful", String(s.doubtful), '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>');
  if (s.invalid) addKpi("Invalid", String(s.invalid), '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>');

  // 3. Reference values panel
  renderReferencePanel(r);

  // 4. Stacked Proportion Bar
  renderSummaryStrip(r);
  draw();

  // 5. Accessible segmented control tabs
  const names = [
    ["table", "Table"],
    ["od", "OD heatmap"],
    ["val", r.mode === "PI" ? "PI % heatmap" : "PP % heatmap"],
    ["ann", "Annotated plate"]
  ];

  const t = $("tabs");
  t.innerHTML = "";
  t.setAttribute("role", "tablist");
  t.setAttribute("aria-label", "Results view selector");

  names.forEach(([k, n], idx) => {
    const b = el("button", n, "tab-btn" + (k === S.tab ? " on" : ""));
    b.setAttribute("role", "tab");
    b.id = "tab-" + k;
    b.setAttribute("aria-selected", k === S.tab ? "true" : "false");
    b.setAttribute("aria-controls", "view");
    b.setAttribute("tabindex", k === S.tab ? "0" : "-1");

    b.onclick = () => {
      S.tab = k;
      render(r);
    };

    b.onkeydown = e => {
      let targetIdx = null;
      if (e.key === "ArrowRight") targetIdx = (idx + 1) % names.length;
      else if (e.key === "ArrowLeft") targetIdx = (idx - 1 + names.length) % names.length;
      else if (e.key === "Home") targetIdx = 0;
      else if (e.key === "End") targetIdx = names.length - 1;

      if (targetIdx !== null) {
        e.preventDefault();
        S.tab = names[targetIdx][0];
        render(r);
        const nextBtn = $("tab-" + S.tab);
        if (nextBtn) nextBtn.focus();
      }
    };

    t.appendChild(b);
  });

  const v = $("view");
  v.innerHTML = "";
  if (S.tab === "table") v.appendChild(table(r));
  else if (S.tab === "od") v.appendChild(heat(r, "od_cal", 3));
  else if (S.tab === "val") v.appendChild(heat(r, "value", 1));
  else v.appendChild(annotatedView(r));

  // 6. Build Print View Bundle (@media print)
  renderPrintBundle(r);
}

/* ---------- Print View Bundle Builder ---------- */
function renderPrintBundle(r) {
  const p = $("print-bundle");
  if (!p) return;
  p.innerHTML = "";

  // Header
  const head = el("div", null, "print-header");
  const left = el("div");
  const title = el("h1", "PlateOD · Quantitative Microplate Analysis Report", "print-title");
  const meta = el("div", null, "print-meta");
  meta.textContent = `Generated: ${new Date().toLocaleString()} · Laboratory Scientific Edition`;
  left.appendChild(title);
  left.appendChild(meta);
  head.appendChild(left);
  p.appendChild(head);

  // Settings Grid
  const sGrid = el("div", null, "print-settings-grid");
  const addSetting = (k, val) => {
    const item = el("div");
    const l = el("strong", k + ": ");
    item.appendChild(l);
    const v = el("span");
    v.textContent = String(val);
    item.appendChild(v);
    sGrid.appendChild(item);
  };
  addSetting("Protocol", r.assay || r.mode);
  addSetting("Dimensions", `${$("rows").value} × ${$("cols").value}`);
  addSetting("Channel", $("channel").value);
  addSetting("Diagnostic Cutoff", `${r.cutoff}%`);
  addSetting("Linear Slope (m)", $("slope").value);
  addSetting("Intercept (c)", $("icpt").value);
  addSetting("QC Evaluation", r.valid ? "PASS" : "FAIL");
  p.appendChild(sGrid);

  // Print Section: Heatmaps Row
  const hmTitle = el("div", "Photometric Heatmaps (OD & Positivity/Inhibition)", "print-section-title");
  p.appendChild(hmTitle);

  const hmRow = el("div", null, "print-heatmaps-row");
  hmRow.appendChild(heat(r, "od_cal", 3));
  hmRow.appendChild(heat(r, "value", 1));
  p.appendChild(hmRow);

  // Print Section: Full Results Table
  const tblTitle = el("div", "Well Quantification & Classification Table", "print-section-title print-page-break");
  p.appendChild(tblTitle);
  p.appendChild(table(r));
}

/* ---------- Reference Values Panel ---------- */
function renderReferencePanel(r) {
  const panel = $("reference-panel");
  if (!panel) return;
  panel.innerHTML = "";
  if (!r.reference) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const w = el("div", null, "ref-panel");
  const head = el("div", null, "ref-panel-header");
  const title = el("div", null, "ref-panel-title");
  title.appendChild(el("span", `Reference values (${r.assay || (r.mode === "PI" ? "SPCE" : "DIVA")})`));
  head.appendChild(title);
  w.appendChild(head);

  const grid = el("div", null, "ref-grid");
  const addRef = (label, val, formula) => {
    const it = el("div", null, "ref-item");
    it.appendChild(el("div", label, "ref-label"));
    it.appendChild(el("div", val, "ref-value"));
    it.appendChild(el("div", formula, "ref-formula"));
    grid.appendChild(it);
  };

  const ref = r.reference;
  if (r.assay === "SPCE" || (!ref.pos_od && ref.max_od !== undefined)) {
    addRef("Max OD (Antigen)", fmt(ref.max_od, 3), "Negative/Antigen control OD");
    addRef("Blank Intensity", fmt(ref.blank_intensity, 4), "Mean intensity of blank wells");
    addRef("Cutoff Percent", `${fmt(ref.cutoff_percent, 1)}%`, "Threshold: PI ≥ Cutoff is Positive");
    addRef("Calculated Cutoff OD", fmt(ref.cutoff_od, 3), "cutoff_od = max_od × (1 - cutoff/100)");
  } else {
    addRef("Positive Control OD", fmt(ref.pos_od, 3), "Mean OD of positive control wells");
    addRef("Negative Control OD", fmt(ref.neg_od, 3), "Mean OD of negative control wells");
    addRef("Blank Intensity", fmt(ref.blank_intensity, 4), "Mean intensity of blank wells");
    addRef("Cutoff Percent", `${fmt(ref.cutoff_percent, 1)}%`, "Threshold: PP ≥ Cutoff is Positive");
    addRef("Calculated Cutoff OD", fmt(ref.cutoff_od, 3), "cutoff_od = neg_od + cutoff/100 × (pos_od - neg_od)");
  }
  w.appendChild(grid);
  panel.appendChild(w);
}

/* ---------- Stacked Proportion Bar (Strict textContent) ---------- */
function renderSummaryStrip(r) {
  const box = $("summary-strip");
  if (!box) return;
  box.innerHTML = "";
  const s = r.summary;
  const pos = s.positive || 0, neg = s.negative || 0, dbt = s.doubtful || 0, inv = s.invalid || 0;
  const total = (pos + neg + dbt + inv) || 1;
  const pPos = (pos / total * 100);
  const pNeg = (neg / total * 100);
  const pDbt = (dbt / total * 100);
  const pInv = (inv / total * 100);

  const container = el("div", null, "summary-strip-card");
  const head = el("div", null, "summary-strip-header");
  const title = el("span", "Sample Distribution Breakdown", "summary-title");
  head.appendChild(title);

  const leg = el("div", null, "summary-legend");
  const addLegItem = (label, cnt, pct, cls) => {
    const it = el("div", null, "summary-legend-item");
    const dot = el("span", null, "summary-dot " + cls);
    it.appendChild(dot);
    const txt = el("span", null, "summary-legend-text");
    txt.textContent = `${label}: ${cnt} (${pct.toFixed(1)}%)`;
    it.appendChild(txt);
    leg.appendChild(it);
  };

  addLegItem("Positive", pos, pPos, "Positive");
  addLegItem("Negative", neg, pNeg, "Negative");
  if (dbt > 0) addLegItem("Doubtful", dbt, pDbt, "Doubtful");
  if (inv > 0) addLegItem("Invalid", inv, pInv, "Invalid");

  head.appendChild(leg);
  container.appendChild(head);

  // Stacked proportion bar
  const bar = el("div", null, "summary-stacked-bar");
  const addSegment = (pct, cls, titleText) => {
    if (pct <= 0) return;
    const seg = el("div", null, "summary-bar-segment " + cls);
    seg.style.width = pct + "%";
    seg.title = titleText;
    bar.appendChild(seg);
  };

  addSegment(pPos, "Positive", `Positive: ${pPos.toFixed(1)}%`);
  addSegment(pNeg, "Negative", `Negative: ${pNeg.toFixed(1)}%`);
  addSegment(pDbt, "Doubtful", `Doubtful: ${pDbt.toFixed(1)}%`);
  addSegment(pInv, "Invalid", `Invalid: ${pInv.toFixed(1)}%`);

  container.appendChild(bar);
  box.appendChild(container);
}

/* ---------- Table View with Search, Sort & Flagged Toggle (Strict textContent) ---------- */
function table(r) {
  const wrap = el("div", null, "tbl-container");
  const tb = el("div", null, "tbl-toolbar");

  // Search box
  const sb = el("div", null, "tbl-search-box");
  sb.innerHTML = '<svg class="tbl-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
  const sinp = el("input");
  sinp.type = "text";
  sinp.id = "tbl-filter";
  sinp.placeholder = "Filter by well (e.g. A1, B)...";
  sinp.setAttribute("aria-label", "Filter wells by name");
  sinp.value = TBL.search || "";
  sinp.oninput = sinp.onkeyup = sinp.onchange = () => {
    TBL.search = sinp.value.trim();
    refreshRows();
  };
  sb.appendChild(sinp);
  tb.appendChild(sb);

  // Show Flagged Only toggle
  const flagLabel = el("label", null, "check-label tbl-flag-toggle");
  const flagInp = el("input");
  flagInp.type = "checkbox";
  flagInp.id = "tbl-flagged-only";
  flagInp.checked = Boolean(TBL.flaggedOnly);
  flagInp.onchange = () => {
    TBL.flaggedOnly = flagInp.checked;
    refreshRows();
  };
  flagLabel.appendChild(flagInp);
  const flagTxt = document.createTextNode("Show flagged only");
  flagLabel.appendChild(flagTxt);
  tb.appendChild(flagLabel);

  const countSpan = el("span", "", "tbl-count");
  tb.appendChild(countSpan);
  wrap.appendChild(tb);

  const tblWrap = el("div", null, "tbl");
  const t = el("table");
  const thead = el("thead"), thr = el("tr");

  const cols = [
    { key: "well", label: "Well", num: false },
    { key: "role", label: "Role", num: false },
    { key: "intensity", label: "Intensity", num: true, fmt: 4 },
    { key: "od", label: "Image OD", num: true, fmt: 4 },
    { key: "od_cal", label: "Calibrated OD", num: true, fmt: 4 },
    { key: "value", label: r.mode === "PI" ? "PI %" : "PP %", num: true, fmt: 1 },
    { key: "class", label: "Class", num: false },
    { key: "flag", label: "Note", num: false }
  ];

  cols.forEach(c => {
    const th = el("th", null, "sortable" + (c.num ? " num-col" : ""));
    th.textContent = c.label;
    const sIcon = el("span", "▲", "sort-icon");
    if (TBL.sortCol === c.key) {
      th.classList.add("sort-active");
      sIcon.textContent = TBL.sortAsc ? "▲" : "▼";
    }
    th.appendChild(sIcon);
    th.onclick = () => {
      if (TBL.sortCol === c.key) {
        TBL.sortAsc = !TBL.sortAsc;
      } else {
        TBL.sortCol = c.key;
        TBL.sortAsc = true;
      }
      render(r);
    };
    thr.appendChild(th);
  });
  thead.appendChild(thr);
  t.appendChild(thead);

  const tbody = el("tbody");
  t.appendChild(tbody);
  tblWrap.appendChild(t);
  wrap.appendChild(tblWrap);

  function refreshRows() {
    tbody.innerHTML = "";
    let list = r.wells.filter(w => {
      if (TBL.flaggedOnly && (!w.flag || w.flag === "")) return false;
      if (!TBL.search) return true;
      return w.well.toUpperCase().includes(TBL.search.toUpperCase());
    });
    countSpan.textContent = `Showing ${list.length} of ${r.wells.length} wells`;

    list.sort((a, b) => {
      let va = a[TBL.sortCol], vb = b[TBL.sortCol];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      let diff = 0;
      if (typeof va === "number" && typeof vb === "number") {
        diff = va - vb;
      } else {
        diff = String(va).localeCompare(String(vb), undefined, { numeric: true });
      }
      return TBL.sortAsc ? diff : -diff;
    });

    list.forEach(x => {
      const tr = el("tr");
      tr.appendChild(el("td", x.well));
      let roleDisplay = x.role;
      if (r.assay === "SPCE" && roleDisplay === "Negative ctrl") {
        roleDisplay = "Antigen (max-signal) control";
      }
      tr.appendChild(el("td", roleDisplay));
      tr.appendChild(el("td", fmt(x.intensity, 4), "num-col"));
      tr.appendChild(el("td", fmt(x.od, 4), "num-col"));
      tr.appendChild(el("td", fmt(x.od_cal, 4), "num-col"));
      tr.appendChild(el("td", fmt(x.value, 1), "num-col"));

      // Class badge with coloured dot
      const tdClass = el("td");
      const badge = el("span", null, "b " + x.class.split(" ")[0]);
      const dot = el("span", null, "b-dot");
      badge.appendChild(dot);
      const badgeTxt = document.createTextNode(x.class);
      badge.appendChild(badgeTxt);
      tdClass.appendChild(badge);
      tr.appendChild(tdClass);

      tr.appendChild(el("td", x.flag || ""));
      tbody.appendChild(tr);
    });
  }

  refreshRows();
  return wrap;
}

/* ---------- Tooltip Helpers ---------- */
const tooltip = $("heat-tooltip");
function showTooltip(e, w, r) {
  tooltip.innerHTML = "";
  const h = el("div", null, "tooltip-header");
  h.appendChild(el("span", w.well, "tooltip-well"));
  const b = el("span", w.class, "b " + w.class.split(" ")[0]);
  h.appendChild(b);
  tooltip.appendChild(h);

  const addRow = (k, v) => {
    const row = el("div", null, "tooltip-row");
    row.appendChild(el("span", k));
    row.appendChild(el("span", v, "tooltip-val"));
    tooltip.appendChild(row);
  };
  addRow("Role", w.role);
  addRow("Raw Intensity", fmt(w.intensity, 4));
  addRow("Image OD", fmt(w.od, 4));
  addRow("Calibrated OD", fmt(w.od_cal, 4));
  addRow(r.mode === "PI" ? "PI %" : "PP %", fmt(w.value, 1));
  if (w.flag) addRow("Note", w.flag);

  tooltip.classList.add("show");
  moveTooltip(e);
}
function moveTooltip(e) {
  const pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  const rw = window.innerWidth, rh = window.innerHeight;
  if (x + 210 > rw) x = e.clientX - 210 - pad;
  if (y + 180 > rh) y = e.clientY - 180 - pad;
  tooltip.style.left = Math.max(8, x) + "px";
  tooltip.style.top = Math.max(8, y) + "px";
}
function hideTooltip() { tooltip.classList.remove("show"); }

/* ---------- Heatmap with Ramps & Vertical Legend ---------- */
function heat(r, key, nd) {
  const rows = Math.max(...r.wells.map(w => w.row)) + 1;
  const cols = Math.max(...r.wells.map(w => w.col)) + 1;
  const isVal = (key === "value");
  const cutoff = r.cutoff || (r.mode === "PP" ? 40 : 50);

  const vs = r.wells.map(w => w[key]).filter(v => v !== null && isFinite(v));
  const lo = vs.length ? Math.min(...vs) : 0;
  const hi = vs.length ? Math.max(...vs) : 1;

  const container = el("div", null, "heat-container");
  const g = el("div", null, "heat");
  g.style.gridTemplateColumns = `28px repeat(${cols},minmax(38px,1fr))`;

  // Header column numbers
  g.appendChild(el("div", "", "heat-header"));
  for (let c = 0; c < cols; c++) g.appendChild(el("div", String(c + 1), "heat-header"));

  const m = {};
  r.wells.forEach(w => { m[w.row + "," + w.col] = w; });

  for (let i = 0; i < rows; i++) {
    g.appendChild(el("div", "ABCDEFGHIJKLMNOP"[i], "heat-header"));
    for (let c = 0; c < cols; c++) {
      const w = m[i + "," + c], v = w[key];
      const cell = el("div", fmt(v, nd), "heat-cell");

      if (v === null || !isFinite(v)) {
        cell.style.background = "#1E2633";
        cell.style.color = "#6B778C";
      } else if (!isVal) {
        // Sequential TMB amber ramp for OD
        const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
        const color = tmbAmberColor(t);
        cell.style.background = color.bg;
        cell.style.color = color.fg;
      } else {
        // Diverging scale centred on cutoff for PI/PP
        const color = divergingColor(v, cutoff, lo, hi);
        cell.style.background = color.bg;
        cell.style.color = color.fg;
        if (color.isAbove) cell.classList.add("cutoff-outline");
      }

      // Corner markers
      if (w.role === "Positive ctrl" || w.role === "Negative ctrl" || w.role.includes("Antigen")) {
        cell.appendChild(el("span", null, "corner-ctl"));
      } else if (w.role === "Blank") {
        cell.appendChild(el("span", null, "corner-blk"));
      }

      // Interactive Tooltip
      cell.onpointerenter = e => showTooltip(e, w, r);
      cell.onpointermove = moveTooltip;
      cell.onpointerleave = hideTooltip;

      g.appendChild(cell);
    }
  }
  container.appendChild(g);

  // Vertical Colour Legend
  const leg = el("div", null, "heat-legend");
  leg.appendChild(el("span", isVal ? (r.mode === "PI" ? "PI %" : "PP %") : "OD", "legend-title"));
  leg.appendChild(el("span", fmt(hi, isVal ? 1 : 2), "legend-val"));

  const bWrap = el("div", null, "legend-bar-wrap");
  const bar = el("div", null, "legend-bar");

  if (!isVal) {
    // TMB Amber vertical gradient (top=high, bottom=low)
    bar.style.background = "linear-gradient(180deg, #5B1E08 0%, #C2560C 33.3%, #F5A524 66.7%, #FFF3C4 100%)";
  } else {
    // Diverging vertical gradient (top=high vermilion, middle=near white, bottom=low teal)
    const cutPos = hi > lo ? Math.max(0, Math.min(100, (1 - (cutoff - lo) / (hi - lo)) * 100)) : 50;
    bar.style.background = `linear-gradient(180deg, #E4572E 0%, #F8FAFC ${cutPos}%, #2A9D8F 100%)`;

    const cMark = el("div", `Cutoff: ${cutoff}%`, "legend-cutoff-mark");
    cMark.style.top = cutPos + "%";
    bWrap.appendChild(cMark);
  }

  bWrap.appendChild(bar);
  leg.appendChild(bWrap);
  leg.appendChild(el("span", fmt(lo, isVal ? 1 : 2), "legend-val"));
  container.appendChild(leg);

  return container;
}

/* ---------- Annotated Plate View with Lightbox & Legend ---------- */
function annotatedView(r) {
  const wrap = el("div", null, "annot-container");
  const frame = el("div", null, "annot-frame");
  const img = el("img");
  img.id = "annot";
  img.src = r.annotated;
  img.alt = "Annotated Plate";
  frame.appendChild(img);

  const badge = el("div", null, "annot-zoom-badge");
  badge.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg> Click to zoom';
  frame.appendChild(badge);

  // Lightbox Trigger
  frame.onclick = () => {
    const lb = $("lightbox");
    $("lightbox-img").src = r.annotated;
    lb.hidden = false;
  };
  wrap.appendChild(frame);

  // Class Colours Legend
  const leg = el("div", null, "annot-legend");
  leg.appendChild(el("span", "Classes:", "annot-legend-title"));
  ["Positive", "Negative", "Doubtful", "Control", "Blank", "Invalid"].forEach(cls => {
    leg.appendChild(el("span", cls, "b " + cls));
  });
  wrap.appendChild(leg);

  return wrap;
}

// Lightbox event handlers
$("lightbox").onclick = e => {
  if (e.target !== $("lightbox-img")) $("lightbox").hidden = true;
};
$("lightbox-close").onclick = () => { $("lightbox").hidden = true; };
window.addEventListener("keydown", e => {
  if (e.key === "Escape") $("lightbox").hidden = true;
});

/* ---------- CSV Export ---------- */
$("csv").onclick = () => {
  if (!S.last) return;
  const q = S.last, rows = ["well,role,intensity,image_od,calibrated_od," + (q.mode === "PI" ? "PI_percent" : "PP_percent") + ",class,note"];
  q.wells.forEach(w => rows.push([w.well, w.role, w.intensity ?? "", w.od ?? "", w.od_cal ?? "", w.value ?? "", w.class, w.flag].join(",")));
  const a = el("a");
  a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  a.download = "plate_results.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

/* ---------- Preset Section Quick Buttons ---------- */
document.querySelectorAll(".preset-act-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const assay = btn.getAttribute("data-preset");
    const analyzer = document.getElementById("analyzer");
    if (analyzer) {
      analyzer.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (S.dataUrl && S.presets) {
      selectAssay(assay);
    } else {
      window.pendingAssay = assay;
      const ph = $("ph");
      if (ph) {
        ph.style.borderColor = "var(--amber-primary)";
        ph.style.boxShadow = "0 0 16px rgba(245, 165, 36, 0.4)";
        setTimeout(() => {
          ph.style.borderColor = "";
          ph.style.boxShadow = "";
        }, 2500);
      }
    }
  });
});

/* ---------- Accessible FAQ Accordion ---------- */
document.querySelectorAll(".accordion-header").forEach(btn => {
  btn.addEventListener("click", () => {
    const isExpanded = btn.getAttribute("aria-expanded") === "true";
    const panelId = btn.getAttribute("aria-controls");
    const panel = document.getElementById(panelId);
    if (!panel) return;

    if (isExpanded) {
      btn.setAttribute("aria-expanded", "false");
      panel.hidden = true;
    } else {
      btn.setAttribute("aria-expanded", "true");
      panel.hidden = false;
    }
  });
});

/* ---------- Scroll-Reveal Animations (IntersectionObserver) ---------- */
function initScrollReveal() {
  const reveals = document.querySelectorAll(".reveal");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
    reveals.forEach(el => el.classList.add("revealed"));
    return;
  }
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("revealed");
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });

  reveals.forEach(el => observer.observe(el));
}
initScrollReveal();


/* ---------- Stepper Validation & Form Error Handling ---------- */
const CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';

function setBadgeValid(badgeEl, isValid, defaultNum) {
  if (!badgeEl) return;
  if (isValid) {
    badgeEl.classList.add("step-valid");
    badgeEl.innerHTML = CHECK_SVG;
    badgeEl.setAttribute("aria-label", `Step ${defaultNum} valid`);
  } else {
    badgeEl.classList.remove("step-valid");
    badgeEl.textContent = String(defaultNum);
    badgeEl.setAttribute("aria-label", `Step ${defaultNum}`);
  }
}

function validateWellToken(token, maxRows = 16, maxCols = 24) {
  token = token.trim();
  if (!token) return false;
  const parts = token.split("-");
  if (parts.length > 2) return false;
  for (const p of parts) {
    const m = p.trim().match(/^([A-Pa-p])([1-9]|1[0-9]|2[0-4])$/);
    if (!m) return false;
    const r = m[1].toUpperCase().charCodeAt(0) - 65;
    const c = parseInt(m[2], 10);
    if (r >= maxRows || c > maxCols) return false;
  }
  return true;
}

function validateWellField(inputEl, errorEl, allowEmpty = false) {
  if (!inputEl) return true;
  const maxRows = +($("rows").value) || 8;
  const maxCols = +($("cols").value) || 12;
  const val = inputEl.value.trim();
  if (!val) {
    if (allowEmpty) {
      if (errorEl) errorEl.hidden = true;
      inputEl.classList.remove("input-error");
      return true;
    } else {
      if (errorEl) {
        errorEl.textContent = "This field cannot be empty";
        errorEl.hidden = false;
      }
      inputEl.classList.add("input-error");
      return false;
    }
  }
  const tokens = val.split(",");
  for (const t of tokens) {
    if (!validateWellToken(t, maxRows, maxCols)) {
      if (errorEl) {
        errorEl.textContent = `Invalid well "${t.trim()}" (e.g. A1, B1-B12)`;
        errorEl.hidden = false;
      }
      inputEl.classList.add("input-error");
      return false;
    }
  }
  if (errorEl) errorEl.hidden = true;
  inputEl.classList.remove("input-error");
  return true;
}

function updateStepperValidation() {
  // Step 1: Plate & image
  const s1Valid = Boolean(S.img) && +($("rows").value) >= 2 && +($("cols").value) >= 2 && +($("radius").value) >= 0.1;
  setBadgeValid($("step-badge-1"), s1Valid, 1);

  // Step 2: Well roles
  const isSpce = (S.selectedAssay === "SPCE");
  const posOk = validateWellField($("pos"), $("pos-err"), isSpce);
  const negOk = validateWellField($("neg"), $("neg-err"), false);
  const blkOk = validateWellField($("blank"), $("blank-err"), false);
  const s2Valid = posOk && negOk && blkOk;
  setBadgeValid($("step-badge-2"), s2Valid, 2);

  // Step 3: Measurement
  const cutoffVal = parseFloat($("cutoff").value);
  const s3Valid = !isNaN(cutoffVal) && cutoffVal > 0 && Boolean($("channel").value) && Boolean($("mode").value);
  setBadgeValid($("step-badge-3"), s3Valid, 3);

  // Step 4: Calibration
  const slopeVal = parseFloat($("slope").value);
  const icptVal = parseFloat($("icpt").value);
  const s4Valid = !isNaN(slopeVal) && !isNaN(icptVal);
  setBadgeValid($("step-badge-4"), s4Valid, 4);
}

// Bind live stepper validation
["rows", "cols", "radius"].forEach(id => $(id)?.addEventListener("input", updateStepperValidation));
["pos", "neg", "blank"].forEach(id => $(id)?.addEventListener("input", updateStepperValidation));
["channel", "dark", "lin", "mode", "cutoff", "cutlow"].forEach(id => $(id)?.addEventListener("input", updateStepperValidation));
["slope", "icpt", "reader"].forEach(id => $(id)?.addEventListener("input", updateStepperValidation));
updateStepperValidation();

// Change photo button
const btnChange = $("btn-change-file");
if (btnChange) {
  btnChange.onclick = () => $("file").click();
}

/* ---------- Zoom Controls ---------- */
document.querySelectorAll(".zoom-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".zoom-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const z = parseFloat(btn.getAttribute("data-zoom")) || 1.0;
    S.zoomLevel = z;
    const cv = $("cv");
    if (cv) {
      if (z === 1.0) {
        cv.style.width = "100%";
      } else {
        cv.style.width = (z * 100) + "%";
      }
    }
  });
});

/* ---------- Toast Notification System ---------- */
function showToast(message, type = "info", duration = 4000) {
  const container = $("toast-container");
  if (!container) return;
  const t = el("div", null, "toast toast-" + type);
  
  let iconSvg = '';
  if (type === "success") {
    iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  } else if (type === "error") {
    iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
  } else {
    iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F5A524" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
  }
  
  t.innerHTML = `${iconSvg}<span>${message}</span>`;
  container.appendChild(t);
  
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateY(8px)";
    t.style.transition = "all 200ms ease";
    setTimeout(() => t.remove(), 220);
  }, duration);
}

/* ---------- Skeleton Loading UI ---------- */
function showSkeletonLoading() {
  const res = $("results");
  if (!res) return;
  res.hidden = false;
  
  const stats = $("stats");
  if (stats) {
    stats.innerHTML = `
      <div class="stat skeleton-box" style="height: 72px;"></div>
      <div class="stat skeleton-box" style="height: 72px;"></div>
      <div class="stat skeleton-box" style="height: 72px;"></div>
      <div class="stat skeleton-box" style="height: 72px;"></div>
    `;
  }
  const summary = $("summary-strip");
  if (summary) {
    summary.innerHTML = `<div class="skeleton-box" style="height: 38px; margin-bottom: 16px;"></div>`;
  }
  const view = $("view");
  if (view) {
    view.innerHTML = `<div class="skeleton-box" style="height: 280px; width: 100%;"></div>`;
  }
  res.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
