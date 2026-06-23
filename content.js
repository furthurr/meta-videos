/**
 * content.js
 * Se ejecuta en https://meta.ai/*.
 *
 * Replica el proceso de la extension de referencia (Meta Automation):
 *   1) (opcional) configurar modo Video + aspecto en el composer.
 *   2) escribir el prompt en div[contenteditable='true'].
 *   3) click en button[data-testid="composer-send-button"].
 *   4) esperar a que el contenedor de salida deje de mostrar el canvas de
 *      carga y aparezcan <video> con src.
 *   5) por cada <video>: leer .src; si es blob: -> fetch -> readAsDataURL;
 *      enviar DOWNLOAD_RESOURCE al background (chrome.downloads).
 *
 * Mensajes:
 *   PING           -> { ok, url, hasInput, hasSend }
 *   SUBMIT_PROMPT  { prompt, promptIndex, cfg } -> { ok, downloaded, error?, code? }
 */
(function () {
  "use strict";

  if (window.__metaVideosLoaded) return;
  window.__metaVideosLoaded = true;

  const S = window.Selectors;
  const D = window.Delay;
  const SL = window.Slug;

  // ----------------- typing -----------------

  function setInputValue(el, value) {
    if (!el) return false;
    try {
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        const proto = el.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        // Editor Lexical (div[contenteditable]): verificado en vivo que
        // execCommand insertText inserta el texto y habilita "Enviar".
        el.focus();
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand("delete", false);
        } catch (e) { /* ignore */ }
        let ok = false;
        try { ok = document.execCommand("insertText", false, value); } catch (e) { ok = false; }
        if (!ok) el.textContent = value;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function clickEl(el) {
    if (!el) return false;
    try { el.click(); return true; } catch (e) { return false; }
  }

  function submitPrompt() {
    const btn = S.findSendButton();
    if (btn && clickEl(btn)) return true;
    const input = S.findPromptInput();
    if (!input) return false;
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
    return true;
  }

  // ----------------- configurar modo Video + aspecto (best-effort) -----------------

  async function configureVideoMode(cfg) {
    try {
      const modeBtn = S.findModeButton();
      if (modeBtn) {
        clickEl(modeBtn);
        await D.sleep(500);
        const videoItem = S.findModeOption("video");
        if (videoItem) { clickEl(videoItem); await D.sleep(400); }
      }
      // aspecto
      if (cfg && cfg.aspect) {
        const aspBtn = S.findAspectButton();
        if (aspBtn) {
          clickEl(aspBtn);
          await D.sleep(400);
          const opt = S.findAspectOption(cfg.aspect);
          if (opt) { clickEl(opt); await D.sleep(300); }
        }
      }
    } catch (e) { /* best-effort */ }
  }

  // ----------------- esperar resultados -----------------

  /**
   * Obtiene un identificador único para un video basado en su src.
   * Esto permite distinguir videos viejos de nuevos.
   */
  function getVideoId(v) {
    if (!v) return null;
    const src = v.currentSrc || v.src || "";
    // Para blob URLs, usar la URL completa como ID
    // Para otras URLs, usar la URL completa también
    return src || null;
  }

  /**
   * Obtiene los IDs de todos los videos actualmente visibles.
   */
  function getCurrentVideoIds() {
    // Snapshot GLOBAL de TODOS los <video> ya presentes en la pagina (de
    // prompts anteriores), no solo el ultimo contenedor. Asi, aunque un video
    // viejo asomara en la deteccion, queda marcado como "existente" y nunca se
    // confunde con uno nuevo (defensa extra para colas de 3+ prompts).
    const vids = Array.prototype.slice.call(document.querySelectorAll("video"));
    const ids = new Set();
    for (let i = 0; i < vids.length; i++) {
      const id = getVideoId(vids[i]);
      if (id) ids.add(id);
    }
    return ids;
  }

  /**
   * Espera a que el contenedor de salida tenga <video> con src y ya no muestre
   * el canvas de carga. Devuelve { ok, videos: [el], error?, code? }.
   * 
   * IMPORTANTE: existingVideoIds es un Set con los IDs de videos que ya existían
   * ANTES de enviar el prompt. Solo devolvemos videos NUEVOS.
   */
  async function waitForResults(cfg, existingVideoIds) {
    const timeoutMs = (cfg && cfg.timeoutMs) || 240000;   // video tarda 1-3 min
    const outputCount = (cfg && cfg.videosPerPrompt) || 4;
    const stableMs = (cfg && cfg.stableMs) || 2500;
    const started = Date.now();

    // Usar Set vacío si no se proporciona
    const oldIds = existingVideoIds || new Set();

    let sawGenerating = false;
    let stableSince = 0;
    let lastCount = 0;

    while (Date.now() - started < timeoutMs) {
      const err = S.lastAssistantError();
      if (err) {
        // Solo reportar error si ya vimos generación o pasó tiempo suficiente
        // y no hay videos nuevos
        const allVids = S.findResultVideos();
        const newVids = allVids.filter(function (v) {
          const id = getVideoId(v);
          return id && !oldIds.has(id);
        });
        if ((!newVids || !newVids.length) && (sawGenerating || Date.now() - started > 4000)) {
          return { ok: false, error: err, code: "ERROR_TEXT" };
        }
      }

      if (S.isGenerating()) {
        sawGenerating = true;
        stableSince = 0;
        await D.sleep(1200);
        continue;
      }

      // Filtrar solo videos NUEVOS (que no existían antes)
      const allVids = S.findResultVideos().filter(function (v) {
        const src = v && (v.currentSrc || v.src);
        return !!src;
      });
      
      const newVids = allVids.filter(function (v) {
        const id = getVideoId(v);
        return id && !oldIds.has(id);
      });

      if (newVids.length > 0) {
        // esperar a que el numero de videos NUEVOS se estabilice (todos generados)
        if (newVids.length !== lastCount) {
          lastCount = newVids.length;
          stableSince = Date.now();
        } else if (stableSince && Date.now() - stableSince >= stableMs) {
          const limited = newVids.slice(0, outputCount);
          return { ok: true, videos: limited };
        }
      }

      await D.sleep(1000);
    }
    // timeout: si hay algun video NUEVO, devolverlo igual
    const allVids = S.findResultVideos().filter(function (v) { return v && (v.currentSrc || v.src); });
    const newVids = allVids.filter(function (v) {
      const id = getVideoId(v);
      return id && !oldIds.has(id);
    });
    if (newVids.length) return { ok: true, videos: newVids.slice(0, outputCount) };
    return { ok: false, error: "timeout esperando resultados nuevos", code: "TIMEOUT" };
  }

  // ----------------- descarga (igual que la referencia) -----------------

  /**
   * Descarga todos los videos: lee src; si blob: -> dataURL; envia
   * DOWNLOAD_RESOURCE al background. Numera 01, 02, ...
   */
  async function downloadVideos(videos, prompt, promptIndex, cfg) {
    const slug = SL.slugify(prompt);
    const folderRoot = (cfg && cfg.downloadFolder) || "MetaVideos";
    const folder = folderRoot.replace(/\/+$/, "") + "/" + slug;
    const numberFiles = !(cfg && cfg.numberFiles === false);
    let downloaded = 0;
    const errors = [];

    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      let src = v && (v.currentSrc || v.src);
      if (!src) { errors.push("video " + (i + 1) + " sin src"); continue; }

      // blob: -> dataURL (como hace la referencia)
      if (/^blob:/i.test(src)) {
        try {
          const res = await fetch(src);
          const blob = await res.blob();
          src = await new Promise(function (resolve, reject) {
            const fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = reject;
            fr.readAsDataURL(blob);
          });
        } catch (e) {
          errors.push("blob fetch fallo en video " + (i + 1));
          continue;
        }
      }

      const idx = numberFiles ? SL.pad2(i + 1) : String(i + 1);
      const filename = idx + "_" + slug + ".mp4";

      const resp = await sendBg({
        type: "DOWNLOAD_RESOURCE",
        url: src,
        filename: filename,
        folder: folder,
        autoChangeFileName: true,
      });
      if (resp && resp.ok) downloaded++;
      else errors.push((resp && resp.error) || "download fallo en video " + (i + 1));

      await D.sleep(300);
    }

    return { downloaded: downloaded, total: videos.length, errors: errors };
  }

  function sendBg(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (resp) {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
          // normalizar: la referencia usa {success}, nosotros {ok}
          if (resp && typeof resp.success === "boolean") resp.ok = resp.success;
          resolve(resp || { ok: false, error: "no response" });
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }

  // ----------------- job -----------------

  async function runJob(prompt, promptIndex, cfg) {
    if (window.__metaVideosBusy) return { ok: false, error: "busy", code: "BUSY" };
    window.__metaVideosBusy = true;

    try {
      const input = S.findPromptInput();
      if (!input) return { ok: false, error: "no se encontro el input de meta.ai", code: "NO_INPUT" };

      // 1) modo video + aspecto (best-effort)
      if (cfg && cfg.configureVideo !== false) {
        await configureVideoMode(cfg);
      }

      // 2) escribir el prompt (con instruccion de video si no la tiene)
      let finalPrompt = prompt;
      if (cfg && cfg.forceVideoPrompt && !/v[ií]deo|video/i.test(prompt)) {
        finalPrompt = "Crea un vídeo de " + prompt;
      }
      setInputValue(S.findPromptInput(), finalPrompt);
      await D.sleep(500);

      // *** CAPTURAR IDs de videos EXISTENTES antes de enviar ***
      // Esto permite distinguir videos viejos de los nuevos que genere este prompt
      const existingVideoIds = getCurrentVideoIds();

      // 3) enviar
      if (!submitPrompt()) return { ok: false, error: "no se pudo enviar", code: "SEND_FAIL" };

      // 4) esperar resultados NUEVOS (pasamos los IDs existentes para filtrarlos)
      const res = await waitForResults(cfg, existingVideoIds);
      if (!res.ok) return { ok: false, error: res.error, code: res.code || "FAIL" };

      // 5) descargar solo los videos NUEVOS
      const dl = await downloadVideos(res.videos, prompt, promptIndex, cfg);
      return {
        ok: dl.downloaded > 0,
        downloaded: dl.downloaded,
        total: dl.total,
        errors: dl.errors,
        code: dl.downloaded > 0 ? "OK" : "DL_FAIL",
        error: dl.downloaded > 0 ? null : (dl.errors[0] || "no se descargo ningun video"),
      };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e), code: "EXC" };
    } finally {
      window.__metaVideosBusy = false;
    }
  }

  // ----------------- message bridge -----------------

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return false;

    if (msg.type === "PING") {
      sendResponse({
        ok: true,
        url: location.href,
        hasInput: !!S.findPromptInput(),
        hasSend: !!S.findSendButton(),
      });
      return true;
    }

    if (msg.type === "SUBMIT_PROMPT") {
      runJob(msg.prompt, msg.promptIndex || 1, msg.cfg || {}).then(function (r) {
        sendResponse(r);
      });
      return true;
    }

    return false;
  });

  try {
    chrome.runtime.sendMessage({ type: "READY", url: location.href }, function () {
      void chrome.runtime.lastError;
    });
  } catch (e) { /* ignore */ }
})();
