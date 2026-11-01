"use strict";

/**
 * PlateOD — 19 Design Movement Aesthetics Engine (aesthetics.js)
 * 
 * Manages dynamic switching, persisting, and rendering of all 19 iconic
 * design styles for PlateOD.
 */

export const AESTHETIC_STYLES = [
  {
    id: "default",
    name: "Precision Instrument",
    era: "Contemporary Metrology",
    category: "Modern",
    desc: "Precision dark instrument workstation. Monospace tabular readouts, signal amber indicators, and strict hairline boundaries.",
    palette: ["#0A0A0B", "#17171A", "#F2B01E", "#F2F2EE"]
  },
  {
    id: "skeuomorphism",
    name: "Skeuomorphism",
    era: "1980s – 2010s Physical UI",
    category: "Historical",
    desc: "Tactile brushed steel chassis, beveled glass microplate wells, incandescent amber lamps, and physically embossed push-buttons.",
    palette: ["#101214", "#24292e", "#ff9e1b", "#f0f3f6"]
  },
  {
    id: "neumorphism",
    name: "Neumorphism",
    era: "Soft UI · 2020",
    category: "Digital",
    desc: "Continuous extruded charcoal surface with dual ambient light & shadow casts. Wells and controls debossed directly into the plane.",
    palette: ["#1e2025", "#212429", "#00e5ff", "#e6e8ee"]
  },
  {
    id: "art-nouveau",
    name: "Art Nouveau",
    era: "1890 – 1910 Paris & Vienna",
    category: "Fine Art",
    desc: "Organic whiplash curves, sinuous botanical tendrils, antique absinthe green, aged terracotta, and gilded ornamental framing.",
    palette: ["#181c15", "#242c20", "#c9a859", "#f5eedc"]
  },
  {
    id: "liquid-chrome",
    name: "Liquid Chrome",
    era: "Post-Digital Specular",
    category: "Futuristic",
    desc: "Fluid mercury metallic sheens, razor-sharp specular highlights, and iridescent chromatic reflections on deep obsidian.",
    palette: ["#050608", "#161a22", "#e2e8f0", "#a78bfa"]
  },
  {
    id: "de-stijl",
    name: "De Stijl",
    era: "1917 – 1931 Piet Mondrian",
    category: "Modernist",
    desc: "Strict orthogonal black bounding grids with asymmetric primary blocks of cadmium red, cobalt blue, and radiant yellow.",
    palette: ["#000000", "#ffffff", "#e63946", "#1d3557", "#ffb703"]
  },
  {
    id: "memphis",
    name: "Memphis",
    era: "1981 Milan Postmodernism",
    category: "Retro",
    desc: "Radical Ettore Sottsass geometry, playful squiggles, confetti terrazzo patterns, neon pastel pink, and electric cyan clashes.",
    palette: ["#231e3d", "#ff70a6", "#70d6ff", "#ffd670"]
  },
  {
    id: "psychedelic",
    name: "Psychedelic",
    era: "1960s Counter-Culture",
    category: "Fine Art",
    desc: "Hypnotic chromatic wave distortions, iridescent optical swirls, melted contours, and saturated psychedelic spectrums.",
    palette: ["#1a0833", "#f72585", "#7209b7", "#ff6b35"]
  },
  {
    id: "vaporwave",
    name: "Vaporwave",
    era: "1980s Retro Cyberspace",
    category: "Digital",
    desc: "Nostalgic CRT scanlines, sunset neon horizon wireframes, hot synthwave magenta, electric cyan, and aesthetic katakana typography.",
    palette: ["#100424", "#ff007f", "#00f0ff", "#ff77c6"]
  },
  {
    id: "steampunk",
    name: "Steampunk",
    era: "Victorian Industrial Steam",
    category: "Historical",
    desc: "Weathered brass fittings, hand-riveted copper plating, exposed escapement gearworks, and warm aged parchment dials.",
    palette: ["#221a14", "#34281f", "#c99738", "#f4ecd8"]
  },
  {
    id: "grunge",
    name: "Grunge",
    era: "1990s Underground Zines",
    category: "Alternative",
    desc: "Distressed photocopier halftone grain, oxidized industrial rust, typewriter monospace, and raw stamped utilitarian badges.",
    palette: ["#191919", "#282828", "#c84b31", "#d9ad26"]
  },
  {
    id: "paper-cutout",
    name: "Paper Cutout",
    era: "Tactile Papercraft",
    category: "Tactile",
    desc: "Multi-layered physical cardstock sheets with warm cast shadows, folded guillotine paper edges, and origami well depths.",
    palette: ["#1a1e26", "#282f3d", "#e0a96d", "#f2f5fa"]
  },
  {
    id: "glitch",
    name: "Glitch",
    era: "Cyberpunk Digital Decay",
    category: "Digital",
    desc: "Terminal signal corruption, RGB chromatic aberration split, CRT phosphor scanline trace, and jittered calibration readouts.",
    palette: ["#080a0f", "#00ff66", "#ff003c", "#00f3ff"]
  },
  {
    id: "anti-design",
    name: "Anti-Design",
    era: "Neo-Dadaist Subversion",
    category: "Experimental",
    desc: "Raw rebellion against conventional UI rules: unaligned discordant grids, hazard tape accents, and brutal neon clashes.",
    palette: ["#ffff00", "#000000", "#ff00ff", "#ffffff"]
  },
  {
    id: "3d-inflated",
    name: "3D-Inflated",
    era: "Glossy Claymorphism",
    category: "Tactile",
    desc: "Squishy 3D pill shapes, bulbous inflated balloon corners, bouncy specular reflections, and soft gummy tactile depth.",
    palette: ["#231835", "#3a2858", "#ff4d8d", "#e2d1f9"]
  },
  {
    id: "isometric",
    name: "Isometric",
    era: "Architectural Axonometry",
    category: "Technical",
    desc: "Precision 30-degree orthographic drafting projection, blueprint CAD schematics, and isometric volumetric microplates.",
    palette: ["#0c172e", "#162a54", "#00b4d8", "#e0e1dd"]
  },
  {
    id: "ukiyo-e",
    name: "Ukiyo-e",
    era: "17th – 19th C. Edo Japan",
    category: "Fine Art",
    desc: "Traditional Japanese woodblock prints: Prussian indigo Great Wave ripples, fibrous washi paper grain, and vermillion hanko seals.",
    palette: ["#172432", "#263c52", "#c73e1d", "#f2eee6"]
  },
  {
    id: "brutalism",
    name: "Brutalism",
    era: "Raw Monolithic Architecture",
    category: "Modernist",
    desc: "Stark black & white contrast, heavy 3px borders, hard solid 4px black offset drop shadows, zero radius, and raw monospace.",
    palette: ["#000000", "#ffffff", "#ff5500", "#e5e5e5"]
  },
  {
    id: "bauhaus",
    name: "Bauhaus",
    era: "1919 Weimar Modernism",
    category: "Modernist",
    desc: "Elemental geometry: circle, triangle, square. Functionalist discipline, primary Bauhaus red, cobalt, and cadmium yellow.",
    palette: ["#1f1f21", "#ffffff", "#d90429", "#ffc300"]
  },
  {
    id: "mid-century-modern",
    name: "Mid-Century Modern",
    era: "1950s Atomic & Eames Era",
    category: "Retro",
    desc: "Warm walnut wood warmth, atomic boomerang geometry, mustard gold, avocado green, and burnt atomic orange accents.",
    palette: ["#281d15", "#3e2f23", "#c58940", "#c85a17"]
  }
];

