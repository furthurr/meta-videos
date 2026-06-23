/**
 * lib/slug.js
 * Genera un slug ASCII estable a partir del prompt.
 * Usado para nombres de archivo y carpetas.
 */
(function (root) {
  "use strict";

  function slugify(text, maxLen) {
    if (typeof text !== "string") text = String(text || "");
    maxLen = maxLen || 40;
    let s = text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // diacríticos
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, "link") // URLs -> "link"
      .replace(/[^a-z0-9\s_-]/g, " ")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!s) s = "video";
    if (s.length > maxLen) s = s.slice(0, maxLen).replace(/-+$/, "");
    return s;
  }

  function pad2(n) {
    n = Number(n) || 0;
    return n < 10 ? "0" + n : String(n);
  }

  /**
   * Construye la ruta/nombre de archivo de un video.
   *   { folder, slug, idx, numberFiles } -> "folder/slug/NN_slug.mp4"
   */
  function videoFilename(opts) {
    opts = opts || {};
    const folder = String(opts.folder || "MetaVideos").replace(/\/+$/, "");
    const slug = opts.slug || "video";
    const idx = opts.numberFiles ? pad2(opts.idx) : String(opts.idx);
    return folder + "/" + slug + "/" + idx + "_" + slug + ".mp4";
  }

  root.Slug = { slugify, pad2, videoFilename };
})(typeof self !== "undefined" ? self : globalThis);
