/**
 * test/cdp/probe-state.mjs
 * Estado actual: lista textareas/role=textbox/contenteditable con rect y visibilidad,
 * y el boton Enviar. Sin interaccion.
 */
import { chromium } from "@playwright/test";
const PORT = process.env.CDP_PORT || "9222";
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const pages = browser.contexts().flatMap((c) => c.pages());
const page = pages.find((p) => /meta\.ai/i.test(p.url()));
if (!page) { console.error("No hay pestaña meta.ai"); process.exit(3); }

const r = await page.evaluate(() => {
  function info(el) {
    const b = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      tag: el.tagName, role: el.getAttribute("role"),
      ph: el.getAttribute("placeholder"), dataph: el.getAttribute("data-placeholder"),
      ce: el.getAttribute("contenteditable"),
      w: Math.round(b.width), h: Math.round(b.height),
      disp: s.display, vis: s.visibility, op: s.opacity,
    };
  }
  return {
    url: location.href,
    textareas: Array.from(document.querySelectorAll("textarea")).map(info),
    textboxes: Array.from(document.querySelectorAll('[role="textbox"]')).map(info),
    editables: Array.from(document.querySelectorAll('[contenteditable="true"]')).map(info),
    sendBtn: (() => {
      const b = Array.from(document.querySelectorAll("button,[role=button]")).find((x) => /enviar|send/i.test(x.getAttribute("aria-label") || ""));
      if (!b) return null;
      const rr = b.getBoundingClientRect();
      return { aria: b.getAttribute("aria-label"), disabled: b.disabled, w: Math.round(rr.width), h: Math.round(rr.height) };
    })(),
  };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
