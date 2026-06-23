/**
 * lib/parser.js
 * Parsea el textarea de prompts.
 * Cada prompt = bloque de texto entre saltos de linea (simples o multiples).
 * Soporta \n, \r\n, \r, lineas en blanco y espacios.
 */
(function (root) {
  "use strict";

  function parsePrompts(raw) {
    if (typeof raw !== "string") raw = String(raw || "");
    return raw
      .replace(/\r\n?/g, "\n")   // normalizar \r\n y \r -> \n
      .split(/\n+/)               // separar por una o mas newlines
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  root.Parser = { parsePrompts: parsePrompts };
})(typeof self !== "undefined" ? self : globalThis);
