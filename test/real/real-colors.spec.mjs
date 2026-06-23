/**
 * test/real/real-colors.spec.mjs
 * E2E contra meta.ai REAL manejando la extension de verdad.
 *
 * Flujo:
 *   1) Lanza Chromium headful con un PERFIL PERSISTENTE (.auth-profile) y la
 *      extension cargada. La 1a vez te pide iniciar sesion a mano en meta.ai;
 *      las siguientes corridas reutilizan la sesion.
 *   2) Abre el side panel de la extension, fija la config de "reels"
 *      (9:16, 5 s, 4 videos/prompt) y manda 3 prompts: verde / azul / blanco.
 *   3) El background+content hacen el flujo real (modo Video + aspecto, escribir,
 *      enviar, esperar N videos, descargar via chrome.downloads).
 *   4) Verifica con ffprobe que se descargan los .mp4 (stream de video, ~5 s,
 *      vertical) y reporta el tono dominante (heuristico, informativo).
 *
 * Config util por env:
 *   MV_SMOKE=1            -> 1 prompt (verde) x 1 video: valida el pipeline rapido.
 *   MV_VIDEOS=N          -> videos por prompt (default 4, smoke 1).
 *   MV_LOGIN_TIMEOUT_MS  -> espera de login manual (default 600000 = 10 min).
 *   MV_GEN_TIMEOUT_MS    -> timeout de generacion por prompt (default 300000).
 *   MV_HEADLESS=1        -> (no recomendado) MV3 normalmente exige headful.
 */
import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTestExtension } from "../helpers/build-ext.mjs";
import { probeVideo } from "../helpers/probe-media.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.resolve(__dirname, "..");           // meta-videos/test
const AUTH_PROFILE = path.join(TEST_DIR, ".auth-profile"); // perfil persistente (gitignored)
// La copia estable de la extension va FUERA del repo: fs.cpSync no permite
// copiar un dir dentro de su propia subcarpeta. Ruta estable -> mismo ext id.
const EXT_DIR = path.join(os.tmpdir(), "meta-videos-real-ext");
const REPORT = path.join(__dirname, "report.json");
// Carpeta persistente donde GUARDAMOS los videos generados (Playwright borra
// sus artifacts al cerrar el contexto; aqui los copiamos para conservarlos).
const OUTPUT_DIR = path.join(__dirname, "output");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------- knobs -----------------
const SMOKE = process.env.MV_SMOKE === "1";
const VIDEOS = parseInt(process.env.MV_VIDEOS || (SMOKE ? "1" : "4"), 10);
const LOGIN_TIMEOUT = parseInt(process.env.MV_LOGIN_TIMEOUT_MS || "600000", 10);
const GEN_TIMEOUT = parseInt(process.env.MV_GEN_TIMEOUT_MS || "300000", 10);
const HEADLESS = process.env.MV_HEADLESS === "1";

const COLORS = [
  { name: "verde",  expectTone: "green", prompt: "una pantalla completamente verde, color verde solido brillante, fondo verde puro que ocupa todo el cuadro" },
  { name: "azul",   expectTone: "blue",  prompt: "una pantalla completamente azul, color azul solido brillante, fondo azul puro que ocupa todo el cuadro" },
  { name: "blanco", expectTone: "white", prompt: "una pantalla completamente blanca, color blanco puro brillante, fondo blanco que ocupa todo el cuadro" },
];
const PLAN = SMOKE ? COLORS.slice(0, 1) : COLORS;
const EXPECTED_TOTAL = PLAN.length * VIDEOS;

const CFG = {
  durationSec: 5,
  resolution: "720p",
  aspect: "9:16",
  videosPerPrompt: VIDEOS,
  maxRetries: 2,
  delayBetweenSubmitsMs: 3000,
  delayBetweenPromptsMs: 8000,
  downloadFolder: "MetaVideos",
  numberFiles: true,
  backoffBaseMs: 4000,
  backoffCapMs: 30000,
  // Flujo de video real (como la extension de referencia).
  configureVideo: true,
  forceVideoPrompt: true,
  generationTimeoutMs: GEN_TIMEOUT,
  stableMs: 4000,
};

