import { defineConfig } from "vitest/config";
import basicSsl from "@vitejs/plugin-basic-ssl";

// Vite only serves/builds the demo test bench (demo/). The library itself is
// compiled with `tsc -p tsconfig.build.json` into dist/.
//
// Web Bluetooth needs a secure context: http://localhost is fine, other devices
// on the LAN (phone/tablet) need `npm run dev:https` (self-signed certificate).
export default defineConfig(({ mode }) => ({
  root: "demo",
  base: "./",
  plugins: mode === "https" ? [basicSsl()] : [],
  server: { host: mode === "https" ? true : "localhost" },
  build: { outDir: "../demo-dist", emptyOutDir: true, target: "es2022", sourcemap: true },
  test: { root: ".", include: ["test/**/*.test.ts"], environment: "node" },
}));
