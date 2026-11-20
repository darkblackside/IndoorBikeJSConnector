// Builds the GitHub Pages site: only redirects to the real app on the game server, so old links
// (darkblackside.github.io/IndoorBikeJSConnector/<page>/) keep working. No app, no scripts from elsewhere.
//
//   node scripts/pages-redirect.mjs <out-dir> [target]   (target default: https://sweat-games.lightwhiteside.de)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "pages-dist";
const target = (process.argv[3] || "https://sweat-games.lightwhiteside.de").replace(/\/+$/, "");
const pages = ["", "zombie-ramp", "ftp20", "horde", "debug", "impressum", "datenschutz"];

const html = (path) => {
  const url = `${target}/${path ? `${path}/` : ""}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="robots" content="noindex" />
    <link rel="canonical" href="${url}" />
    <meta http-equiv="refresh" content="0; url=${url}" />
    <title>Indoor Bike Games – moved</title>
    <script>location.replace(${JSON.stringify(url)} + location.hash);</script>
  </head>
  <body>
    <p>The Indoor Bike Games have moved to <a href="${url}">${url}</a>.</p>
  </body>
</html>
`;
};

for (const path of pages) {
  mkdirSync(join(out, path), { recursive: true });
  writeFileSync(join(out, path, "index.html"), html(path));
}
writeFileSync(join(out, "404.html"), html(""));
console.log(`${pages.length} redirects to ${target} in ${out}/`);
