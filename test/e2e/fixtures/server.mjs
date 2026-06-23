/**
 * test/e2e/fixtures/server.mjs
 * Servidor HTTP minimo que sirve la mock page + sample.mp4.
 * Exporta startServer() que devuelve { url, close }.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mp4": "video/mp4",
  ".js": "text/javascript",
  ".css": "text/css",
};

export function startServer(port = 0) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = urlPath === "/" ? "/index.html" : urlPath;
    const abs = path.join(__dirname, file);
    // seguridad basica: no salir del dir
    if (!abs.startsWith(__dirname)) {
      res.writeHead(403); res.end("forbidden"); return;
    }
    fs.readFile(abs, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      const ext = path.extname(abs);
      res.writeHead(200, {
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Accept-Ranges": "bytes",
      });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        url,
        port: addr.port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// Permite arrancarlo manualmente: `node server.mjs 8099`
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.argv[2] || "8099", 10);
  startServer(port).then((s) => {
    console.log("mock-meta en", s.url);
  });
}
