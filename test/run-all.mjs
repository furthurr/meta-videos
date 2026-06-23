/**
 * test/run-all.mjs
 * Orquestador: corre todas las capas en orden y resume PASS/FAIL.
 *   1) lint   : manifest-validate + eslint (no-undef)
 *   2) unit   : node --test unit/
 *   3) dom    : node --test dom/   (jsdom)
 *   4) flow   : playwright test     (Chromium, abre Chrome con la extension)
 *
 * Uso:
 *   node run-all.mjs           (todo)
 *   node run-all.mjs --fast    (omite e2e/playwright)
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, "..");
const FAST = process.argv.includes("--fast");

function run(name, cmd, args, opts = {}) {
  process.stdout.write(`\n\u2500\u2500 ${name} \u2500\u2500\n`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: opts.cwd || __dirname, shell: false });
  return r.status === 0;
}

const results = [];

// 1) lint
results.push(["manifest-validate", run("manifest-validate", "node", ["lint/manifest-validate.mjs"])]);
results.push([
  "eslint (no-undef)",
  run("eslint", "npx", [
    "eslint", "--config", "test/lint/eslint.config.mjs",
    "background.js", "content.js", "lib/*.js", "sidepanel/*.js",
  ], { cwd: EXT_ROOT }),
]);

// 2) unit
results.push(["unit", run("unit", "node", ["--test", "unit/*.test.mjs"])]);

// 3) dom
results.push(["dom", run("dom (jsdom)", "node", ["--test", "dom/*.test.mjs"])]);

// 4) integration (playwright/chromium)
if (!FAST) {
  results.push(["integration", run("integration (playwright)", "npx", ["playwright", "test", "--project=chromium"])]);
} else {
  process.stdout.write("\n\u2500\u2500 integration \u2500\u2500\n(omitido por --fast)\n");
}

// resumen
process.stdout.write("\n\u2550\u2550\u2550\u2550\u2550 RESUMEN \u2550\u2550\u2550\u2550\u2550\n");
let allOk = true;
for (const [name, ok] of results) {
  process.stdout.write(`  ${ok ? "\u2713" : "\u2717"} ${name}\n`);
  if (!ok) allOk = false;
}
process.stdout.write(allOk ? "\nTODO VERDE \u2705\n" : "\nHAY FALLOS \u274c\n");
process.exit(allOk ? 0 : 1);
