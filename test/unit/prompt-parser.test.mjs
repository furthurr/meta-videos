/**
 * test/unit/prompt-parser.test.mjs
 * Valida lib/parser.js (parsePrompts) — la regla de "lineas en blanco como separador".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGlobals } from "../helpers/load-global.mjs";

const { Parser } = loadGlobals(["lib/parser.js"]);
// El parser devuelve arrays creados dentro del vm (otro realm).
// Spread a un array del realm de test para que deepStrictEqual compare bien.
const P = (raw) => [...Parser.parsePrompts(raw)];

test("salto simple entre prompts", () => {
  assert.deepEqual(P("a\nb\nc"), ["a", "b", "c"]);
});

test("lineas en blanco como separador", () => {
  assert.deepEqual(P("a\n\nb\n\nc"), ["a", "b", "c"]);
});

test("multiples lineas en blanco", () => {
  assert.deepEqual(P("a\n\n\nb"), ["a", "b"]);
});

test("Windows line endings \\r\\n", () => {
  assert.deepEqual(P("a\r\nb\r\nc"), ["a", "b", "c"]);
});

test("lineas con solo espacios se descartan", () => {
  assert.deepEqual(P("a\n  \n  \nb"), ["a", "b"]);
});

test("trim de cada prompt", () => {
  assert.deepEqual(P("  a  \n\n  b  \n\n  c  "), ["a", "b", "c"]);
});

test("entrada vacia -> []", () => {
  assert.deepEqual(P(""), []);
  assert.deepEqual(P("\n\n\n"), []);
  assert.deepEqual(P("   "), []);
});

test("un solo prompt", () => {
  assert.deepEqual(P("single prompt only"), ["single prompt only"]);
});

test("ejemplo del usuario (4 prompts con lineas en blanco)", () => {
  const raw = "prompt1\n\nprompt2\n\nprompt3\n\nprompt4";
  assert.deepEqual(P(raw), ["prompt1", "prompt2", "prompt3", "prompt4"]);
});

test("no-string se coacciona", () => {
  assert.deepEqual(P(null), []);
  assert.deepEqual(P(undefined), []);
});
