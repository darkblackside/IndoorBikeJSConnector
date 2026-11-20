import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Use game-core from its TypeScript sources (no build needed for tests).
const conditions = ["indoor-bike-source", ...defaultServerConditions];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  // Every test file boots a server on the same port (@colyseus/testing ignores the port for a Server instance).
  test: { name: "server", include: ["test/**/*.test.ts"], environment: "node", fileParallelism: false },
});
