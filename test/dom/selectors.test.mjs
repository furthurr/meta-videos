/**
 * test/dom/selectors.test.mjs
 * Valida lib/selectors.js contra fixtures HTML tipo meta.ai usando jsdom.
 *
 * Notas jsdom:
 *  - getBoundingClientRect devuelve 0x0 por defecto -> lo sobreescribimos a
 *    un tamano visible para que isVisible() funcione.
 *  - readyState/duration de <video> no existen -> los definimos en el test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, "..", "..");
const selectorsCode = fs.readFileSync(path.join(EXT_ROOT, "lib", "selectors.js"), "utf8");

function loadFixture(name) {
  const html = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window;

  // Hacer que todo tenga tamano visible (jsdom no calcula layout).
  win.Element.prototype.getBoundingClientRect = function () {
    // Elementos marcados con data-small simulan miniaturas (<80px).
    const small = this.hasAttribute && this.hasAttribute("data-small");
    const s = small ? 40 : 200;
    return { width: s, height: s, top: 0, left: 0, right: s, bottom: s, x: 0, y: 0, toJSON() {} };
  };

  // Cargar selectors.js en el realm de jsdom.
  win.eval(selectorsCode);
  return { win, Selectors: win.Selectors, dom };
}

test("findPromptInput: encuentra el textarea de meta", () => {
  const { Selectors } = loadFixture("meta-chat.html");
  const input = Selectors.findPromptInput();
  assert.ok(input, "deberia encontrar input");
  assert.equal(input.tagName, "TEXTAREA");
});

test("findSendButton: encuentra el boton Send", () => {
  const { Selectors } = loadFixture("meta-chat.html");
  const btn = Selectors.findSendButton();
  assert.ok(btn, "deberia encontrar boton");
  assert.equal(btn.getAttribute("aria-label"), "Send");
});

test("isGenerating: true cuando hay spinner/progressbar", () => {
  const { Selectors } = loadFixture("meta-generating.html");
  assert.equal(Selectors.isGenerating(), true);
});

test("isGenerating: false en chat idle", () => {
  const { Selectors } = loadFixture("meta-chat.html");
  assert.equal(Selectors.isGenerating(), false);
});

test("lastAssistantError: detecta 'try again'", () => {
  const { Selectors } = loadFixture("meta-error.html");
  const err = Selectors.lastAssistantError();
  assert.ok(err, "deberia detectar error");
  assert.match(String(err), /try again/i);
});

test("lastAssistantError: null cuando no hay error", () => {
  const { Selectors } = loadFixture("meta-chat.html");
  assert.equal(Selectors.lastAssistantError(), null);
});

test("findLatestVideo + hasReadyVideo: video listo", () => {
  const { win, Selectors } = loadFixture("meta-video-ready.html");
  const video = win.document.getElementById("result-video");
  // Simular un video cargado.
  Object.defineProperty(video, "readyState", { value: 4, configurable: true });
  Object.defineProperty(video, "duration", { value: 5.0, configurable: true });
  Object.defineProperty(video, "currentSrc", { value: video.getAttribute("src"), configurable: true });

  const latest = Selectors.findLatestVideo();
  assert.ok(latest, "deberia encontrar el video");
  assert.equal(latest.id, "result-video");

  const ready = Selectors.hasReadyVideo();
  assert.ok(ready, "el video deberia estar listo");
  assert.equal(ready.duration, 5.0);
});

test("hasReadyVideo: null si el video aun no carga", () => {
  const { win, Selectors } = loadFixture("meta-video-ready.html");
  const video = win.document.getElementById("result-video");
  Object.defineProperty(video, "readyState", { value: 0, configurable: true });
  Object.defineProperty(video, "duration", { value: NaN, configurable: true });
  assert.equal(Selectors.hasReadyVideo(), null);
});

test("findPromptInput: ignora elementos ocultos (display:none)", () => {
  const { win, Selectors } = loadFixture("meta-chat.html");
  const ta = win.document.querySelector("textarea");
  ta.style.display = "none";
  // Al ocultar el unico textarea, no deberia devolverlo; como no hay otro,
  // findPromptInput devuelve null o un contenteditable (no hay) -> null.
  const input = Selectors.findPromptInput();
  assert.equal(input, null);
});

test("findResultVideos: con 3 prompts y el 3o generando, NO devuelve videos viejos", () => {
  // Regresion del bug: el ultimo prompt descargaba los videos del prompt 1.
  // Mientras el 3er contenedor se genera (solo canvas, sin <video>),
  // findResultVideos debe limitarse al ULTIMO contenedor (vacio), no caer al
  // fallback que junta TODOS los media-item video de la pagina.
  const { Selectors } = loadFixture("meta-multi-prompt.html");
  const vids = Selectors.findResultVideos();
  assert.equal(vids.length, 0, "no debe ver videos mientras el ultimo prompt genera");
});

test("findResultVideos: devuelve SOLO los videos del ultimo contenedor (no los previos)", () => {
  const { win, Selectors } = loadFixture("meta-multi-prompt.html");
  // El 3er prompt termina: se reemplaza el loader por 4 videos b=3.
  const p3 = win.document.getElementById("p3");
  p3.innerHTML =
    '<div class="results">' +
    '<div class="group/media-item media-item"><video src="vid.mp4?b=3&i=0"></video></div>' +
    '<div class="group/media-item media-item"><video src="vid.mp4?b=3&i=1"></video></div>' +
    '<div class="group/media-item media-item"><video src="vid.mp4?b=3&i=2"></video></div>' +
    '<div class="group/media-item media-item"><video src="vid.mp4?b=3&i=3"></video></div>' +
    "</div>";
  const vids = Selectors.findResultVideos();
  assert.equal(vids.length, 4, "exactamente los 4 del ultimo prompt");
  const srcs = vids.map((v) => v.getAttribute("src"));
  assert.ok(srcs.every((s) => /b=3/.test(s)), "todos del lote 3, ninguno viejo: " + srcs.join(","));
});

