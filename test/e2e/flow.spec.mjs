/**
 * e2e/flow.spec.mjs
 * End-to-end con Playwright (Chromium) del flujo REAL (estilo extension de
 * referencia):
 *   - 1 submit por prompt -> meta.ai genera N videos
 *   - el content lee cada <video>.src y dispara DOWNLOAD_RESOURCE
 *   - el background descarga (chrome.downloads) + onDeterminingFilename
 * Se verifica contra el estado de la cola (prompt.downloadedCount).
 *
 * La extension MV3 se carga con chromium.launchPersistentContext + headful.
 */
import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "./fixtures/server.mjs";
import { buildTestExtension, cleanup } from "../helpers/build-ext.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let context, server, extDir, profileDir, downloadDir, extId, cdpPage;

const TEST_CFG = {
  durationSec: 5, resolution: "720p", aspect: "9:16",
  videosPerPrompt: 4, maxRetries: 3,
  delayBetweenSubmitsMs: 800, delayBetweenPromptsMs: 1000,
  downloadFolder: "MetaVideos", numberFiles: true,
  backoffBaseMs: 50, backoffCapMs: 200,
  configureVideo: false,   // el mock no tiene comboboxes
  forceVideoPrompt: false,
  generationTimeoutMs: 30000, stableMs: 800,
};

async function readState(page) {
  return page.evaluate(() => new Promise((res) => {
    chrome.storage.session.get("mvState", (r) => res(r && r.mvState));
  }));
}

async function waitPromptDone(page, idx, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await readState(page);
    const p = st && st.prompts && st.prompts[idx];
    if (p && (p.status === "done" || p.status === "error")) return st;
    await sleep(400);
  }
  return await readState(page);
}

async function startQueue(prompts, cfgOverride) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
  // Estado limpio al iniciar (evita interferencia entre tests).
  await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "RESET" }, () => resolve());
  }));
  await page.evaluate(async (data) => {
    await chrome.storage.local.set({
      cfg: data.cfg,
      __testMetaPatterns: ["http://127.0.0.1/*", "http://localhost/*"],
    });
  }, { cfg: cfgOverride });
  await page.evaluate((data) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "START", prompts: data.prompts }, (r) => resolve(r));
  }), { prompts });
  return page;
}

test.beforeAll(async () => {
  server = await startServer(0);
  extDir = buildTestExtension();
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-videos-profile-"));
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-videos-dl-"));

  // Las extensiones MV3 requieren Chromium headful (no headless shell).
  context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  // Obtener el service worker del background (puede existir ya o llegar luego).
  let [sw] = context.serviceWorkers();
  if (!sw || !sw.url().includes("background.js")) {
    sw = await context.waitForEvent("serviceworker", {
      predicate: (w) => w.url().includes("background.js"),
      timeout: 15000,
    });
  }
  extId = new URL(sw.url()).host;

  // Permitir descargas sin dialogo (la extension usa chrome.downloads.download).
  cdpPage = await context.newPage();
  const cdp = await context.newCDPSession(cdpPage);
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir,
  });
});

test.afterAll(async () => {
  if (context) await context.close();
  if (server) await server.close();
  if (extDir) cleanup(extDir);
  if (profileDir) cleanup(profileDir);
  if (downloadDir) cleanup(downloadDir);
});

test("service worker de la extension esta vivo", async () => {
  expect(extId && extId.length > 10).toBeTruthy();
});

test("side panel carga sin errores y cambia de pestana", async () => {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
  await expect(page.locator("#prompts")).toBeVisible();
  await page.locator('.tab[data-tab="monitor"]').click();
  await expect(page.locator('.tab-panel[data-tab="monitor"]')).toBeVisible();
  await page.locator('.tab[data-tab="menu"]').click();
  await expect(page.locator('.tab-panel[data-tab="menu"]')).toBeVisible();
  expect(errors, "sin errores: " + errors.join(" | ")).toEqual([]);
  await page.close();
});

test("1 prompt -> 4 videos descargados (1 submit, flujo referencia)", async () => {
  const meta = await context.newPage();
  await meta.goto(`${server.url}/?videos=4&gen=600&failTimes=0`);
  await meta.bringToFront();
  await sleep(400);

  const panel = await startQueue(["un gato astronauta volando sobre una ola"], { ...TEST_CFG, videosPerPrompt: 4 });
  const st = await waitPromptDone(panel, 0, 30000);
  const p = st.prompts[0];

  expect(p.status, "prompt completado").toBe("done");
  expect(p.downloadedCount, "4 videos descargados").toBe(4);

  await panel.close();
  await meta.close();
});

