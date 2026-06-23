/**
 * lib/downloader.js
 * Descarga videos desde el content script.
 *
 * Soporta:
 *   - URLs http(s) directas -> se envian al background que llama chrome.downloads
 *   - URLs blob: o internas -> se convierten a data URL en el content y se envian al background
 *
 * Mensajes:
 *   DOWNLOAD  { url, dataUrl?, filename, runId }  ->  { ok, id, error? }
 */
(function (root) {
  "use strict";

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      try {
        const fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { reject(fr.error || new Error("FileReader error")); };
        fr.readAsDataURL(blob);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function fetchAsDataUrl(url) {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    return blobToDataUrl(blob);
  }

  /**
   * Solicita la descarga al background.
   * Si la url es http(s) y tiene un host "estable" (meta / fbcdn), el background
   * llama directamente chrome.downloads.download.
   * Si es blob: o falla, primero convertimos a data URL.
   */
  async function download(opts) {
    const url = opts && opts.url;
    const filename = (opts && opts.filename) || "video.mp4";
    const runId = (opts && opts.runId) || "";
    if (!url) return { ok: false, error: "missing url" };

    let payload = {
      type: "DOWNLOAD",
      runId: runId,
      url: url,
      filename: filename,
    };

    const isHttp = /^https?:\/\//i.test(url);
    if (!isHttp) {
      try {
        const dataUrl = await fetchAsDataUrl(url);
        payload = { type: "DOWNLOAD", runId: runId, url: dataUrl, filename: filename };
      } catch (e) {
        return { ok: false, error: "blob fetch failed: " + (e && e.message || e) };
      }
    }

    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(payload, function (resp) {
          const err = chrome.runtime.lastError;
          if (err) return resolve({ ok: false, error: err.message });
          resolve(resp || { ok: false, error: "no response" });
        });
      } catch (e) {
        resolve({ ok: false, error: (e && e.message) || String(e) });
      }
    });
  }

  root.Downloader = { download: download, fetchAsDataUrl: fetchAsDataUrl, blobToDataUrl: blobToDataUrl };
})(typeof self !== "undefined" ? self : globalThis);
