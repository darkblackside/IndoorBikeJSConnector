import { defineConfig } from "vitest/config";

// `npm test` at the root runs every workspace's tests (each package has its own vitest.config.ts).
export default defineConfig({
  test: { projects: ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"] },
});