const STORAGE_KEY = "plateod_aesthetic";
let currentStyle = "default";

/**
 * Initialize the aesthetics engine.
 */
export function initAesthetics() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && AESTHETIC_STYLES.some(s => s.id === saved)) {
    applyAesthetic(saved, false);
  } else {
    applyAesthetic("default", false);
  }

  // Setup dropdown in header if present
  setupHeaderDropdown();

  // Setup grid button listeners
  setupGridActions();
}

/**
 * Apply a style to the entire page.
 * @param {string} styleId
 * @param {boolean} [save=true]
 */
export function applyAesthetic(styleId, save = true) {
  const match = AESTHETIC_STYLES.find(s => s.id === styleId);
  if (!match) return;

  currentStyle = styleId;
  if (styleId === "default") {
    document.documentElement.removeAttribute("data-style");
  } else {
    document.documentElement.setAttribute("data-style", styleId);
  }

  if (save) {
    localStorage.setItem(STORAGE_KEY, styleId);
  }

  // Update header trigger button label
  const labelEl = document.getElementById("header-current-style-label");
  if (labelEl) {
    labelEl.textContent = match.name;
  }

  // Update lab badge
  const labBadge = document.getElementById("current-aesthetic-name");
  if (labBadge) {
    labBadge.textContent = match.name;
  }

  // Update active card in grid
  const cards = document.querySelectorAll(".aesthetic-card");
  cards.forEach(card => {
    if (card.dataset.styleId === styleId) {
      card.classList.add("active-style");
      const btn = card.querySelector(".btn-apply-aesthetic");
      if (btn) btn.textContent = "Active Style";
    } else {
      card.classList.remove("active-style");
      const btn = card.querySelector(".btn-apply-aesthetic");
      if (btn) btn.textContent = "Apply Style";
    }
  });

  // Update dropdown items
  const menuItems = document.querySelectorAll(".style-dropdown-item");
  menuItems.forEach(item => {
    if (item.dataset.styleId === styleId) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  // Dispatch global event for other components (e.g. canvas)
  window.dispatchEvent(new CustomEvent("plateod:aesthetic-changed", {
    detail: { styleId, style: match }
  }));
}

/**
 * Get current active style object
 */
export function getCurrentAesthetic() {
  return AESTHETIC_STYLES.find(s => s.id === currentStyle) || AESTHETIC_STYLES[0];
}

/**
 * Setup header dropdown interactions
 */
function setupHeaderDropdown() {
  const toggleBtn = document.getElementById("btn-toggle-style-menu");
  const menu = document.getElementById("header-style-menu");
  if (!toggleBtn || !menu) return;

  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isShowing = menu.classList.contains("show");
    if (isShowing) {
      menu.classList.remove("show");
      toggleBtn.setAttribute("aria-expanded", "false");
    } else {
      menu.classList.add("show");
      toggleBtn.setAttribute("aria-expanded", "true");
    }
  });

  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && e.target !== toggleBtn) {
      menu.classList.remove("show");
      toggleBtn.setAttribute("aria-expanded", "false");
    }
  });

  // Populate menu items if empty
  if (menu.children.length === 0) {
    AESTHETIC_STYLES.forEach(style => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "style-dropdown-item";
      btn.dataset.styleId = style.id;
      if (style.id === currentStyle) btn.classList.add("active");

      const nameSpan = document.createElement("span");
      nameSpan.textContent = style.name;

      const swatchSpan = document.createElement("span");
      swatchSpan.className = "swatch";
      swatchSpan.style.background = style.palette[2] || style.palette[0];
      swatchSpan.style.width = "12px";
      swatchSpan.style.height = "12px";

      btn.appendChild(nameSpan);
      btn.appendChild(swatchSpan);

      btn.addEventListener("click", () => {
        applyAesthetic(style.id);
        menu.classList.remove("show");
        toggleBtn.setAttribute("aria-expanded", "false");
      });

      menu.appendChild(btn);
    });
  }
}

/**
 * Setup lab grid apply actions and filters
 */
function setupGridActions() {
  const container = document.getElementById("aesthetics-grid");
  if (!container) return;

  // Delegate click for apply buttons
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-apply-aesthetic");
    if (!btn) return;
    const card = btn.closest(".aesthetic-card");
    if (!card) return;
    const styleId = card.dataset.styleId;
    if (styleId) {
      applyAesthetic(styleId);
    }
  });

  // Setup category filters
  const filterBtns = document.querySelectorAll(".aesthetics-filter-group .filter-btn");
  filterBtns.forEach(fBtn => {
    fBtn.addEventListener("click", () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      fBtn.classList.add("active");
      const category = fBtn.dataset.filter;

      const cards = container.querySelectorAll(".aesthetic-card");
      cards.forEach(card => {
        if (!category || category === "all" || card.dataset.category === category) {
          card.style.display = "";
        } else {
          card.style.display = "none";
        }
      });
    });
  });
}


if (typeof window !== "undefined") {
  window.applyAesthetic = applyAesthetic;
  window.AESTHETIC_STYLES = AESTHETIC_STYLES;
  window.getCurrentAesthetic = getCurrentAesthetic;
}