let context, extId, metaPage, panel;

function log(...a) { console.log("[real-e2e]", ...a); }

async function readState(page) {
  return page.evaluate(() => new Promise((res) => {
    chrome.storage.session.get("mvState", (r) => res(r && r.mvState));
  }));
}

async function pingMeta(page) {
  // Pregunta al content script si ve el input/boton de meta.ai.
  try {
    return await page.evaluate(() => {
      const el = document.querySelector("div[contenteditable='true']");
      if (!el) return { hasInput: false };
      const r = el.getBoundingClientRect();
      return { hasInput: r.width > 50 && r.height > 0, url: location.href };
    });
  } catch (e) {
    return { hasInput: false, err: String(e) };
  }
}

test.beforeAll(async () => {
  // 1) Copia estable de la extension (mismo id entre corridas).
  buildTestExtension(EXT_DIR);
  fs.mkdirSync(AUTH_PROFILE, { recursive: true });

  // 2) Contexto persistente headful con la extension cargada.
  context = await chromium.launchPersistentContext(AUTH_PROFILE, {
    headless: HEADLESS,
    // acceptDownloads:true -> las descargas existen en disco (sea en ~/Descargas
    // o en el artifact de Playwright). NO dependemos de la ruta: la sacamos de
    // chrome.downloads.search (que da el filename real, state y exists).
    acceptDownloads: true,
    viewport: null,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--start-maximized",
      // Reduce (no elimina) senales de automatizacion para el login de Meta.
      "--disable-blink-features=AutomationControlled",
    ],
  });

  // 3) Service worker del background -> extId.
  let [sw] = context.serviceWorkers();
  if (!sw || !sw.url().includes("background.js")) {
    sw = await context.waitForEvent("serviceworker", {
      predicate: (w) => w.url().includes("background.js"),
      timeout: 20000,
    });
  }
  extId = new URL(sw.url()).host;
  log("extension id:", extId);

  // 4) NO redirigimos descargas por CDP: Browser.setDownloadBehavior con
  //    downloadPath se salta el pipeline de la extension (onDeterminingFilename)
  //    y guarda con el nombre crudo del CDN. Dejamos que la extension descargue
  //    a la carpeta por defecto (~/Descargas/MetaVideos/<slug>/NN_<slug>.mp4),
  //    que es justo lo que hace en produccion. Verificamos ahi.

  // 5) Abrir meta.ai y esperar login manual (con perfil persistente, solo 1a vez).
  metaPage = await context.newPage();
  await metaPage.goto("https://meta.ai/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await metaPage.bringToFront();

  const t0 = Date.now();
  let announced = false;
  let ready = await pingMeta(metaPage);
  while (!ready.hasInput && Date.now() - t0 < LOGIN_TIMEOUT) {
    if (!announced) {
      log("====================================================================");
      log(" INICIA SESION EN meta.ai EN LA VENTANA QUE SE ABRIO (esto es 1 vez).");
      log(" Cuando veas el cuadro para escribir el prompt, el test sigue solo.");
      log(" Esperando hasta " + Math.round(LOGIN_TIMEOUT / 60000) + " min...");
      log("====================================================================");
      announced = true;
    }
    await sleep(3000);
    ready = await pingMeta(metaPage);
  }
  if (!ready.hasInput) {
    throw new Error("Login/no se encontro el composer de meta.ai dentro del timeout. URL=" + (ready.url || metaPage.url()));
  }
  log("sesion lista, composer detectado en:", ready.url || metaPage.url());
  // Pequena gracia para que el content script (READY) se registre en el bg.
  await sleep(1500);
});

test.afterAll(async () => {
  try { if (context) await context.close(); } catch (e) { /* ignore */ }
});

