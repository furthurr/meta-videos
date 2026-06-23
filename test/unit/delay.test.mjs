/**
 * test/unit/delay.test.mjs
 * Valida lib/delay.js (sleep, randomDelay, backoff, randInt).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGlobals } from "../helpers/load-global.mjs";

const { Delay } = loadGlobals(["lib/delay.js"]);

test("randInt: dentro de rango", () => {
  for (let i = 0; i < 200; i++) {
    const n = Delay.randInt(3, 7);
    assert.ok(n >= 3 && n <= 7, "n en [3,7]: " + n);
  }
});

test("backoff: crece con el intento y respeta el cap", () => {
  const base = 1000;
  const cap = 10000;
  const a0 = Delay.backoff(0, base, cap);
  const a1 = Delay.backoff(1, base, cap);
  const a5 = Delay.backoff(5, base, cap);
  // a0 ~ [700,1000], a1 ~ [1400,2000]
  assert.ok(a0 >= 700 && a0 <= 1000, "a0 rango: " + a0);
  assert.ok(a1 >= 1400 && a1 <= 2000, "a1 rango: " + a1);
  // con cap, no supera cap
  assert.ok(a5 <= cap, "a5 <= cap: " + a5);
});

test("backoff: base pequena para tests es rapida", () => {
  const ms = Delay.backoff(5, 50, 1000);
  assert.ok(ms <= 1000, "respeta cap pequeno");
});

test("sleep: resuelve aproximadamente en el tiempo dado", async () => {
  const t0 = Date.now();
  await Delay.sleep(60);
  const dt = Date.now() - t0;
  assert.ok(dt >= 40, "durmio al menos ~40ms: " + dt);
});

test("randomDelay: devuelve el ms real dentro de rango", async () => {
  const ms = await Delay.randomDelay(20, 40);
  assert.ok(ms >= 20 && ms <= 40, "ms en rango: " + ms);
});
