/**
 * test/helpers/load-global.mjs
 * Carga un archivo IIFE de la extension (que se adjunta a `self`/`window`)
 * dentro de un contexto vm con globals falsos, y devuelve ese contexto.
 *
 * Sirve para testear lib/slug.js, lib/delay.js, etc. sin refactorizarlos
 * a modulos.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, "..", "..");

/**
 * @param {string[]} relFiles  archivos relativos a la raiz de la extension
 * @param {object}   extraGlobals  globals adicionales para el sandbox
 * @returns {object} el objeto sandbox (con self/window y lo que los IIFE expongan)
 */
export function loadGlobals(relFiles, extraGlobals = {}) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Promise,
    Object,
    Array,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    ...extraGlobals,
  };
  // self y window apuntan al propio sandbox (como en un content script)
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);

  for (const rel of relFiles) {
    const code = fs.readFileSync(path.join(EXT_ROOT, rel), "utf8");
    vm.runInContext(code, context, { filename: rel });
  }
  return sandbox;
}

export { EXT_ROOT };
