/**
 * playwright.real.config.mjs
 * Runner E2E contra meta.ai REAL (no mock).
 *
 * Diferencias con playwright.config.mjs (mock):
 *  - testDir ./real  -> NO lo corre `npm test` / `test:flow` (que usan ./e2e).
 *  - timeout enorme   -> 12 generaciones reales pueden tardar 20-40 min, mas
 *    el login manual la primera vez.
 *  - workers 1, sin retries: un unico contexto persistente + estado en
 *    chrome.storage.session.
 *
 * Uso:
 *   npm run test:real            (3 prompts: verde/azul/blanco, 4 videos c/u)
 *   MV_SMOKE=1 npm run test:real (1 prompt, 1 video: valida el pipeline rapido)
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./real",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // 70 min: login manual (hasta 10) + generacion real (hasta ~40) + margen.
  timeout: 70 * 60 * 1000,
  expect: { timeout: 20000 },
  reporter: [["list"]],
  use: {
    actionTimeout: 30000,
    navigationTimeout: 60000,
    trace: "retain-on-failure",
  },
});
