/**
 * lib/selectors.js
 * Selectores centralizados para meta.ai.
 * Si meta.ai cambia su DOM, se reescriben SOLO las funciones de este archivo.
 *
 * Cada funcion devuelve:
 *   - Element | null
 *   - Element[] ([] si no hay coincidencias)
 *   - boolean
 *
 * Todas trabajan sobre `document` salvo que se indique lo contrario.
 */
(function (root) {
  "use strict";

  // ----------------- Helpers -----------------

  function $$(selector, scope) {
    scope = scope || document;
    try {
      return Array.prototype.slice.call(scope.querySelectorAll(selector));
    } catch (e) {
      return [];
    }
  }

  function text(el) {
    return (el && (el.textContent || el.innerText || "") || "").trim();
  }

  function hasClass(el, fragment) {
    if (!el || !el.className) return false;
    const cls = typeof el.className === "string" ? el.className : el.className.baseVal || "";
    return cls.toLowerCase().indexOf(fragment.toLowerCase()) !== -1;
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity || "1") === 0) return false;
    return true;
  }

  // ----------------- Input / envio -----------------

  /**
   * Devuelve el campo de escritura del prompt.
   * meta.ai usa un editor enriquecido: puede ser <textarea>, [role="textbox"]
   * o [contenteditable]. Probamos en orden de especificidad.
   */
  function findPromptInput() {
    // Pistas de placeholder/aria en varios idiomas.
    const HINTS = ["meta", "message", "mensaje", "ask", "pregunta", "prompt", "escribe", "habla", "ai"];

    function matchesHint(el) {
      const ph = (el.getAttribute("placeholder") || "").toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      for (let i = 0; i < HINTS.length; i++) {
        if (ph.indexOf(HINTS[i]) !== -1 || aria.indexOf(HINTS[i]) !== -1) return true;
      }
      return false;
    }

    // 1) textarea con pista
    const tas = $$("textarea");
    for (let i = 0; i < tas.length; i++) {
      if (matchesHint(tas[i]) && isVisible(tas[i])) return tas[i];
    }
    // 2) role=textbox con pista
    const tbs = $$('[role="textbox"]');
    for (let i = 0; i < tbs.length; i++) {
      if (matchesHint(tbs[i]) && isVisible(tbs[i])) return tbs[i];
    }
    // 3) contenteditable con pista
    const cesH = $$("[contenteditable]");
    for (let i = 0; i < cesH.length; i++) {
      const v = cesH[i].getAttribute("contenteditable");
      if (v === "false") continue;
      if (matchesHint(cesH[i]) && isVisible(cesH[i])) return cesH[i];
    }
    // 4) fallbacks por visibilidad: elegir el editable visible MAS GRANDE
    //    (meta.ai tiene <textarea> espejo a 0x0 + el editor real role=textbox).
    const candidates = [].concat(tas, tbs, cesH).filter(function (el) {
      if (el.getAttribute && el.getAttribute("contenteditable") === "false") return false;
      return isVisible(el);
    });
    if (candidates.length) {
      candidates.sort(function (a, b) {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return (rb.width * rb.height) - (ra.width * ra.height);
      });
      return candidates[0];
    }
    return null;
  }

  /**
   * Devuelve el boton "Enviar"/"Send" o equivalente.
   * Prioriza el data-testid usado por meta.ai (confirmado via config remoto de
   * la extension de referencia): composer-send-button / composer-animate-button.
   */
  function findSendButton() {
    const testIdSel = 'button[data-testid="composer-send-button"], button[data-testid="composer-animate-button"]';
    // 1) data-testid habilitado y visible (lo mas fiable)
    const byTestId = $$(testIdSel);
    for (let i = 0; i < byTestId.length; i++) {
      if (!byTestId[i].disabled && isVisible(byTestId[i])) return byTestId[i];
    }
    // 2) por aria-label (palabras de envio)
    const SEND_ARIA = ["send", "submit", "enviar", "mandar", "envoyer", "senden", "send message"];
    const SEND_TEXT = ["send", "enviar", "mandar"];
    const buttons = $$("button,[role='button']");
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i];
      if (b.disabled || !isVisible(b)) continue;
      const aria = (b.getAttribute("aria-label") || "").toLowerCase();
      if (!aria) continue;
      for (let k = 0; k < SEND_ARIA.length; k++) {
        if (aria.indexOf(SEND_ARIA[k]) !== -1) return b;
      }
    }
    // 3) por texto exacto
    for (let j = 0; j < buttons.length; j++) {
      const b = buttons[j];
      if (b.disabled || !isVisible(b)) continue;
      const txt = text(b).toLowerCase();
      for (let k = 0; k < SEND_TEXT.length; k++) {
        if (txt === SEND_TEXT[k]) return b;
      }
    }
    // 4) ultimo recurso: el boton data-testid aunque este deshabilitado
    //    (se habilita al escribir; NO usamos type=submit porque casi todos los
    //    <button> tienen type=submit por defecto).
    for (let i = 0; i < byTestId.length; i++) {
      if (isVisible(byTestId[i])) return byTestId[i];
    }
    return null;
  }

  // ----------------- Estado de generacion -----------------

  /**
   * ¿Hay un spinner/loader visible en el chat?
   * Detecta progressbar, skeletons, y el overlay "Imaginando"/"Generando"
   * que meta.ai muestra mientras crea un video.
   */
  function isGenerating() {
    const candidates = $$(
      '[role="progressbar"], [aria-busy="true"], [data-testid*="loading" i], [data-testid*="spinner" i]'
    );
    for (let i = 0; i < candidates.length; i++) {
      if (isVisible(candidates[i])) return true;
    }
    // El loader de meta.ai es un <canvas> dentro de la tarjeta media-item
    // (selector "loadingOutputElement" del config remoto de la referencia).
    const loadingCanvas = $$('div[class*="media-item"] canvas, [data-testid="ecto-sand-loader"] canvas');
    for (let i = 0; i < loadingCanvas.length; i++) {
      if (isVisible(loadingCanvas[i])) return true;
    }
    // overlay textual de meta.ai: "Imaginando" / "Generando" / "Imagining"
    const GEN_WORDS = ["imaginando", "generando", "imagining", "generating", "creando", "creating"];
    const small = $$("span, div, p");
    for (let i = 0; i < small.length; i++) {
      const el = small[i];
      if (!isVisible(el)) continue;
      const t = text(el).toLowerCase();
      if (!t || t.length > 24) continue;
      for (let w = 0; w < GEN_WORDS.length; w++) {
        if (t === GEN_WORDS[w]) return true;
      }
    }
    // heuristica: nodos con clase que contenga loading/spinner/skeleton
    const all = $$("*");
    for (let j = 0; j < all.length; j++) {
      const el = all[j];
      if (!isVisible(el)) continue;
      if (hasClass(el, "loading") || hasClass(el, "spinner") || hasClass(el, "skeleton")) {
        return true;
      }
    }
    return false;
  }

  /**
   * ¿El ultimo mensaje del asistente muestra un error?
   * Busca textos "try again", "something went wrong", "no se pudo", "intenta de nuevo".
   */
  function lastAssistantError() {
    const errorPhrases = [
      "try again",
      "something went wrong",
      "an error occurred",
      "intenta de nuevo",
      "no se pudo",
      "vuelve a intentarlo",
      "couldn't generate",
      "generation failed",
    ];
    // busca en todo el DOM (mensajes de error suelen ser toast/alert)
    const all = $$('[role="alert"], [aria-live="polite"], [aria-live="assertive"]');
    for (let i = 0; i < all.length; i++) {
      const t = text(all[i]).toLowerCase();
      if (!t) continue;
      for (let p = 0; p < errorPhrases.length; p++) {
        if (t.indexOf(errorPhrases[p]) !== -1) return errorPhrases[p];
      }
    }
    // fallback: cualquier nodo visible con ese texto
    const candidates = $$("p, span, div");
    for (let j = 0; j < candidates.length; j++) {
      const t = text(candidates[j]).toLowerCase();
      if (!t || t.length > 200) continue;
      for (let k = 0; k < errorPhrases.length; k++) {
        if (t.indexOf(errorPhrases[k]) !== -1) return errorPhrases[k];
      }
    }
    return null;
  }

  /**
   * Devuelve el ultimo <video> generado que cumpla readyState >= 2.
   * Si no hay ninguno, devuelve el ultimo <video> (puede estar cargando).
   */
  function findLatestVideo() {
    const vids = $$("video");
    if (!vids.length) return null;

    // Orden por orden de aparición en el DOM (el último = más reciente).
    for (let i = vids.length - 1; i >= 0; i--) {
      const v = vids[i];
      // Ignora previews / iconos muy pequeños.
      const r = v.getBoundingClientRect();
      if (r.width > 80 && r.height > 80 && v.readyState >= 2) {
        return v;
      }
    }
    // cualquier video visible > 80px
    for (let j = vids.length - 1; j >= 0; j--) {
      const r = vids[j].getBoundingClientRect();
      if (r.width > 80 && r.height > 80) return vids[j];
    }
    return vids[vids.length - 1];
  }

  /**
   * ¿Hay un video en el ultimo mensaje del asistente?
   */
  function hasReadyVideo() {
    const v = findLatestVideo();
    if (!v) return null;
    if (v.readyState < 2) return null;
    if (!Number.isFinite(v.duration) || v.duration <= 0) return null;
    return v;
  }

  // ----------------- Configuracion UI (opcional, para setear valores) -----------------

  /**
   * Intenta abrir/cerrar el panel de configuracion del video
   * (selector ratio, duracion, etc) si existe. Devuelve true si encontro algo clickable.
   */
  function openVideoSettingsIfAny() {
    // Buscar un boton que parezca "settings", "options", con icono de engranaje.
    const buttons = $$("button, [role='button']");
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i];
      if (!isVisible(b)) continue;
      const aria = (b.getAttribute("aria-label") || "").toLowerCase();
      const t = text(b).toLowerCase();
      if (
        aria.indexOf("setting") !== -1 ||
        aria.indexOf("option") !== -1 ||
        aria.indexOf("config") !== -1 ||
        t.indexOf("settings") !== -1 ||
        t.indexOf("options") !== -1
      ) {
        b.click();
        return true;
      }
    }
    return false;
  }

  /**
   * Intenta seleccionar un ratio / duracion en menus abiertos.
   * - ratioCandidates: ej ["16:9", "9:16", "1:1"]
   * - durationCandidates: ej ["5s", "5 seconds", "5"]
   * Si encuentra menu abierto y opciones coincidentes, hace click.
   */
  function pickFromOpenMenu(ratioCandidates, durationCandidates) {
    if (!ratioCandidates) ratioCandidates = [];
    if (!durationCandidates) durationCandidates = [];

    function findAndClick(cands) {
      const opts = $$('[role="option"], [role="menuitem"], button, li, div');
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i];
        if (!isVisible(o)) continue;
        const t = text(o).toLowerCase();
        if (!t) continue;
        for (let j = 0; j < cands.length; j++) {
          if (t === cands[j].toLowerCase() || t.indexOf(cands[j].toLowerCase()) !== -1) {
            o.click();
            return cands[j];
          }
        }
      }
      return null;
    }

    const r = findAndClick(ratioCandidates);
    const d = findAndClick(durationCandidates);
    return { ratio: r, duration: d };
  }

  // ----------------- meta.ai real (creación de imagen/video) -----------------
  // Confirmado en vivo (jun 2026): un prompt genera 4 resultados en tarjetas
  // div.group/media-item, cada una con <img> poster y un boton "Descargar"
  // que dispara una descarga blob:. No hay <video> en el DOM.

  /**
   * Tarjetas de resultado (cada video/imagen generado).
   */
  function findResultCards() {
    let cards = $$('[class*="media-item"]').filter(isVisible);
    if (cards.length) return cards;
    // fallback: contenedores que tienen un boton Descargar dentro
    const dl = findDownloadButtons();
    const set = [];
    for (let i = 0; i < dl.length; i++) {
      let c = dl[i];
      for (let k = 0; k < 6 && c.parentElement; k++) c = c.parentElement;
      if (set.indexOf(c) === -1) set.push(c);
    }
    return set;
  }

  /**
   * Botones "Descargar" / "Download" de cada resultado.
   */
  function findDownloadButtons() {
    const LABELS = ["descargar", "download", "télécharger", "herunterladen", "下载", "ダウンロード", "다운로드"];
    return $$('button,[role="button"]').filter(function (b) {
      if (!isVisible(b)) return false;
      const aria = (b.getAttribute("aria-label") || "").toLowerCase();
      const t = text(b).toLowerCase();
      for (let i = 0; i < LABELS.length; i++) {
        if (aria.indexOf(LABELS[i]) !== -1 || t === LABELS[i]) return true;
      }
      return false;
    });
  }

  /**
   * Boton "Creación"/"Creation" del composer: abre el popover con el modo
   * (Imagen/Vídeo) y el aspecto (16:9 / 9:16 / 1:1).
   */
  function findCreacionButton() {
    const LABELS = ["creación", "creacion", "creation", "création", "crear", "create"];
    const btns = $$('button,[role="button"]');
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      if (!isVisible(b)) continue;
      const t = text(b).toLowerCase();
      const aria = (b.getAttribute("aria-label") || "").toLowerCase();
      for (let k = 0; k < LABELS.length; k++) {
        if (t === LABELS[k] || t.indexOf(LABELS[k]) !== -1 || aria.indexOf(LABELS[k]) !== -1) {
          // evitar el item de sidebar "Crear" (suele ser <a>)
          if (b.tagName === "A") continue;
          return b;
        }
      }
    }
    return null;
  }

  /**
   * ¿Cuantos resultados listos hay? (numero de botones Descargar).
   */
  function countReadyResults() {
    return findDownloadButtons().length;
  }

  /**
   * Videos del contenedor de salida mas reciente.
   * Selector de la referencia: latestOutputContainer = div[data-message-item="true"]:last()
   * Fallbacks: tarjetas media-item, o todos los <video> visibles.
   */
  function findResultVideos() {
    // 1) Si hay contenedores de mensaje, limitarse SIEMPRE al ultimo (el de
    //    este prompt). Se devuelven sus <video> aunque sean 0 (todavia
    //    generando): NUNCA se mezcla con videos de prompts anteriores. Esto
    //    evita que el ultimo prompt de una cola "vea" como nuevos los videos
    //    viejos (p.ej. los del prompt 1) y los redescargue.
    const containers = $$('div[data-message-item="true"]');
    if (containers.length) {
      const last = containers[containers.length - 1];
      return Array.prototype.slice.call(last.querySelectorAll("video"));
    }
    // 2) Sin contenedores de mensaje: videos dentro de tarjetas media-item.
    const cardVids = $$('div[class*="media-item"] video');
    if (cardVids.length) return cardVids;
    // 3) cualquier <video> visible de tamaño razonable
    return $$("video").filter(function (v) {
      const r = v.getBoundingClientRect();
      return r.width > 80 && r.height > 80;
    });
  }

  // --- Configuracion de modo (Imagen/Video) y aspecto (combobox del composer) ---
  // Selectores de la referencia:
  //   modeButton          = div > button[role="combobox"]:eq(0)
  //   imageModeItem       = div[role="presentation"] > div[role=option]:eq(0)
  //   videoModeItem       = div[role="presentation"] > div[role=option]:eq(1)
  //   aspectRatioButton   = div > button[role="combobox"]:eq(1)
  //   aspectRatioTemplate = div[role="presentation"] > div[role=option]:has(span:contains("{ratio}"))

  function comboboxes() {
    return $$('button[role="combobox"]').filter(isVisible);
  }

  function findModeButton() {
    const cb = comboboxes();
    return cb.length ? cb[0] : null;
  }

  function findAspectButton() {
    const cb = comboboxes();
    return cb.length > 1 ? cb[1] : null;
  }

  function findModeOption(type) {
    // type: "image" -> primera opcion, "video" -> segunda
    const opts = $$('div[role="presentation"] [role="option"]').filter(isVisible);
    if (!opts.length) return null;
    if (type === "video") return opts.length > 1 ? opts[1] : opts[opts.length - 1];
    return opts[0];
  }

  function findAspectOption(aspect) {
    if (!aspect) return null;
    const opts = $$('div[role="presentation"] [role="option"]').filter(isVisible);
    for (let i = 0; i < opts.length; i++) {
      if (text(opts[i]).indexOf(aspect) !== -1) return opts[i];
    }
    return null;
  }

  // ----------------- API -----------------

  root.Selectors = {
    findPromptInput: findPromptInput,
    findSendButton: findSendButton,
    isGenerating: isGenerating,
    lastAssistantError: lastAssistantError,
    findLatestVideo: findLatestVideo,
    hasReadyVideo: hasReadyVideo,
    openVideoSettingsIfAny: openVideoSettingsIfAny,
    pickFromOpenMenu: pickFromOpenMenu,
    findResultCards: findResultCards,
    findDownloadButtons: findDownloadButtons,
    findCreacionButton: findCreacionButton,
    countReadyResults: countReadyResults,
    findResultVideos: findResultVideos,
    findModeButton: findModeButton,
    findModeOption: findModeOption,
    findAspectButton: findAspectButton,
    findAspectOption: findAspectOption,
    isVisible: isVisible,
    hasClass: hasClass,
  };
})(typeof self !== "undefined" ? self : globalThis);