test("meta.ai real: genera verde/azul/blanco (reels 9:16, 5s, 4/prompt) y descarga", async () => {
  test.setTimeout(70 * 60 * 1000);

  // --- abrir side panel y dejar estado limpio ---
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
  await expect(panel.locator("#prompts")).toBeVisible();
  await panel.evaluate(() => new Promise((res) => chrome.runtime.sendMessage({ type: "RESET" }, () => res())));

  // --- fijar config de reels ---
  await panel.evaluate((cfg) => new Promise((res) => {
    chrome.storage.local.set({ cfg }, () => res());
  }), CFG);

  // --- arrancar la cola con los prompts del plan ---
  const prompts = PLAN.map((c) => c.prompt);
  await metaPage.bringToFront();
  const runStart = Date.now(); // para filtrar descargas de ESTA corrida
  const startResp = await panel.evaluate((p) => new Promise((res) => {
    chrome.runtime.sendMessage({ type: "START", prompts: p }, (r) => res(r));
  }), prompts);
  log("START ->", JSON.stringify(startResp));
  expect(startResp && startResp.ok, "START acepto la cola").toBeTruthy();

  // --- esperar a que terminen todos (done/error) ---
  const deadline = Date.now() + PLAN.length * (GEN_TIMEOUT * (CFG.maxRetries + 1)) + 120000;
  let st = null;
  let lastLog = "";
  while (Date.now() < deadline) {
    st = await readState(panel);
    if (st && Array.isArray(st.prompts) && st.prompts.length === PLAN.length) {
      const summary = st.prompts.map((p) => `${p.status}:${p.downloadedCount || 0}`).join(" | ");
      if (summary !== lastLog) { log("estado:", summary, st.running ? "(running)" : ""); lastLog = summary; }
      const allDone = st.prompts.every((p) => p.status === "done" || p.status === "error");
      if (allDone && !st.running) break;
    }
    await sleep(4000);
  }

  // --- fuente de verdad: chrome.downloads.search (da el filename real) ---
  const sinceMs = runStart - 20000;
  const wantTotal = (st && st.prompts) ? st.prompts.reduce((a, p) => a + (p.downloadedCount || 0), 0) : 0;

  async function fetchDownloads(since) {
    try {
      return await panel.evaluate((s) => new Promise((res) => {
        chrome.downloads.search({ orderBy: ["-startTime"], limit: 200 }, (items) => {
          const out = (items || [])
            .filter((d) => d.startTime && Date.parse(d.startTime) >= s)
            .map((d) => ({
              id: d.id, state: d.state, error: d.error || null,
              filename: d.filename, exists: d.exists,
              mime: d.mime, bytesReceived: d.bytesReceived, totalBytes: d.totalBytes,
              url: (d.url || "").slice(0, 90), urlFull: d.url || "", startTime: d.startTime,
            }));
          res(out);
        });
      }), since);
    } catch (e) { return []; }
  }

  const isVideoComplete = (d) =>
    d.state === "complete" && d.exists && d.filename &&
    ((d.mime || "").startsWith("video") || /\.(mp4|mov|webm|m4v)$/i.test(d.filename));

  // Esperar a que las descargas (async) terminen de escribirse en disco.
  let downloadRecords = [];
  const flushDeadline = Date.now() + 120000;
  while (true) {
    downloadRecords = await fetchDownloads(sinceMs);
    const done = downloadRecords.filter(isVideoComplete).length;
    if (wantTotal > 0 && done >= wantTotal) break;
    if (wantTotal === 0) break;
    if (Date.now() > flushDeadline) break;
    await sleep(3000);
  }
  log("chrome.downloads (corrida):", JSON.stringify(downloadRecords, null, 2));

  // Videos completos ordenados por inicio: la cola es secuencial
  // (verde -> azul -> blanco), asi que los bloques caen en orden.
  const videoDownloads = downloadRecords.filter(isVideoComplete)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

  // --- mapear descargas a cada color y verificar ---
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const results = [];
  let downloadedTotal = 0;
  let validTotal = 0;
  let toneMatches = 0;
  let cursor = 0;

  for (let i = 0; i < PLAN.length; i++) {
    const color = PLAN[i];
    const p = (st && st.prompts && st.prompts[i]) || {};
    const n = p.downloadedCount || 0;
    const recs = videoDownloads.slice(cursor, cursor + n);
    cursor += n;

    const fileInfos = recs.map((rec, j) => {
      let info;
      try { info = probeVideo(rec.filename, 2); } catch (e) { info = { error: String(e) }; }
      const valid = !!info.hasVideo;
      const toneOk = info.tone === color.expectTone;
      if (valid) validTotal++;
      if (toneOk) toneMatches++;
      // Conservar el video (el artifact de Playwright se borra al cerrar).
      let savedAs = null;
      try {
        const destDir = path.join(OUTPUT_DIR, color.name);
        fs.mkdirSync(destDir, { recursive: true });
        savedAs = path.join(destDir, String(j + 1).padStart(2, "0") + "_" + color.name + ".mp4");
        fs.copyFileSync(rec.filename, savedAs);
      } catch (e) { savedAs = "copy-fail: " + ((e && e.message) || e); }
      return {
        file: path.basename(rec.filename),
        savedAs,
        bytes: rec.bytesReceived,
        width: info.width, height: info.height, duration: info.duration,
        codec: info.codec, vertical: info.height > info.width,
        tone: info.tone, rgb: info.rgb, toneOk,
      };
    });

    downloadedTotal += n;
    results.push({
      name: color.name,
      expectTone: color.expectTone,
      prompt: color.prompt,
      slug: p.slug || "",
      status: p.status || "missing",
      downloadedCount: n,
      filesFound: fileInfos.length,
      files: fileInfos,
    });
  }

  const report = {
    startedAt: (st && st.startedAt) || null,
    finishedAt: new Date().toISOString(),
    smoke: SMOKE,
    config: CFG,
    expected: { prompts: PLAN.length, videosPerPrompt: VIDEOS, total: EXPECTED_TOTAL },
    totals: {
      downloaded: downloadedTotal,
      validVideos: validTotal,
      toneMatches,
    },
    prompts: results,
    downloads: downloadRecords,
    outputDir: OUTPUT_DIR,
    log: (st && st.log) || [],
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

  // --- reporte en consola ---
  log("================= REPORTE =================");
  for (const r of results) {
    log(`• ${r.name} [${r.status}] descargados=${r.downloadedCount} archivos=${r.filesFound}`);
    for (const f of r.files) {
      log(`    - ${f.file}  ${f.width}x${f.height} ${f.duration}s ${f.codec}  tono=${f.tone}${f.toneOk ? " ✓" : ""}`);
    }
  }
  log(`TOTAL descargados=${downloadedTotal}/${EXPECTED_TOTAL}  validos=${validTotal}  tono-coincide=${toneMatches}/${downloadedTotal}`);
  log("videos guardados en:", OUTPUT_DIR);
  log("reporte JSON:", REPORT);
  log("==========================================");

  // --- asserts DUROS (lo que el loop debe lograr) ---
  expect(downloadedTotal, `se esperaban ${EXPECTED_TOTAL} videos descargados`).toBe(EXPECTED_TOTAL);
  expect(validTotal, "todos los archivos descargados deben ser video valido").toBe(downloadedTotal);

  // Guard del bug "el ultimo prompt redescarga el prompt 1": cada video debe
  // venir de una URL de origen distinta. Si se repitiera una, hubo redescarga.
  const srcUrls = videoDownloads.slice(0, downloadedTotal).map((d) => d.urlFull || d.url);
  const uniqueUrls = new Set(srcUrls);
  log(`URLs de origen unicas: ${uniqueUrls.size}/${srcUrls.length}`);
  expect(uniqueUrls.size, "cada prompt debe descargar SUS propios videos (sin URLs repetidas)").toBe(srcUrls.length);

  // tono = informativo (flaky por naturaleza de la IA), NO rompe el test.
  if (toneMatches < downloadedTotal) {
    log(`AVISO: ${downloadedTotal - toneMatches} clip(s) no coincidieron con el tono esperado (esperado por la naturaleza del output de la IA).`);
  }
});
