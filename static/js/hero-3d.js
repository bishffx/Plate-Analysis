"use strict";

/**
 * PlateOD High-Performance 3D Hero Module (hero-3d.js)
 * 
 * - Single-pass ShaderMaterial with vertex-shader noise displacement,
 *   Fresnel rim lighting, and shader-based optical iridescence.
 * - Zero Three.js transmission passes, zero extra render passes, zero post-processing.
 * - Lowest smooth sphere subdivision: SphereGeometry(1.6, 32, 24).
 * - Up to 120 photometric floating particles (60 in Medium, 0 in Low).
 * - DPR cap: 1.5 desktop / 1.0 phone.
 * - Pauses automatically when document.hidden, when #home is off-screen,
 *   or when #analyzer is visible in viewport.
 * - Disposes geometries, materials, textures, renderer on teardown.
 */

import * as THREE from "../vendor/three/three.module.js";
import { registerThreeRenderer } from "./perf.js";
import { getQualityState } from "./adaptive-quality.js";

let canvas = null;
let renderer = null;
let scene = null;
let camera = null;
let orbMesh = null;
let particlesMesh = null;
let orbMaterial = null;
let particlesMaterial = null;

let isHeroVisible = true;
let isAnalyzerVisible = false;
let isRunning = false;
let mouseX = 0;
let mouseY = 0;
let targetRotX = 0;
let targetRotY = 0;
let homeObserver = null;
let analyzerObserver = null;

