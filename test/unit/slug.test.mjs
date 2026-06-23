/**
 * test/unit/slug.test.mjs
 * Valida lib/slug.js (slugify + pad2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGlobals } from "../helpers/load-global.mjs";

const { Slug } = loadGlobals(["lib/slug.js"]);

test("slugify: basico kebab-case", () => {
  assert.equal(Slug.slugify("Un gato volador"), "un-gato-volador");
});

test("slugify: quita acentos", () => {
  assert.equal(Slug.slugify("Águila niña corazón"), "aguila-nina-corazon");
});

test("slugify: colapsa espacios y guiones", () => {
  assert.equal(Slug.slugify("a   b---c"), "a-b-c");
});

test("slugify: reemplaza URLs por 'link'", () => {
  assert.equal(Slug.slugify("mira https://x.com/y ahora"), "mira-link-ahora");
});

test("slugify: recorta a maxLen sin guion final", () => {
  const long = "palabra ".repeat(20);
  const s = Slug.slugify(long, 40);
  assert.ok(s.length <= 40, "len <= 40");
  assert.ok(!s.endsWith("-"), "no termina en guion");
});

test("slugify: vacio -> 'video'", () => {
  assert.equal(Slug.slugify(""), "video");
  assert.equal(Slug.slugify("   "), "video");
  assert.equal(Slug.slugify("!!! ???"), "video");
});

test("slugify: maneja no-strings", () => {
  assert.equal(Slug.slugify(null), "video");
  assert.equal(Slug.slugify(undefined), "video");
});

test("pad2: rellena con cero", () => {
  assert.equal(Slug.pad2(1), "01");
  assert.equal(Slug.pad2(9), "09");
  assert.equal(Slug.pad2(10), "10");
  assert.equal(Slug.pad2(0), "00");
});
