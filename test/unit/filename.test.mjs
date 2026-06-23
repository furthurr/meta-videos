/**
 * test/unit/filename.test.mjs
 * Valida lib/slug.js videoFilename con la config de la imagen.
 * Estructura esperada: MetaVideos/<slug>/NN_<slug>.mp4
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGlobals } from "../helpers/load-global.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "..", "fixtures", "config.json"), "utf8")
);

const { Slug } = loadGlobals(["lib/slug.js"]);

function fname(slug, idx) {
  return Slug.videoFilename({
    folder: cfg.downloadFolder,
    slug: slug,
    idx: idx,
    numberFiles: cfg.numberFiles,
  });
}

test("estructura MetaVideos/<slug>/NN_<slug>.mp4", () => {
  assert.equal(fname("un-gato", 1), "MetaVideos/un-gato/01_un-gato.mp4");
});

test("numerado con cero a la izquierda (1..4)", () => {
  const slug = "astronauta";
  assert.equal(fname(slug, 1), "MetaVideos/astronauta/01_astronauta.mp4");
  assert.equal(fname(slug, 2), "MetaVideos/astronauta/02_astronauta.mp4");
  assert.equal(fname(slug, 3), "MetaVideos/astronauta/03_astronauta.mp4");
  assert.equal(fname(slug, 4), "MetaVideos/astronauta/04_astronauta.mp4");
});

test("sin numeracion usa el indice crudo", () => {
  const f = Slug.videoFilename({ folder: "MetaVideos", slug: "x", idx: 3, numberFiles: false });
  assert.equal(f, "MetaVideos/x/3_x.mp4");
});

test("carpeta con slash final se normaliza", () => {
  const f = Slug.videoFilename({ folder: "MetaVideos/", slug: "x", idx: 1, numberFiles: true });
  assert.equal(f, "MetaVideos/x/01_x.mp4");
});

test("config de la imagen: 4 videos por prompt", () => {
  assert.equal(cfg.videosPerPrompt, 4);
  const slug = "ciudad-cyberpunk";
  const files = [];
  for (let i = 1; i <= cfg.videosPerPrompt; i++) files.push(fname(slug, i));
  assert.deepEqual(files, [
    "MetaVideos/ciudad-cyberpunk/01_ciudad-cyberpunk.mp4",
    "MetaVideos/ciudad-cyberpunk/02_ciudad-cyberpunk.mp4",
    "MetaVideos/ciudad-cyberpunk/03_ciudad-cyberpunk.mp4",
    "MetaVideos/ciudad-cyberpunk/04_ciudad-cyberpunk.mp4",
  ]);
});