export function initHero3D() {
  canvas = document.getElementById("hero-plate-canvas");
  if (!canvas) return;

  const wrap = canvas.parentElement || document.getElementById("hero-canvas-wrap");
  const rect = wrap ? wrap.getBoundingClientRect() : { width: 520, height: 420 };
  const width = Math.max(300, rect.width || 520);
  const height = Math.max(260, rect.height || 420);

  // 1. Scene & Camera
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 50);
  camera.position.set(0, 0, 4.8);

  // 2. High-performance WebGL Renderer
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance"
    });
  } catch (err) {
    console.warn("[Hero3D] WebGL not available:", err);
    return;
  }

  const isMobile = window.innerWidth < 768;
  const qState = getQualityState();
  const dprCap = isMobile ? 1.0 : qState.dprCap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.setSize(width, height, false);

  registerThreeRenderer(renderer);

  // 3. Single-pass ShaderMaterial for Orb
  // Fresnel rim + vertex noise displacement + optical iridescence
  orbMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        
        // Single-pass harmonic displacement in vertex shader
        vec3 pos = position;
        float wave = sin(pos.x * 2.2 + uTime * 1.4) * cos(pos.y * 2.2 + uTime * 1.1) * 0.11;
        pos += normal * wave;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec2 vUv;

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);

        // Fresnel rim
        float fresnel = pow(1.0 - max(0.0, dot(viewDir, normal)), 2.8);

        // Angle-dependent optical iridescence
        float nDotV = max(0.0, dot(normal, viewDir));
        vec3 iri = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + nDotV * 1.6 + uTime * 0.12));

        // Precision instrument obsidian & warm amber core
        vec3 coreColor = mix(vec3(0.05, 0.07, 0.10), vec3(0.96, 0.65, 0.14), nDotV * 0.4);
        vec3 surfaceColor = mix(coreColor, iri, 0.42);
        vec3 finalColor = surfaceColor + vec3(0.96, 0.72, 0.22) * (fresnel * 0.9);

        gl_FragColor = vec4(finalColor, 0.96);
      }
    `,
    transparent: true,
    depthWrite: true
  });

  // Lowest smooth sphere subdivision: (1.6, 32, 24)
  const sphereGeo = new THREE.SphereGeometry(1.6, 32, 24);
  orbMesh = new THREE.Mesh(sphereGeo, orbMaterial);
  scene.add(orbMesh);

  // 4. Photometric floating particles (max 120)
  buildParticles(qState.particlesCount);

  // 5. Interactive pointer listener
  wrap?.addEventListener("pointermove", (e) => {
    const r = wrap.getBoundingClientRect();
    mouseX = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouseY = -(((e.clientY - r.top) / r.height) * 2 - 1);
    targetRotY = mouseX * 0.45;
    targetRotX = -mouseY * 0.35;
  }, { passive: true });

  wrap?.addEventListener("pointerleave", () => {
    targetRotX = 0;
    targetRotY = 0;
  }, { passive: true });

  // 6. Viewport visibility observation
  initVisibilityObservers();

  // 7. Quality change listener
  window.addEventListener("plateod:quality", (e) => {
    const q = e.detail;
    if (!renderer) return;
    const isMob = window.innerWidth < 768;
    const cap = isMob ? 1.0 : q.dprCap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    buildParticles(q.particlesCount);
    if (q.isStatic) {
      renderSingleFrame();
      stopLoop();
    } else {
      checkShouldRun();
    }
  });

  // Resize handler
  window.addEventListener("resize", () => {
    if (!renderer || !camera || !wrap) return;
    const w = wrap.clientWidth || 520;
    const h = wrap.clientHeight || 420;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }, { passive: true });

  checkShouldRun();
}

function buildParticles(count) {
  if (particlesMesh) {
    scene.remove(particlesMesh);
    if (particlesMesh.geometry) particlesMesh.geometry.dispose();
  }
  if (count <= 0) return;

  const actualCount = Math.min(120, count);
  const positions = new Float32Array(actualCount * 3);
  for (let i = 0; i < actualCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const r = 2.0 + Math.random() * 1.2;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  if (!particlesMaterial) {
    particlesMaterial = new THREE.PointsMaterial({
      color: 0xF5A524,
      size: 0.045,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });
  }

  particlesMesh = new THREE.Points(geo, particlesMaterial);
  scene.add(particlesMesh);
}

function initVisibilityObservers() {
  const homeSec = document.getElementById("home") || document.querySelector(".hero-section");
  const analyzerSec = document.getElementById("analyzer");

  if ("IntersectionObserver" in window) {
    if (homeSec) {
      homeObserver = new IntersectionObserver(([entry]) => {
        isHeroVisible = entry.isIntersecting;
        checkShouldRun();
      }, { threshold: 0.05 });
      homeObserver.observe(homeSec);
    }

    if (analyzerSec) {
      analyzerObserver = new IntersectionObserver(([entry]) => {
        isAnalyzerVisible = entry.isIntersecting;
        checkShouldRun();
      }, { threshold: 0.05 });
      analyzerObserver.observe(analyzerSec);
    }
  }

  document.addEventListener("visibilitychange", () => {
    checkShouldRun();
  });
}

function checkShouldRun() {
  const qState = getQualityState();
  const shouldRun = !document.hidden &&
                    isHeroVisible &&
                    !isAnalyzerVisible &&
                    !qState.isStatic &&
                    !qState.isOff;

  if (shouldRun && !isRunning) {
    startLoop();
  } else if (!shouldRun && isRunning) {
    stopLoop();
  }
}

let animFrameId = null;
let lastTime = 0;

function startLoop() {
  if (isRunning) return;
  isRunning = true;
  lastTime = performance.now();

  function tick(now) {
    if (!isRunning) return;
    const deltaSec = (now - lastTime) / 1000;
    lastTime = now;

    renderScene(now / 1000, deltaSec);
    animFrameId = requestAnimationFrame(tick);
  }

  animFrameId = requestAnimationFrame(tick);
}

function stopLoop() {
  isRunning = false;
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

function renderScene(timeSec, deltaSec) {
  if (!renderer || !scene || !camera) return;

  // Gentle rotation towards target
  if (orbMesh) {
    orbMesh.rotation.y += (targetRotY - orbMesh.rotation.y) * 0.08 + deltaSec * 0.25;
    orbMesh.rotation.x += (targetRotX - orbMesh.rotation.x) * 0.08;
    if (orbMaterial && orbMaterial.uniforms) {
      orbMaterial.uniforms.uTime.value = timeSec;
    }
  }

  if (particlesMesh) {
    particlesMesh.rotation.y += deltaSec * 0.08;
  }

  renderer.render(scene, camera);
}

function renderSingleFrame() {
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

export function teardownHero3D() {
  stopLoop();
  if (homeObserver) homeObserver.disconnect();
  if (analyzerObserver) analyzerObserver.disconnect();

  if (orbMesh) {
    if (orbMesh.geometry) orbMesh.geometry.dispose();
    if (orbMesh.material) orbMesh.material.dispose();
    scene.remove(orbMesh);
  }
  if (particlesMesh) {
    if (particlesMesh.geometry) particlesMesh.geometry.dispose();
    scene.remove(particlesMesh);
  }
  if (particlesMaterial) particlesMaterial.dispose();
  if (renderer) renderer.dispose();
}
