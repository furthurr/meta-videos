/**
 * test/lint/manifest-validate.mjs
 * Valida el manifest.json (MV3) de la extension:
 *   - manifest_version === 3
 *   - campos obligatorios presentes
 *   - todos los archivos referenciados existen en disco
 *
 * Sale con codigo !=0 si hay errores (para CI / run-all).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, "..", "..");
const manifestPath = path.join(EXT_ROOT, "manifest.json");

const errors = [];
const ok = [];

function fail(msg) { errors.push(msg); }
function pass(msg) { ok.push(msg); }

function fileExists(rel) {
  return fs.existsSync(path.join(EXT_ROOT, rel));
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  pass("manifest.json es JSON valido");
} catch (e) {
  fail("manifest.json no es JSON valido: " + e.message);
  report();
  process.exit(1);
}

// manifest_version
if (manifest.manifest_version !== 3) fail("manifest_version debe ser 3");
else pass("manifest_version = 3");

// campos basicos
for (const k of ["name", "version", "description"]) {
  if (!manifest[k]) fail("falta campo '" + k + "'");
  else pass("campo '" + k + "' presente");
}

// background service worker
if (!manifest.background || !manifest.background.service_worker) {
  fail("falta background.service_worker");
} else if (!fileExists(manifest.background.service_worker)) {
  fail("background.service_worker no existe: " + manifest.background.service_worker);
} else {
  pass("background.service_worker existe");
}

// side_panel
if (manifest.side_panel && manifest.side_panel.default_path) {
  if (!fileExists(manifest.side_panel.default_path)) {
    fail("side_panel.default_path no existe: " + manifest.side_panel.default_path);
  } else {
    pass("side_panel.default_path existe");
  }
}

// action default_popup (opcional)
if (manifest.action && manifest.action.default_popup) {
  if (!fileExists(manifest.action.default_popup)) {
    fail("action.default_popup no existe: " + manifest.action.default_popup);
  } else {
    pass("action.default_popup existe");
  }
}

// icons
if (manifest.icons) {
  for (const size of Object.keys(manifest.icons)) {
    if (!fileExists(manifest.icons[size])) fail("icono " + size + " no existe: " + manifest.icons[size]);
    else pass("icono " + size + " existe");
  }
}

// content_scripts
if (Array.isArray(manifest.content_scripts)) {
  manifest.content_scripts.forEach(function (cs, i) {
    (cs.js || []).forEach(function (j) {
      if (!fileExists(j)) fail("content_scripts[" + i + "].js no existe: " + j);
      else pass("content script existe: " + j);
    });
    (cs.css || []).forEach(function (c) {
      if (!fileExists(c)) fail("content_scripts[" + i + "].css no existe: " + c);
    });
  });
}

// permissions sanity
const requiredPerms = ["storage", "downloads", "scripting", "sidePanel"];
for (const p of requiredPerms) {
  if (!(manifest.permissions || []).includes(p)) {
    fail("falta permiso requerido: " + p);
  } else {
    pass("permiso presente: " + p);
  }
}

// host_permissions meta.ai
const hasMetaHost = (manifest.host_permissions || []).some(function (h) {
  return /meta\.ai/.test(h);
});
if (!hasMetaHost) fail("falta host_permission para meta.ai");
else pass("host_permission meta.ai presente");

report();
process.exit(errors.length ? 1 : 0);

function report() {
  console.log("── manifest-validate ──");
  for (const m of ok) console.log("  \u2713 " + m);
  for (const m of errors) console.log("  \u2717 " + m);
  console.log(
    errors.length
      ? `\nMANIFEST: ${errors.length} error(es)`
      : `\nMANIFEST: OK (${ok.length} checks)`
  );
}
