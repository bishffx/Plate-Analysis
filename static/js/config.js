"use strict";

/**
 * PlateOD Config Module (config.js)
 * 
 * Named configuration export (JSON download) and import with schema validation.
 */

import { S } from "./state.js";
import { $, showToast } from "./dom.js";
import { cfg } from "./analysis.js";
import { selectAssay } from "./presets.js";
import { setCalibrationModel } from "./calibration.js";
import { draw, refreshGrid, updateLiveReadout } from "./plate-canvas.js";

export function validateConfig(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Configuration file must be a JSON object.");
  }
  const version = data.version !== undefined ? data.version : (data.config && data.config.version);
  if (version === undefined || version === null || String(version).trim() === "") {
    throw new Error("Missing required 'version' field in configuration file.");
  }
  const c = (data.config && typeof data.config === "object") ? data.config : data;

  if (c.rows !== undefined) {
    const r = Number(c.rows);
    if (!Number.isInteger(r) || r < 2 || r > 16) throw new Error("Invalid rows value (must be integer between 2 and 16).");
  }
  if (c.cols !== undefined) {
    const col = Number(c.cols);
    if (!Number.isInteger(col) || col < 2 || col > 24) throw new Error("Invalid cols value (must be integer between 2 and 24).");
  }
  if (c.channel !== undefined) {
    const ch = String(c.channel).trim().toUpperCase();
    if (!["R", "G", "B", "GRAY", "AUTO"].includes(ch)) throw new Error(`Invalid channel '${c.channel}': must be R, G, B, GRAY or AUTO.`);
  }
  if (c.mode !== undefined) {
    const m = String(c.mode).trim().toUpperCase();
    if (!["PP", "PI"].includes(m)) throw new Error(`Invalid assay mode '${c.mode}': must be PP or PI.`);
  }
  if (c.cutoff !== undefined && c.cutoff !== null) {
    const co = Number(c.cutoff);
    if (!Number.isFinite(co)) throw new Error("Cutoff must be a number.");
    if (c.cutoff_low !== undefined && c.cutoff_low !== null && String(c.cutoff_low).trim() !== "") {
      const colow = Number(c.cutoff_low);
      if (!Number.isFinite(colow)) throw new Error("Lower cutoff must be a number.");
      if (colow >= co) throw new Error("The doubtful lower cutoff must be below the main cutoff.");
    }
  }
  const mod = c.model || c.cal_mode;
  if (mod !== undefined) {
    const mStr = String(mod).trim().toLowerCase();
    if (!["linear", "quadratic"].includes(mStr)) throw new Error(`Calibration model must be 'linear' or 'quadratic', got '${mod}'.`);
    if (mStr === "linear" && c.slope !== undefined) {
      const sl = Number(c.slope);
      if (!Number.isFinite(sl)) throw new Error("Calibration slope must be a number.");
      if (sl === 0) throw new Error("Calibration slope cannot be 0.");
    } else if (mStr === "quadratic") {
      const qa = Number(c.a !== undefined ? c.a : (c.cal_a !== undefined ? c.cal_a : 0));
      const qb = Number(c.b !== undefined ? c.b : (c.cal_b !== undefined ? c.cal_b : 1));
      if (!Number.isFinite(qa) || !Number.isFinite(qb)) throw new Error("Quadratic calibration coefficients must be numbers.");
      if (Math.abs(qa) < 1e-12 && Math.abs(qb) < 1e-12) throw new Error("Quadratic calibration coefficients 'a' and 'b' cannot both be 0.");
    }
  }
  if (c.corners !== undefined) {
    if (!Array.isArray(c.corners) || c.corners.length !== 4) throw new Error("Corners must be an array of 4 points.");
    c.corners.forEach((pt, i) => {
      if (!Array.isArray(pt) || pt.length !== 2 || !Number.isFinite(Number(pt[0])) || !Number.isFinite(Number(pt[1]))) {
        throw new Error(`Corner ${i} must be a valid [x, y] coordinate pair.`);
      }
    });
  }
  return c;
}

