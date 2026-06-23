/**
 * test/cdp/probe.mjs
 * Se conecta a un Chrome lanzado con --remote-debugging-port=9222,
 * localiza la pestaña de meta.ai y vuelca informacion del DOM real
 * (input, boton enviar, controles de video, estructura) para afinar
 * lib/selectors.js sin adivinar.
 *
 * NO envia prompts: solo lee. Guarda el resultado en test/cdp/dom-dump.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.CDP_PORT || "9222";

function descEl(el) {
  if (!el) return null;
  const attrs = {};
  for (const a of el.attributes || []) attrs[a.name] = a.value.slice(0, 120);
  return {
    tag: el.tagName,
    id: el.id || null,
    classes: (typeof el.className === "string" ? el.className : "").slice(0, 200),
    placeholder: el.getAttribute && el.getAttribute("placeholder"),
    ariaLabel: el.getAttribute && el.getAttribute("aria-label"),
    role: el.getAttribute && el.getAttribute("role"),
    type: el.getAttribute && el.getAttribute("type"),
    text: (el.textContent || "").trim().slice(0, 80),
    attrs,
  };
}

const probeFn = `(${function probe() {
  function desc(el) {
    if (!el) return null;
    const attrs = {};
    for (const a of el.attributes || []) attrs[a.name] = String(a.value).slice(0, 120);
    return {
      tag: el.tagName,
      id: el.id || null,
      classes: (typeof el.className === "string" ? el.className : "").slice(0, 200),
      placeholder: el.getAttribute && el.getAttribute("placeholder"),
      ariaLabel: el.getAttribute && el.getAttribute("aria-label"),
      role: el.getAttribute && el.getAttribute("role"),
      type: el.getAttribute && el.getAttribute("type"),
      text: (el.textContent || "").trim().slice(0, 80),
      attrs,
    };
  }
  function vis(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  const out = { url: location.href, title: document.title };

  // textareas y contenteditables (todas las variantes)
  out.textareas = Array.from(document.querySelectorAll("textarea")).map(desc);
  out.contenteditables = Array.from(document.querySelectorAll("[contenteditable]")).map(desc);
  out.textboxes = Array.from(document.querySelectorAll('[role="textbox"]')).map(desc);
  out.inputs = Array.from(document.querySelectorAll('input')).filter(vis).map(desc).slice(0, 20);

  // botones visibles con aria-label o texto corto
  out.buttons = Array.from(document.querySelectorAll("button,[role=button]"))
    .filter(vis)
    .map(desc)
    .filter((b) => b && (b.ariaLabel || (b.text && b.text.length <= 30)))
    .slice(0, 60);

  // videos
  out.videos = Array.from(document.querySelectorAll("video")).map((v) => ({
    src: v.currentSrc || v.src,
    readyState: v.readyState,
    duration: v.duration,
    w: v.getBoundingClientRect().width,
    h: v.getBoundingClientRect().height,
  }));

  // posibles selects/menus de configuracion (ratio, duracion, resolucion)
  out.selects = Array.from(document.querySelectorAll("select")).map(desc);
  out.menus = Array.from(document.querySelectorAll('[role="listbox"],[role="menu"],[role="radiogroup"]'))
    .filter(vis).map(desc).slice(0, 20);

  // texto que mencione ratio/segundos/resolucion (pistas de controles)
  const hints = [];
  const re = /(16:9|9:16|1:1|aspect|ratio|segundo|second|720|1080|resolu|duraci|duration)/i;
  Array.from(document.querySelectorAll("button,span,div,label,[role=option]"))
    .filter(vis)
    .forEach((el) => {
      const t = (el.textContent || "").trim();
      if (t && t.length <= 40 && re.test(t)) hints.push({ tag: el.tagName, text: t, ariaLabel: el.getAttribute("aria-label") });
    });
  out.controlHints = hints.slice(0, 40);

  // estructura: cuantos elementos, hay iframes?
  out.iframes = Array.from(document.querySelectorAll("iframe")).map((f) => f.src).slice(0, 10);

  return out;
}.toString()})()`;

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  } catch (e) {
    console.error("NO_CONNECT: no pude conectar a http://127.0.0.1:" + PORT);
    console.error("Lanza Chrome con: --remote-debugging-port=" + PORT + ' --user-data-dir="/tmp/meta-cdp"');
    console.error("Detalle:", e.message);
    process.exit(2);
  }

  const pages = browser.contexts().flatMap((c) => c.pages());
  const metaPages = [];
  for (const p of pages) {
    let url = "";
    try { url = p.url(); } catch (e) { /* */ }
    if (/meta\.ai/i.test(url)) metaPages.push(p);
  }

  console.log("Pestañas totales:", pages.length, "| meta.ai:", metaPages.length);
  pages.forEach((p) => console.log("  -", p.url().slice(0, 90)));

  if (!metaPages.length) {
    console.error("\nNo encontre ninguna pestaña de meta.ai. Abre https://meta.ai y el generador de video.");
    await browser.close();
    process.exit(3);
  }

  const page = metaPages[0];
  const dump = await page.evaluate(probeFn);
  const outPath = path.join(__dirname, "dom-dump.json");
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));
  console.log("\nDOM volcado en:", outPath);
  console.log("Resumen:");
  console.log("  textareas:", dump.textareas.length, "| contenteditables:", dump.contenteditables.length);
  console.log("  botones (filtrados):", dump.buttons.length, "| videos:", dump.videos.length);
  console.log("  selects:", dump.selects.length, "| menus:", dump.menus.length, "| controlHints:", dump.controlHints.length);

  await browser.close();
}

main();
