import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveStatic } from "../src/static.ts";

describe("serveStatic", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "web-"));
    await mkdir(join(root, "web", "horde"), { recursive: true });
    await mkdir(join(root, "web", "assets"));
    await writeFile(join(root, "secret.txt"), "nope");
    await writeFile(join(root, "web", "index.html"), "<h1>hub</h1>");
    await writeFile(join(root, "web", "horde", "index.html"), "<h1>horde</h1>");
    await writeFile(join(root, "web", "assets", "app-abc.js"), "console.log(1)");
    const handler = serveStatic(join(root, "web"));
    server = createServer((req, res) => handler(req, res, () => res.writeHead(404).end("not found")));
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("serves pages, directories and assets with the right headers", async () => {
    const hub = await fetch(`${base}/`);
    expect(hub.headers.get("content-type")).toContain("text/html");
    expect(hub.headers.get("cache-control")).toBe("no-cache");
    expect(await hub.text()).toBe("<h1>hub</h1>");
    expect(await (await fetch(`${base}/horde/`)).text()).toBe("<h1>horde</h1>");
    const asset = await fetch(`${base}/assets/app-abc.js`);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
  });

  it("redirects a directory without its slash, keeping the query", async () => {
    const r = await fetch(`${base}/horde?x=1`, { redirect: "manual" });
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("/horde/?x=1");
  });

  it("passes unknown paths on and never leaves the web folder", async () => {
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/%2e%2e/secret.txt`)).status).toBe(404);
    expect((await fetch(`${base}/..%2fsecret.txt`)).status).toBe(404);
  });
});