test("reintento: 1er submit falla, 2o genera y descarga", async () => {
  const meta = await context.newPage();
  await meta.goto(`${server.url}/?videos=4&gen=500&failTimes=1`);
  await meta.bringToFront();
  await sleep(400);

  const panel = await startQueue(["prompt que falla una vez"], { ...TEST_CFG, videosPerPrompt: 4, maxRetries: 3 });
  const st = await waitPromptDone(panel, 0, 30000);
  const p = st.prompts[0];

  expect(p.status, "completado tras reintento").toBe("done");
  expect(p.downloadedCount, "4 videos tras reintento").toBe(4);

  await panel.close();
  await meta.close();
});

test("descarte: si falla siempre, termina en error sin colgarse", async () => {
  const meta = await context.newPage();
  await meta.goto(`${server.url}/?videos=4&gen=400&failTimes=10`);
  await meta.bringToFront();
  await sleep(400);

  const panel = await startQueue(["prompt imposible"], { ...TEST_CFG, videosPerPrompt: 4, maxRetries: 2 });
  const st = await waitPromptDone(panel, 0, 30000);
  const p = st.prompts[0];

  expect(p.status, "queda en error").toBe("error");
  expect(p.downloadedCount, "0 descargados").toBe(0);
  expect(st.running, "cola detenida").toBe(false);

  await panel.close();
  await meta.close();
});

test("2 prompts en cola -> ambos descargan", async () => {
  const meta = await context.newPage();
  await meta.goto(`${server.url}/?videos=4&gen=400&failTimes=0`);
  await meta.bringToFront();
  await sleep(400);

  const panel = await startQueue(["primer prompt", "segundo prompt"], { ...TEST_CFG, videosPerPrompt: 4 });
  const st = await waitPromptDone(panel, 1, 40000);

  expect(st.prompts[0].status).toBe("done");
  expect(st.prompts[1].status).toBe("done");
  expect(st.prompts[0].downloadedCount).toBe(4);
  expect(st.prompts[1].downloadedCount).toBe(4);

  await panel.close();
  await meta.close();
});

test("RESET: detiene el proceso en curso y vuelve al estado inicial", async () => {
  const meta = await context.newPage();
  // gen alto: el video tarda ~2s, asi reseteamos con el proceso en marcha.
  await meta.goto(`${server.url}/?videos=4&gen=2000&failTimes=0`);
  await meta.bringToFront();
  await sleep(400);

  const panel = await startQueue(
    ["prompt largo para resetear a mitad"],
    { ...TEST_CFG, videosPerPrompt: 4, generationTimeoutMs: 30000 }
  );

  // Esperar a que el proceso este efectivamente corriendo.
  const t0 = Date.now();
  let running = false;
  while (Date.now() - t0 < 10000) {
    const st = await readState(panel);
    if (st && st.running === true && st.prompts && st.prompts.length === 1) { running = true; break; }
    await sleep(150);
  }
  expect(running, "el proceso esta corriendo antes del reset").toBe(true);

  // Enviar RESET mientras genera.
  const r = await panel.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "RESET" }, (resp) => resolve(resp));
  }));
  expect(r && r.ok, "RESET responde ok").toBeTruthy();

  // Esperar mas que la generacion (2s) para probar el guard anti-carrera:
  // si el loop en vuelo repoblara el estado, lo haria al resolver sendPrompt.
  await sleep(4000);

  const st = await readState(panel);
  expect(st.running, "no queda corriendo").toBe(false);
  expect(st.paused, "no queda pausado").toBe(false);
  expect(st.prompts.length, "cola vacia (estado inicial)").toBe(0);
  expect(st.log.length, "registro vacio").toBe(0);
  expect(st.currentPromptId, "sin prompt actual").toBe(null);

  // La configuracion (storage.local.cfg) se conserva intacta.
  const cfg = await panel.evaluate(() => new Promise((resolve) => {
    chrome.storage.local.get("cfg", (res) => resolve(res && res.cfg));
  }));
  expect(cfg && cfg.downloadFolder, "cfg conservada tras reset").toBe("MetaVideos");

  await panel.close();
  await meta.close();
});

test("RESET (boton UI): vacia el cuadro de prompts y el contador", async () => {
  const panel = await context.newPage();
  panel.on("dialog", (d) => d.accept()); // aceptar el confirm() de borrado
  await panel.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
  await expect(panel.locator("#prompts")).toBeVisible();

  // Escribir prompts y comprobar que el contador los cuenta.
  await panel.locator("#prompts").fill("uno\ndos\ntres");
  await expect(panel.locator("#promptCount")).toHaveText(/^3/);

  // Click en el boton Reiniciar real.
  await panel.locator("#resetBtn").click();

  // El textarea debe quedar vacio y el contador en "0 prompts".
  await expect(panel.locator("#prompts")).toHaveValue("");
  await expect(panel.locator("#promptCount")).toHaveText(/^0/);

  await panel.close();
});
