import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// Web Bluetooth only works in a secure context. http://localhost counts as
// secure, but other devices on your network (phone, tablet) need HTTPS:
// `npm run dev:https` serves a self-signed certificate for that case.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: mode === "https" ? [basicSsl()] : [],
  server: { host: mode === "https" ? true : "localhost" },
  build: { target: "es2022", sourcemap: true },
  test: { environment: "node" },
}));
