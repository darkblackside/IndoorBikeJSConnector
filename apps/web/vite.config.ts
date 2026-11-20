import { defineConfig, defaultClientConditions } from "vite";
import { fileURLToPath } from "node:url";
import basicSsl from "@vitejs/plugin-basic-ssl";

// The web frontend: game hub (index.html, Offline/Online tabs), the Zombie Ramp game (zombie-ramp/), the 20-minute
// FTP test (ftp20/), the online co-op game Feed the Horde (horde/) and the hidden debug bench (debug/, not linked from the app; reachable by its URL only).
// The workspace packages (indoor-bike-js-connector, @indoor-bike/game-core) are used from their TypeScript
// sources through the "indoor-bike-source" export condition, so no package build is needed for dev or build.
//
// Web Bluetooth needs a secure context: http://localhost is fine, other devices
// on the LAN (phone/tablet) need `npm run dev:https` (self-signed certificate).
const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: mode === "https" ? [basicSsl()] : [],
  resolve: { conditions: ["indoor-bike-source", ...defaultClientConditions] },
  server: { host: mode === "https" ? true : "localhost" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    // three.js alone is ~550 kB minified (~150 kB gzipped); the 20-min FTP test page needs it.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        home: page("index.html"),
        zombieRamp: page("zombie-ramp/index.html"),
        ftp20: page("ftp20/index.html"),
        horde: page("horde/index.html"),
        debug: page("debug/index.html"),
      },
    },
  },
}));
