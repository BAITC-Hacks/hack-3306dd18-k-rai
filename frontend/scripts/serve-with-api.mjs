/**
 * Раздаёт собранную статику из out/ и проксирует /api/* на бэкенд.
 * Повторяет продакшн-топологию из брифа: фронт и API на одном origin,
 * поэтому CORS не нужен ни здесь, ни на бою.
 *
 * Запуск:
 *   node scripts/serve-with-api.mjs --api https://financegraph-cofy.onrender.com --port 4174
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const API = flag("api", "http://127.0.0.1:8000").replace(/\/$/, "");
const PORT = Number(flag("port", "4174"));
const ROOT = join(fileURLToPath(new URL("../", import.meta.url)), "out");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

async function serveStatic(pathname, res) {
  // Не выпускаем за пределы out/: pathname приходит из запроса.
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(ROOT, safe);

  try {
    const info = await stat(filePath).catch(() => null);
    if (!info || info.isDirectory()) {
      filePath = info?.isDirectory() ? join(filePath, "index.html") : `${filePath}.html`;
    }
    if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    try {
      const fallback = await readFile(join(ROOT, "index.html"));
      res.writeHead(200, { "Content-Type": MIME[".html"] }).end(fallback);
    } catch {
      res.writeHead(404).end("Сначала соберите проект: npm run build");
    }
  }
}

async function proxy(req, res, pathname, search) {
  const target = `${API}${pathname}${search}`;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);

  const started = Date.now();
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { "Content-Type": req.headers["content-type"] ?? "application/json" },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    console.log(`${req.method} ${pathname} → ${upstream.status} ${body.length} Б за ${Date.now() - started} мс`);
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    });
    res.end(body);
  } catch (error) {
    console.error(`${req.method} ${pathname} → ошибка: ${error.message}`);
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: `Бэкенд недоступен: ${error.message}` }));
  }
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    void proxy(req, res, url.pathname, url.search);
    return;
  }
  void serveStatic(url.pathname === "/" ? "/index.html" : url.pathname, res);
}).listen(PORT, () => {
  console.log(`Статика из out/ и прокси /api/* → ${API}`);
  console.log(`Открыть: http://localhost:${PORT}`);
});