export function applyConfigToUI(c, dataName, version) {
  if (c.rows && $("rows")) $("rows").value = c.rows;
  if (c.cols && $("cols")) $("cols").value = c.cols;
  if (c.radius && $("radius")) {
    $("radius").value = c.radius;
    if ($("rv")) $("rv").textContent = (+c.radius).toFixed(2);
  }
  if (c.channel && $("channel")) $("channel").value = c.channel;
  if (c.flat_field !== undefined && $("chk-flat-field")) $("chk-flat-field").checked = Boolean(c.flat_field);
  if (c.linearize !== undefined && $("lin")) $("lin").checked = Boolean(c.linearize);
  if (c.dark_level !== undefined && $("dark")) $("dark").value = c.dark_level;
  if (c.pos !== undefined && $("pos")) $("pos").value = c.pos;
  if (c.neg !== undefined && $("neg")) $("neg").value = c.neg;
  if (c.blank !== undefined && $("blank")) $("blank").value = c.blank;
  if (c.mode && $("mode")) $("mode").value = c.mode;
  if (c.cutoff !== undefined && $("cutoff")) $("cutoff").value = c.cutoff;
  if (c.cutoff_low !== undefined && $("cutlow")) $("cutlow").value = c.cutoff_low || "";
  if (c.slope !== undefined && $("slope")) $("slope").value = c.slope;
  if (c.intercept !== undefined && $("icpt")) $("icpt").value = c.intercept;

  const calModel = (c.model || c.cal_mode || "linear").toLowerCase();
  if (calModel === "quadratic") {
    setCalibrationModel("quadratic");
    if (c.cal_a !== undefined && $("cal-a")) $("cal-a").value = c.cal_a;
    else if (c.a !== undefined && $("cal-a")) $("cal-a").value = c.a;
    if (c.cal_b !== undefined && $("cal-b")) $("cal-b").value = c.cal_b;
    else if (c.b !== undefined && $("cal-b")) $("cal-b").value = c.b;
    if (c.cal_c !== undefined && $("cal-c")) $("cal-c").value = c.cal_c;
    else if (c.c !== undefined && $("cal-c")) $("cal-c").value = c.c;
  } else {
    setCalibrationModel("linear");
  }

  if (c.blank_correction !== undefined && $("blank-correction")) {
    $("blank-correction").checked = Boolean(c.blank_correction);
  }
  if (c.corners && Array.isArray(c.corners) && c.corners.length === 4) {
    S.corners = c.corners;
  }
  if (c.assay && S.presets && S.presets[c.assay]) {
    selectAssay(c.assay);
  }
  if (S.img) {
    draw();
    refreshGrid();
    updateLiveReadout();
  }
  showToast(`Configuration loaded: ${dataName} (v${version || "2.0"})`, "success");
}

export function initConfigControls() {
  const btnSave = $("btn-save-cfg");
  if (btnSave) {
    btnSave.onclick = () => {
      const name = prompt("Name this configuration:", (S.selectedAssay || "PlateOD") + "_Config") || "PlateOD_Config";
      const c = cfg();
      c.version = "2.0";
      const payload = {
        app: "PlateOD",
        version: "2.0",
        name: name,
        saved_at: new Date().toISOString(),
        config: c
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.plateod.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast(`Configuration saved as ${a.download}`, "success");
    };
  }

  const btnLoad = $("btn-load-cfg");
  const cfgInput = $("cfg-file-input");
  if (btnLoad && cfgInput) {
    btnLoad.onclick = () => cfgInput.click();
    cfgInput.onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const data = JSON.parse(fr.result);
          const validated = validateConfig(data);
          applyConfigToUI(validated, data.name || f.name, data.version || "2.0");
        } catch (err) {
          showToast("Invalid configuration file: " + err.message, "error");
        }
        cfgInput.value = "";
      };
      fr.readAsText(f);
    };
  }
}
