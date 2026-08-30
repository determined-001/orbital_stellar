import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["node_modules/", "dist/", "test/", "**/*.test.ts", "**/*.config.*"],
      reporter: ["text", "html", "json-summary"],
    },
  },
  resolve: {
    alias: {
      "@orbital-stellar/pulse-core": fileURLToPath(
        new URL("../pulse-core/src/index.ts", import.meta.url),
      ),
      "@orbital-stellar/pulse-webhooks": fileURLToPath(
        new URL("../pulse-webhooks/src/index.ts", import.meta.url),
      ),
      "@orbital-stellar/abi-registry": fileURLToPath(
        new URL("../abi-registry/src/index.ts", import.meta.url),
      ),
    },
  },
});
