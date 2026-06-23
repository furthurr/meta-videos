/**
 * background.js
 * Service worker (MV3).
 *  - Mantiene la cola de jobs en chrome.storage.session.
 *  - Localiza la pestaña meta.ai activa y la instruye via content script.
 *  - Procesa DOWNLOAD (chrome.downloads).
 *  - Notifica al popup / side panel los cambios de estado.
 */

// Carga las libs compartidas (mismo codigo que usan content/side panel).
// importScripts funciona en service workers MV3 clasicos (no module).
try {
  importScripts("lib/slug.js", "lib/delay.js");
} catch (e) {
  console.error("[meta-videos] importScripts fallo:", e);
}

(function () {
  "use strict";

  const CFG_KEY = "cfg";
  const STATE_KEY = "mvState";

  // Libs cargadas via importScripts (con fallback defensivo).
  const Slug = self.Slug;
  const D = self.Delay;

  // ----------------- utils -----------------

  function nowIso() {
    return new Date().toISOString();
  }

  function ts() {
    const d = new Date();
    return d.toTimeString().slice(0, 8);
  }

  async function getCfg() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(CFG_KEY, function (res) {
        // Merge con defaults para que campos nuevos (backoff*, etc.) existan
        // aunque haya una cfg vieja guardada.
        const stored = res && res[CFG_KEY] ? res[CFG_KEY] : {};
        resolve(Object.assign(defaultCfg(), stored));
      });
    });
  }

  async function setCfg(cfg) {
    return new Promise(function (resolve) {
      const obj = {};
      obj[CFG_KEY] = cfg;
      chrome.storage.local.set(obj, function () { resolve(); });
    });
  }

  function defaultCfg() {
    return {
      durationSec: 5,
      resolution: "720p",
      aspect: "9:16",
      videosPerPrompt: 4,
      maxRetries: 5,
      delayBetweenSubmitsMs: 3000,
      delayBetweenPromptsMs: 15000,
      numberFiles: true,
      downloadFolder: "MetaVideos",
      // Backoff de reintentos (parametrizable para tests).
      backoffBaseMs: 5000,
      backoffCapMs: 60000,
      // Gracia para aceptar un video sin metadata (best-effort).
      metadataGraceMs: 5000,
      // Flujo de video real (como la extension de referencia):
      configureVideo: true,        // intentar seleccionar modo Video + aspecto
      forceVideoPrompt: true,      // prefijar "Crea un vídeo de" si el prompt no lo menciona
      generationTimeoutMs: 240000, // meta.ai tarda 1-3 min en video
      stableMs: 2500,              // esperar a que el nº de videos se estabilice
    };
  }

  async function getState() {
    return new Promise(function (resolve) {
      chrome.storage.session.get(STATE_KEY, function (res) {
        resolve(res && res[STATE_KEY] ? res[STATE_KEY] : newState());
      });
    });
  }

  async function setState(state) {
    return new Promise(function (resolve) {
      const obj = {};
      obj[STATE_KEY] = state;
      chrome.storage.session.set(obj, function () { resolve(); });
    });
  }

  function newState() {
    return {
      running: false,
      paused: false,
      stopRequested: false,
      currentPromptId: null,
      prompts: [],
      log: [],
      startedAt: null,
    };
  }

  function logAppend(state, level, text) {
    state.log.push({ ts: ts(), level: level, text: text });
    if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
  }

  function broadcast(state) {
    try {
      chrome.runtime.sendMessage({ type: "STATE", state: state }).catch(function () {});
    } catch (e) { /* popup cerrado, etc */ }
  }

  // ----------------- meta.ai tab -----------------

  // Tabs cuyo content script ya envio READY. Sirve como pista rapida.
  const readyTabs = new Set();

  // Patrones extra inyectables para tests (p.ej. http://127.0.0.1/* del mock).
  // Se leen de chrome.storage.local["__testMetaPatterns"].
  async function getExtraMetaPatterns() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get("__testMetaPatterns", function (res) {
          const p = res && res["__testMetaPatterns"];
          resolve(Array.isArray(p) ? p : []);
        });
      } catch (e) { resolve([]); }
    });
  }

  function metaUrlPatterns() {
    return [
      "https://meta.ai/*",
      "https://*.meta.ai/*",
    ];
  }

  async function findMetaAiTab() {
    const extra = await getExtraMetaPatterns();
    const patterns = metaUrlPatterns().concat(extra);
    return new Promise(function (resolve) {
      chrome.tabs.query({ url: patterns }, function (tabs) {
        if (chrome.runtime.lastError) return resolve(null);
        if (!tabs || !tabs.length) return resolve(null);
        // 1) Preferir un tab que ya mando READY
        for (let i = 0; i < tabs.length; i++) {
          if (readyTabs.has(tabs[i].id)) return resolve(tabs[i]);
        }
        // 2) Luego el activo
        for (let j = 0; j < tabs.length; j++) {
          if (tabs[j].active) return resolve(tabs[j]);
        }
        // 3) Si no, el primero
        resolve(tabs[0]);
      });
    });
  }

  async function findAnyMetaLikeTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({}, function (tabs) {
        if (chrome.runtime.lastError) return resolve(null);
        if (!tabs) return resolve(null);
        // Buscar pestañas cuya URL contenga "meta.ai" o "meta.com" (login, etc.)
        const matches = tabs.filter(function (t) {
          return t.url && /meta\.ai|meta\.com|facebook\.com/i.test(t.url);
        });
        resolve(matches);
      });
    });
  }

  async function pingTab(tabId) {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.sendMessage(tabId, { type: "PING" }, function (resp) {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(resp || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function injectContentScript(tabId) {
    return new Promise(function (resolve) {
      try {
        chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: false },
          files: [
            "lib/slug.js",
            "lib/delay.js",
            "lib/selectors.js",
            "lib/downloader.js",
            "content.js",
          ],
        }, function (results) {
          if (chrome.runtime.lastError) return resolve(false);
          resolve(Array.isArray(results) && results.length > 0);
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function sendPrompt(tabId, prompt, promptIndex, cfg) {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.sendMessage(
          tabId,
          { type: "SUBMIT_PROMPT", prompt: prompt, promptIndex: promptIndex, cfg: cfg },
          function (resp) {
            if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message, code: "NO_CONTENT" });
            resolve(resp || { ok: false, error: "no response", code: "EMPTY" });
          }
        );
      } catch (e) {
        resolve({ ok: false, error: e.message, code: "EXC" });
      }
    });
  }

  /**
   * Garantiza que tenemos una pestaña de meta.ai con el content script activo.
   * Estrategia:
   *   1) Buscar una pestaña que matchee las URLs declaradas.
   *   2) Hacer PING. Si falla, reintentar hasta 3 veces con 800ms de delay.
   *   3) Si sigue fallando, inyectar el content script manualmente.
   *   4) Reintentar el PING una vez mas.
   *   5) Si nada funciona, devolver un error descriptivo.
   */
  async function ensureMetaTabInteractive() {
    let tab = await findMetaAiTab();

    if (!tab) {
      // Buscar pestañas que parezcan de meta aunque no matcheen el pattern
      const likeTabs = await findAnyMetaLikeTab();
      if (likeTabs && likeTabs.length) {
        const urls = likeTabs.map(function (t) { return t.url; }).join(" | ");
        return {
          ok: false,
          error: "Hay " + likeTabs.length + " pestaña(s) tipo meta pero la URL no esta cubierta. Recarga esa pestaña (F5). URLs: " + urls,
        };
      }
      return {
        ok: false,
        error: "No hay pestaña de meta.ai abierta. Abre https://meta.ai/ e inicia sesion.",
      };
    }

    // 1) PING inicial
    let ping = await pingTab(tab.id);

    // 2) Reintentar hasta 3 veces con delay
    if (!ping) {
      for (let i = 0; i < 3; i++) {
        await D.sleep(800);
        ping = await pingTab(tab.id);
        if (ping) break;
      }
    }

    // 3) Si sigue fallando, inyectar el content script
    if (!ping) {
      const injected = await injectContentScript(tab.id);
      if (injected) {
        await D.sleep(600);
        ping = await pingTab(tab.id);
      }
    }

    // 4) Ultimo intento tras inyeccion
    if (!ping) {
      await D.sleep(600);
      ping = await pingTab(tab.id);
    }

    if (!ping || !ping.ok) {
      return {
        ok: false,
        error: "meta.ai no responde en " + (tab.url || "?") + ". Recarga la pestana (F5) y vuelvelo a intentar.",
      };
    }

    return { ok: true, tab: tab };
  }

  // ----------------- downloads -----------------
  //
  // Mismo proceso que la extension de referencia (Meta Automation):
  //  - Las descargas las dispara el background con chrome.downloads.download
  //    pasando { url, filename } (url puede ser fbcdn directo o data: URL).
  //  - Se mapea url -> ruta en `dlMap`.
  //  - Un listener onDeterminingFilename renombra las descargas que vienen de
  //    fbcdn (red de seguridad) usando el mapa o folder/prefijo.

  const dlMap = new Map();      // url -> ruta deseada
  let dlFolder = "";            // p.ej. "MetaVideos/"
  let dlPrefix = "";            // prefijo opcional
  let dlAuto = true;            // autoChangeFileName

  function onDeterminingFilename(item, suggest) {
    try {
      const isFb = (item.url || "").includes("fbcdn") || (item.finalUrl || "").includes("fbcdn");
      const mine = !item.byExtensionId || item.byExtensionId === chrome.runtime.id;
      if (!isFb || !mine) return; // no tocar descargas ajenas
      const name = item.filename || item.url || "";
      const isMedia = /\.(mp4|mov|webm|m4v|jpg|jpeg|png|gif|webp)$/i.test(name);
      if (!isMedia) return;
      if (!dlAuto) return;
      if (dlMap.has(item.url)) {
        suggest({ filename: dlMap.get(item.url), conflictAction: "uniquify" });
        dlMap.delete(item.url);
      } else {
        const base = (item.filename || "").split("/").pop() || item.filename;
        suggest({ filename: "" + dlFolder + dlPrefix + base, conflictAction: "uniquify" });
      }
    } catch (e) { /* dejar el nombre por defecto */ }
  }

  function enableFilenameRewrite(folder, prefix, auto) {
    dlFolder = folder ? (folder.replace(/\/+$/, "") + "/") : "";
    dlPrefix = prefix || "";
    dlAuto = auto !== false;
    if (dlAuto) {
      if (!chrome.downloads.onDeterminingFilename.hasListener(onDeterminingFilename)) {
        chrome.downloads.onDeterminingFilename.addListener(onDeterminingFilename);
      }
    } else if (chrome.downloads.onDeterminingFilename.hasListener(onDeterminingFilename)) {
      chrome.downloads.onDeterminingFilename.removeListener(onDeterminingFilename);
    }
  }

  function disableFilenameRewrite() {
    if (chrome.downloads.onDeterminingFilename.hasListener(onDeterminingFilename)) {
      chrome.downloads.onDeterminingFilename.removeListener(onDeterminingFilename);
    }
    dlMap.clear();
  }

  /**
   * Descarga un recurso (video) — igual que DOWNLOAD_RESOURCE de la referencia.
   *   msg: { url, filename, folder, autoChangeFileName }
   */
  async function handleDownload(msg, sender) {
    const url = msg.url;
    if (!url) return { ok: false, error: "missing url" };

    const auto = msg.autoChangeFileName !== false;
    const filename = msg.filename || "video.mp4";
    const folder = (msg.folder || "").trim();
    const path = auto ? (folder ? folder.replace(/\/+$/, "") + "/" + filename : filename) : null;

    if (auto && path) dlMap.set(url, path);

    return new Promise(function (resolve) {
      try {
        const opts = auto
          ? { url: url, filename: path, conflictAction: "uniquify", saveAs: false }
          : { url: url, conflictAction: "uniquify", saveAs: false };
        chrome.downloads.download(opts, function (downloadId) {
          if (chrome.runtime.lastError) {
            return resolve({ ok: false, error: chrome.runtime.lastError.message });
          }
          resolve({ ok: true, id: downloadId, runId: msg.runId || "" });
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }

  // ----------------- job loop -----------------

  // Guard de re-entrancy: solo un loop de cola a la vez.
  let processing = false;

  // Persiste el estado preservando los flags de control (paused/stopRequested)
  // que el usuario pudo cambiar durante un await.
  async function saveState(state) {
    const fresh = await getState();
    state.paused = fresh.paused;
    state.stopRequested = fresh.stopRequested;
    await setState(state);
  }

  async function processQueue() {
    if (processing) return;
    processing = true;
    try {
      await runLoop();
    } catch (e) {
      console.error("[meta-videos] runLoop error", e);
    } finally {
      processing = false;
    }
  }

  async function runLoop() {
    let state = await getState();
    if (!state.running) return;
    if (state.stopRequested) {
      state.running = false;
      state.stopRequested = false;
      logAppend(state, "info", "Detenido por el usuario.");
      await setState(state);
      broadcast(state);
      return;
    }
    if (state.paused) return;

    const cfg = await getCfg();

    // Loop principal sobre la cola.
    while (true) {
      state = await getState();
      if (!state.running) return;
      if (state.stopRequested) {
        state.running = false;
        state.stopRequested = false;
        logAppend(state, "info", "Detenido por el usuario.");
        await setState(state);
        broadcast(state);
        return;
      }
      if (state.paused) return;

      // Elegir prompt: el que esta "running", si no el siguiente "pending".
      let prompt = state.prompts.find(function (p) { return p.status === "running"; });
      if (!prompt) prompt = state.prompts.find(function (p) { return p.status === "pending"; });

      if (!prompt) {
        state.running = false;
        logAppend(state, "info", "Cola finalizada. Videos descargados: " + countDownloaded(state) + ".");
        await setState(state);
        broadcast(state);
        disableFilenameRewrite();
        return;
      }

      if (prompt.status === "pending") {
        prompt.status = "running";
        prompt.runs = [];
        state.currentPromptId = prompt.id;
        logAppend(state, "info", "Iniciando prompt: " + prompt.prompt);
        await saveState(state);
        broadcast(state);
      }

      // Asegurar pestaña meta.ai interactiva.
      const tabRes = await ensureMetaTabInteractive();
      if (!tabRes.ok) {
        logAppend(state, "error", tabRes.error);
        prompt.status = "error";
        state.running = false;
        await setState(state);
        broadcast(state);
        return;
      }

      // Un submit por prompt: el content configura modo video, escribe, envia,
      // espera los N videos y los descarga (DOWNLOAD_RESOURCE). Reintenta si falla.
      let interrupted = false;
      let result = null;
      let attempts = 0;
      const promptIndex = state.prompts.indexOf(prompt) + 1;

      while (attempts < cfg.maxRetries + 1) {
        const ctrl = await getState();
        if (!ctrl.running || ctrl.stopRequested || ctrl.paused) { interrupted = true; break; }

        attempts += 1;
        logAppend(state, "info", "[" + promptIndex + "] Enviando" + (attempts > 1 ? " (reintento " + (attempts - 1) + ")" : "") + ": " + prompt.prompt);
        await saveState(state);
        broadcast(state);

        result = await sendPrompt(tabRes.tab.id, prompt.prompt, promptIndex, {
          videosPerPrompt: cfg.videosPerPrompt,
          aspect: cfg.aspect,
          downloadFolder: cfg.downloadFolder,
          numberFiles: cfg.numberFiles,
          configureVideo: cfg.configureVideo,
          forceVideoPrompt: cfg.forceVideoPrompt,
          timeoutMs: cfg.generationTimeoutMs || 240000,
          stableMs: cfg.stableMs || 2500,
        });

        if (result && result.ok && (result.downloaded || 0) > 0) break;

        logAppend(state, "error", "[" + promptIndex + "] Fallo: " + ((result && result.error) || "sin videos"));
        if (attempts <= cfg.maxRetries) {
          const waitMs = D.backoff(attempts, cfg.backoffBaseMs || 5000, cfg.backoffCapMs || 60000);
          await D.sleep(waitMs);
        }
      }

      if (interrupted) {
        continue; // el outer loop re-evalua stop/pause
      }

      // Si durante el envio (sendPrompt puede tardar minutos) el usuario detuvo
      // o reinicio, NO escribas resultados viejos sobre el estado ya limpio.
      const ctrlAfter = await getState();
      if (!ctrlAfter.running || ctrlAfter.stopRequested) {
        continue; // el outer loop re-evalua y sale
      }

      // Sintetizar runs para el panel (1 por video descargado).
      const downloaded = (result && result.downloaded) || 0;
      const total = (result && result.total) || downloaded;
      prompt.runs = [];
      for (let k = 0; k < total; k++) {
        prompt.runs.push({
          idx: k + 1,
          status: k < downloaded ? "done" : "failed",
          downloaded: k < downloaded,
          attempts: attempts,
          error: k < downloaded ? null : (result && result.error) || "no descargado",
        });
      }
      prompt.downloadedCount = downloaded;
      prompt.status = downloaded > 0 ? "done" : "error";

      logAppend(
        state,
        downloaded > 0 ? "ok" : "warn",
        "Prompt " + (downloaded > 0 ? "completo" : "sin videos") + ": " + prompt.prompt +
          " (" + downloaded + " video" + (downloaded === 1 ? "" : "s") + ")"
      );
      await saveState(state);
      broadcast(state);

      // Delay entre prompts si quedan pendientes.
      const morePending = state.prompts.some(function (p) { return p.status === "pending"; });
      if (morePending) {
        await D.sleep(cfg.delayBetweenPromptsMs);
      }
    }
  }

  function countDownloaded(state) {
    let c = 0;
    for (let i = 0; i < state.prompts.length; i++) {
      c += countPromptDownloaded(state.prompts[i]);
    }
    return c;
  }

  function countPromptDownloaded(p) {
    if (!p) return 0;
    if (typeof p.downloadedCount === "number") return p.downloadedCount;
    if (!p.runs) return 0;
    let c = 0;
    for (let i = 0; i < p.runs.length; i++) {
      if (p.runs[i].downloaded) c++;
    }
    return c;
  }

  function scheduleNext() {
    // pequeño tick para no encadenar tareas largas
    setTimeout(function () { processQueue().catch(function (e) { console.error("queue error", e); }); }, 250);
  }

  // ----------------- message API -----------------

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return false;

    // Mensaje desde el content script: "estoy listo".
    if (msg.type === "READY") {
      if (sender && sender.tab && typeof sender.tab.id === "number") {
        readyTabs.add(sender.tab.id);
      }
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "GET_STATE") {
      getState().then(function (s) { sendResponse(s); });
      return true;
    }

    if (msg.type === "GET_CFG") {
      getCfg().then(function (c) { sendResponse(c); });
      return true;
    }

    if (msg.type === "SET_CFG") {
      setCfg(msg.cfg || {}).then(function () {
        getCfg().then(function (c) { sendResponse({ ok: true, cfg: c }); });
      });
      return true;
    }

    if (msg.type === "START") {
      const prompts = (msg.prompts || []).filter(function (p) { return (p || "").trim().length > 0; });
      if (!prompts.length) {
        sendResponse({ ok: false, error: "no hay prompts" });
        return true;
      }
      getState().then(function (state) {
        state.running = true;
        state.paused = false;
        state.stopRequested = false;
        state.currentPromptId = null;
        state.log = [];
        state.startedAt = nowIso();
        state.prompts = prompts.map(function (p, i) {
          const s = Slug.slugify(p);
          return { id: "p" + (Date.now() + i), prompt: p, slug: s, status: "pending", runs: [] };
        });
        logAppend(state, "info", "Cola iniciada con " + prompts.length + " prompt(s).");
        return setState(state);
      }).then(function () {
        // Activar el rewrite de nombres (red de seguridad para descargas fbcdn).
        getCfg().then(function (cfg) {
          enableFilenameRewrite(cfg.downloadFolder, "", cfg.numberFiles !== false);
        });
        sendResponse({ ok: true });
        scheduleNext();
      });
      return true;
    }

    if (msg.type === "PAUSE") {
      getState().then(function (s) {
        s.paused = true;
        logAppend(s, "info", "Pausa solicitada.");
        return setState(s);
      }).then(function () { sendResponse({ ok: true }); });
      return true;
    }

    if (msg.type === "RESUME") {
      getState().then(function (s) {
        s.paused = false;
        logAppend(s, "info", "Reanudado.");
        return setState(s);
      }).then(function () {
        sendResponse({ ok: true });
        scheduleNext();
      });
      return true;
    }

    if (msg.type === "STOP") {
      getState().then(function (s) {
        s.stopRequested = true;
        s.paused = false;
        logAppend(s, "info", "Stop solicitado.");
        return setState(s);
      }).then(function () { disableFilenameRewrite(); sendResponse({ ok: true }); });
      return true;
    }

    if (msg.type === "RESET") {
      // Detiene cualquier proceso en vuelo y deja la extension en estado inicial
      // (cola/registro/progreso vacios). Conserva la cfg (storage.local) y los
      // prompts escritos en el textarea (viven en el DOM del side panel).
      getState().then(function (s) {
        // 1) Señal de parada: que un loop en vuelo no escriba estado viejo.
        s.stopRequested = true;
        s.running = false;
        s.paused = false;
        return setState(s);
      }).then(function () {
        // 2) Reemplaza por un estado nuevo y limpio.
        return setState(newState());
      }).then(function () {
        disableFilenameRewrite();
        return getState();
      }).then(function (fresh) {
        broadcast(fresh);
        sendResponse({ ok: true });
      });
      return true;
    }

    if (msg.type === "DOWNLOAD" || msg.type === "DOWNLOAD_RESOURCE") {
      handleDownload(msg, sender).then(function (r) { sendResponse(r); });
      return true;
    }

    if (msg.type === "OPEN_META_AI") {
      // Reutiliza una pestaña de meta.ai ya abierta (y enfoca su ventana);
      // si no hay ninguna, crea una nueva.
      findMetaAiTab().then(function (tab) {
        if (tab && typeof tab.id === "number") {
          chrome.tabs.update(tab.id, { active: true }, function () {
            if (typeof tab.windowId === "number") {
              chrome.windows.update(tab.windowId, { focused: true }, function () {});
            }
            sendResponse({ ok: true, tabId: tab.id, reused: true });
          });
          return;
        }
        chrome.tabs.create({ url: "https://meta.ai/" }, function (newTab) {
          sendResponse({ ok: true, tabId: newTab && newTab.id, reused: false });
        });
      });
      return true;
    }

    if (msg.type === "OPEN_SIDE_PANEL") {
      chrome.sidePanel.open({ windowId: sender.tab && sender.tab.windowId }).then(function () {
        sendResponse({ ok: true });
      }).catch(function (e) { sendResponse({ ok: false, error: e.message }); });
      return true;
    }

    return false;
  });

  // ----------------- tab lifecycle -----------------

  // Click en el icono -> abre el side panel (sin popup).
  chrome.action.onClicked.addListener(function (tab) {
    try {
      if (tab && typeof tab.id === "number") {
        chrome.sidePanel.open({ tabId: tab.id }).catch(function () {
          // Fallback: ventana actual
          chrome.windows.getCurrent(function (w) {
            if (w && typeof w.id === "number") {
              chrome.sidePanel.open({ windowId: w.id }).catch(function () {});
            }
          });
        });
      } else {
        chrome.windows.getCurrent(function (w) {
          if (w && typeof w.id === "number") {
            chrome.sidePanel.open({ windowId: w.id }).catch(function () {});
          }
        });
      }
    } catch (e) { /* ignore */ }
  });

  // Limpia readyTabs cuando se cierra una pestaña.
  chrome.tabs.onRemoved.addListener(function (tabId) {
    readyTabs.delete(tabId);
  });

  // Limpia readyTabs cuando una pestaña de meta.ai navega a otro sitio.
  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
    if (changeInfo && changeInfo.url && !/meta\.ai/i.test(changeInfo.url)) {
      readyTabs.delete(tabId);
    }
    // Si esta pestaña carga meta.ai y manda READY, vuelve a entrar al set.
  });

  // ----------------- boot -----------------

  // Si hay una cola corriendo y el SW arranca, continuar.
  setTimeout(function () {
    getState().then(function (s) {
      if (s.running && !s.paused && !s.stopRequested) {
        scheduleNext();
      }
    });
  }, 1000);
})();
