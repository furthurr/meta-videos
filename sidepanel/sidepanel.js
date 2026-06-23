/**
 * sidepanel/sidepanel.js
 * Side panel unificado con dos pestañas:
 *   - Menú:   prompts + configuración + controles de la cola.
 *   - Monitor: cola en vivo + registro.
 *
 * El icono de la extension abre este side panel directamente.
 * La pestaña activa se persiste en chrome.storage.session.
 */
(function () {
  "use strict";

  const TAB_KEY = "activeTab";
  const DEFAULT_TAB = "menu";

  // Ultimo estado conocido (para decidir si pedir confirmacion al reiniciar).
  let lastState = null;

  // ----------------- helpers -----------------
  const $ = function (id) { return document.getElementById(id); };

  function storageGet(key, area) {
    return new Promise(function (resolve) {
      const a = area || chrome.storage.local;
      a.get(key, function (res) { resolve(res && res[key]); });
    });
  }
  function storageSet(obj, area) {
    return new Promise(function (resolve) {
      const a = area || chrome.storage.local;
      a.set(obj, function () { resolve(); });
    });
  }
  function send(type, payload) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), function (resp) {
          const err = chrome.runtime.lastError;
          if (err) return resolve({ ok: false, error: err.message });
          resolve(resp || { ok: false, error: "no response" });
        });
      } catch (e) { resolve({ ok: false, error: e.message }); }
    });
  }

  function clampInt(v, min, max, def) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  }

  // ----------------- elements -----------------
  const els = {
    subtitle: $("subtitle"),
    statePill: $("statePill"),
    tabs: document.querySelectorAll(".tab"),
    panels: {
      menu: document.querySelector('.tab-panel[data-tab="menu"]'),
      monitor: document.querySelector('.tab-panel[data-tab="monitor"]'),
    },

    // Menu
    prompts: $("prompts"),
    promptCount: $("promptCount"),
    loadFile: $("loadFile"),
    fileInput: $("fileInput"),
    toggleCfg: $("toggleCfg"),
    cfgPanel: $("cfgPanel"),
    cfgChevron: $("cfgChevron"),
    durationSec: $("durationSec"),
    resolution: $("resolution"),
    aspect: $("aspect"),
    videosPerPrompt: $("videosPerPrompt"),
    maxRetries: $("maxRetries"),
    delaySubmits: $("delaySubmits"),
    delayPrompts: $("delayPrompts"),
    downloadFolder: $("downloadFolder"),
    numberFiles: $("numberFiles"),
    saveCfg: $("saveCfg"),
    cfgStatus: $("cfgStatus"),
    statPrompts: $("statPrompts"),
    statVideos: $("statVideos"),
    progressBar: $("progressBar"),
    startBtn: $("startBtn"),
    pauseBtn: $("pauseBtn"),
    resumeBtn: $("resumeBtn"),
    stopBtn: $("stopBtn"),
    resetBtn: $("resetBtn"),
    openMetaBtn: $("openMetaBtn"),
    hint: $("hint"),

    // Monitor
    queueList: $("queueList"),
    logList: $("logList"),
  };

  // ----------------- tabs -----------------
  function switchTab(tabName) {
    if (!tabName) tabName = DEFAULT_TAB;
    els.tabs.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    Object.keys(els.panels).forEach(function (k) {
      els.panels[k].hidden = (k !== tabName);
    });
    storageSet({ [TAB_KEY]: tabName }, chrome.storage.session);
  }

  els.tabs.forEach(function (btn) {
    btn.addEventListener("click", function () { switchTab(btn.dataset.tab); });
  });

  // ----------------- config -----------------
  function readCfg() {
    return {
      durationSec: clampInt(els.durationSec.value, 1, 30, 5),
      resolution: els.resolution.value,
      aspect: els.aspect.value,
      videosPerPrompt: clampInt(els.videosPerPrompt.value, 1, 8, 4),
      maxRetries: clampInt(els.maxRetries.value, 0, 10, 5),
      delayBetweenSubmitsMs: clampInt(els.delaySubmits.value, 1000, 120000, 3000),
      delayBetweenPromptsMs: clampInt(els.delayPrompts.value, 1000, 300000, 15000),
      downloadFolder: (els.downloadFolder.value || "MetaVideos").trim(),
      numberFiles: !!els.numberFiles.checked,
    };
  }

  function writeCfg(cfg) {
    if (!cfg) return;
    if (cfg.durationSec != null) els.durationSec.value = String(cfg.durationSec);
    if (cfg.resolution) els.resolution.value = cfg.resolution;
    if (cfg.aspect) els.aspect.value = cfg.aspect;
    if (cfg.videosPerPrompt != null) els.videosPerPrompt.value = String(cfg.videosPerPrompt);
    if (cfg.maxRetries != null) els.maxRetries.value = String(cfg.maxRetries);
    if (cfg.delayBetweenSubmitsMs != null) els.delaySubmits.value = String(cfg.delayBetweenSubmitsMs);
    if (cfg.delayBetweenPromptsMs != null) els.delayPrompts.value = String(cfg.delayBetweenPromptsMs);
    if (cfg.downloadFolder != null) els.downloadFolder.value = cfg.downloadFolder;
    if (cfg.numberFiles != null) els.numberFiles.checked = !!cfg.numberFiles;
  }

  // ----------------- prompts -----------------
  function getPrompts() {
    // Usa lib/parser.js (mismo parser testeado). Fallback inline por si acaso.
    if (window.Parser && typeof window.Parser.parsePrompts === "function") {
      return window.Parser.parsePrompts(els.prompts.value || "");
    }
    return (els.prompts.value || "")
      .replace(/\r\n?/g, "\n")
      .split(/\n+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  function updatePromptCount() {
    const n = getPrompts().length;
    els.promptCount.textContent = n + (n === 1 ? " prompt" : " prompts");
  }

  // ----------------- state rendering -----------------
  function setRunningUI(state) {
    if (!state) return;
    const running = !!state.running;
    const paused = !!state.paused;
    els.startBtn.hidden = running;
    els.pauseBtn.hidden = !running || paused;
    els.resumeBtn.hidden = !running || !paused;
    els.stopBtn.hidden = !running;
    els.prompts.disabled = running;

    // header pill
    let pillState = "idle";
    if (running) pillState = paused ? "paused" : "running";
    else if (state.prompts && state.prompts.length) pillState = "done";
    els.statePill.dataset.state = pillState;
    els.statePill.textContent =
      pillState === "running" ? "En curso" :
      pillState === "paused" ? "Pausado" :
      pillState === "done" ? "Finalizado" : "Inactivo";

    els.subtitle.textContent = running
      ? (paused ? "Pausado" : "Procesando cola…")
      : (state.prompts && state.prompts.length
          ? state.prompts.filter(function (p) { return p.status === "done"; }).length + "/" + state.prompts.length + " prompts completados"
          : "Listo");

    // menu progress
    const totalPrompts = state.prompts ? state.prompts.length : 0;
    const donePrompts = state.prompts ? state.prompts.filter(function (p) { return p.status === "done"; }).length : 0;
    const cfg = readCfg();
    const totalVideos = totalPrompts * cfg.videosPerPrompt;
    const doneVideos = state.prompts ? state.prompts.reduce(function (a, p) {
      return a + (p.runs ? p.runs.filter(function (r) { return r.downloaded; }).length : 0);
    }, 0) : 0;
    els.statPrompts.textContent = donePrompts + "/" + totalPrompts;
    els.statVideos.textContent = doneVideos + "/" + (totalVideos || 0);
    const pct = totalVideos ? (doneVideos / totalVideos) * 100 : 0;
    els.progressBar.style.width = Math.min(100, pct) + "%";
  }

  function renderQueue(state) {
    const list = els.queueList;
    list.innerHTML = "";
    if (!state.prompts || !state.prompts.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Sin prompts cargados.";
      list.appendChild(li);
      return;
    }
    state.prompts.forEach(function (p) {
      const li = document.createElement("li");
      li.className = "queue-item" + (p.status === "running" ? " active" : "");
      const head = document.createElement("div");
      head.className = "queue-head";
      const promptEl = document.createElement("div");
      promptEl.className = "queue-prompt";
      promptEl.textContent = p.prompt;
      const statusEl = document.createElement("div");
      statusEl.className = "queue-status";
      statusEl.dataset.status = p.status || "pending";
      statusEl.textContent = p.status || "pending";
      head.appendChild(promptEl);
      head.appendChild(statusEl);
      li.appendChild(head);

      const runs = document.createElement("div");
      runs.className = "runs";
      const total = (p.runs && p.runs.length) || 0;
      for (let i = 0; i < Math.max(total, 1); i++) {
        const r = p.runs ? p.runs[i] : null;
        const cell = document.createElement("div");
        cell.className = "run";
        if (r) {
          cell.dataset.status = r.status || "pending";
          cell.textContent = String(r.idx);
          if (r.status === "done") cell.title = "Descargado";
          else if (r.status === "failed") cell.title = "Fallido: " + (r.error || "");
          else if (r.status === "submitting") cell.title = "Enviando…";
          else if (r.status === "downloading") cell.title = "Descargando…";
          else if (r.status === "retrying") cell.title = "Reintentando…";
          else cell.title = "Estado: " + r.status;
        } else {
          cell.textContent = "·";
        }
        runs.appendChild(cell);
      }
      li.appendChild(runs);
      list.appendChild(li);
    });
  }

  function renderLog(state) {
    const list = els.logList;
    list.innerHTML = "";
    const log = (state.log || []).slice(-200);
    log.forEach(function (e) {
      const li = document.createElement("li");
      const ts = document.createElement("span");
      ts.className = "ts";
      ts.textContent = e.ts;
      const lvl = document.createElement("span");
      lvl.className = "lvl lvl-" + e.level;
      lvl.textContent = "[" + e.level.toUpperCase() + "]";
      const txt = document.createElement("span");
      txt.textContent = e.text;
      li.appendChild(ts);
      li.appendChild(lvl);
      li.appendChild(txt);
      list.appendChild(li);
    });
    list.scrollTop = list.scrollHeight;
  }

  function renderState(state) {
    if (!state) return;
    lastState = state;
    setRunningUI(state);
    renderQueue(state);
    renderLog(state);
  }

  function refreshState() {
    send("GET_STATE").then(function (s) { if (s) renderState(s); });
  }

  // ----------------- listeners -----------------
  els.prompts.addEventListener("input", updatePromptCount);

  els.loadFile.addEventListener("click", function () { els.fileInput.click(); });
  els.fileInput.addEventListener("change", function () {
    const f = els.fileInput.files && els.fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function () {
      els.prompts.value = String(reader.result || "");
      updatePromptCount();
    };
    reader.readAsText(f);
  });

  els.toggleCfg.addEventListener("click", function () {
    const open = !els.cfgPanel.hidden;
    els.cfgPanel.hidden = open;
    els.toggleCfg.setAttribute("aria-expanded", String(!open));
  });

  els.saveCfg.addEventListener("click", function () {
    const cfg = readCfg();
    send("SET_CFG", { cfg: cfg }).then(function (r) {
      if (r && r.ok) {
        els.cfgStatus.textContent = "Guardado ✓";
        setTimeout(function () { els.cfgStatus.textContent = ""; }, 1500);
      } else {
        els.cfgStatus.textContent = "Error";
      }
    });
  });

  els.startBtn.addEventListener("click", function () {
    const prompts = getPrompts();
    if (!prompts.length) {
      els.hint.innerHTML = "⚠️ Añade al menos un prompt.";
      return;
    }
    const cfg = readCfg();
    send("SET_CFG", { cfg: cfg });
    send("START", { prompts: prompts }).then(function (r) {
      if (r && r.ok) {
        els.hint.innerHTML = "▶️ En curso. Descargas en <b>Descargas/MetaVideos/&lt;slug&gt;/</b>.";
        switchTab("monitor");
      } else {
        els.hint.innerHTML = "❌ " + ((r && r.error) || "no se pudo iniciar");
      }
      refreshState();
    });
  });

  els.pauseBtn.addEventListener("click", function () { send("PAUSE").then(refreshState); });
  els.resumeBtn.addEventListener("click", function () { send("RESUME").then(refreshState); });
  els.stopBtn.addEventListener("click", function () { send("STOP").then(refreshState); });

  // Reiniciar: detiene cualquier proceso y vuelve al estado inicial
  // (cola/registro/progreso vacios + cuadro de prompts vacio). Conserva la
  // configuracion. Pide confirmacion si hay algo que perder.
  els.resetBtn.addEventListener("click", function () {
    const running = !!(lastState && lastState.running);
    const hasText = (els.prompts.value || "").trim().length > 0;
    if ((running || hasText) &&
        !window.confirm("Se detendrá cualquier proceso y se vaciará todo (prompts, cola y registro). ¿Reiniciar?")) {
      return;
    }
    els.resetBtn.disabled = true;
    send("RESET").then(function (r) {
      els.resetBtn.disabled = false;
      if (r && r.ok) {
        els.prompts.value = "";
        updatePromptCount();
        els.hint.innerHTML = "↺ Reiniciado. Listo para empezar de nuevo.";
        switchTab("menu");
      } else {
        els.hint.innerHTML = "❌ " + ((r && r.error) || "no se pudo reiniciar");
      }
      refreshState();
    });
  });

  // Abre (o enfoca) la pestaña de meta.ai.
  els.openMetaBtn.addEventListener("click", function () {
    els.openMetaBtn.disabled = true;
    send("OPEN_META_AI").then(function () {
      setTimeout(function () { els.openMetaBtn.disabled = false; }, 600);
    });
  });

  // Estado reactivo desde el background
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === "STATE") renderState(msg.state);
    });
  } catch (e) { /* ignore */ }

  setInterval(refreshState, 1500);

  // ----------------- init -----------------
  storageGet(TAB_KEY, chrome.storage.session).then(function (t) {
    switchTab(t || DEFAULT_TAB);
  });
  send("GET_CFG").then(writeCfg);
  refreshState();
  updatePromptCount();
})();
