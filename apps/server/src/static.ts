import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

type Next = () => void;

/**
 * Serves the built web app (apps/web/dist) from the game server, so one container has everything. A connect-style
 * middleware for the HTTP app Colyseus already runs (its matchmaking routes take precedence). `/horde` redirects to
 * `/horde/`, a directory serves its index.html. Hashed files under /assets/ are cached for a year, the rest is
 * revalidated (so a new deploy shows up at once).
 */
export function serveStatic(root: string) {
  const base = resolve(root);
  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      return next();
    }
    const file = normalize(join(base, path));
    if (file !== base && !file.startsWith(base + sep)) return next(); // no ../ escapes
    try {
      let target = file;
      let info = await stat(target);
      if (info.isDirectory()) {
        if (!path.endsWith("/")) {
          const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
          res.writeHead(301, { Location: `${path}/${query}` }).end();
          return;
        }
        target = join(target, "index.html");
        info = await stat(target);
      }
      if (!info.isFile()) return next();
      res.writeHead(200, {
        "Content-Type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      if (req.method === "HEAD") return void res.end();
      createReadStream(target).pipe(res);
    } catch {
      next();
    }
  };
}
