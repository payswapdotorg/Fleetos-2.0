/**
 * infrastructure/fleetos-durable/static.ts — static shell serving (F351A).
 *
 * Serves packages/web/dist-fleetos/ with hash-routing SPA fallback: "/" is
 * fleetos.html, real files are served with their MIME types, anything else
 * falls back to fleetos.html (the router lives in the hash). Path traversal
 * is refused (the resolved path must stay inside the shell dir).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import type { ServerResponse } from "node:http";

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

export function serveStatic(res: ServerResponse, shellDir: string, pathname: string): void {
  const clean = pathname.replace(/\\/g, "/").replace(/\.{2,}\//g, "");
  let file = path.join(shellDir, clean === "/" ? "fleetos.html" : clean);
  if (!file.startsWith(shellDir)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    // SPA fallback: hash routing means every unknown path is the shell.
    file = path.join(shellDir, "fleetos.html");
    if (!existsSync(file)) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        "FleetOS shell not built. Run: cd packages/web && npx vite build --config vite.fleetos.config.ts",
      );
      return;
    }
  }
  const body = readFileSync(file);
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(body);
}
