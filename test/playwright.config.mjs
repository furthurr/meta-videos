/**
 * playwright.config.mjs
 * Configuracion del runner E2E (solo Chromium, headful para cargar la extension).
 *
 * Notas:
 *  - Las extensiones MV3 SOLO cargan en Chromium headful (no headless shell),
 *    por eso el spec usa chromium.launchPersistentContext con headless:false.
 *  - workers:1 -> un unico contexto/SW compartido; los tests dependen de estado
 *    en chrome.storage.session, asi que no deben correr en paralelo.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [["list"]],
  use: {
    actionTimeout: 15000,
    navigationTimeout: 15000,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
