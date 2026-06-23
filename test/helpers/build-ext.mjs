/**
 * test/helpers/build-ext.mjs
 * Construye una copia temporal de la extension con un manifest de test que
 * incluye matches a localhost (para que el content script corra en la mock page
 * y el background la trate como pestana "meta").
 *
 * buildTestExtension(targetDir?):
 *   - sin args  -> copia a un dir temporal nuevo (mock e2e).
 *   - con targetDir -> copia a una ruta estable (e2e real): mantiene el mismo
 *     extension id entre corridas, util con un perfil persistente.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, "..", "..");

const LOCAL_MATCHES = ["http://127.0.0.1/*", "http://localhost/*"];

export function buildTestExtension(targetDir) {
  let tmp;
  if (targetDir) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });
    tmp = targetDir;
  } else {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meta-videos-ext-"));
  }

  // Copiar la extension excluyendo test/ y node_modules.
  fs.cpSync(EXT_ROOT, tmp, {
    recursive: true,
    filter(src) {
      const rel = path.relative(EXT_ROOT, src);
      if (rel === "") return true;
      const top = rel.split(path.sep)[0];
      if (top === "test" || top === "node_modules" || top === "scripts") return false;
      if (rel.startsWith(".git")) return false;
      return true;
    },
  });

  // Parchear el manifest.
  const manifestPath = path.join(tmp, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  manifest.host_permissions = (manifest.host_permissions || []).concat(LOCAL_MATCHES);
  if (Array.isArray(manifest.content_scripts) && manifest.content_scripts[0]) {
    manifest.content_scripts[0].matches =
      (manifest.content_scripts[0].matches || []).concat(LOCAL_MATCHES);
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return tmp;
}

export function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}
