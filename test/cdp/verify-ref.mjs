import { chromium } from "@playwright/test";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = b.contexts().flatMap((c) => c.pages());
const page = pages.find((p) => /meta\.ai/i.test(p.url()));
const r = await page.evaluate(() => {
  const q = (s) => document.querySelectorAll(s).length;
  function vidsInLatest() {
    const conts = document.querySelectorAll('div[data-message-item="true"]');
    if (!conts.length) return { containers: 0, videos: 0, srcs: [] };
    const last = conts[conts.length - 1];
    const vids = Array.from(last.querySelectorAll("video"));
    const loadingCanvas = last.querySelectorAll("div.group\\/media-item canvas").length;
    return { containers: conts.length, videos: vids.length, loadingCanvas, srcs: vids.map(v => (v.currentSrc||v.src||"").slice(0,60)) };
  }
  return {
    contentEditable: q("div[contenteditable='true']"),
    sendBtn: q('button[data-testid="composer-send-button"]'),
    animateBtn: q('button[data-testid="composer-animate-button"]'),
    modeCombobox: q('button[role="combobox"]'),
    messageItems: q('div[data-message-item="true"]'),
    mediaItems: q('div.group\\/media-item'),
    latest: vidsInLatest(),
  };
});
console.log(JSON.stringify(r, null, 2));
await b.close();
