import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["node_modules/", "dist/", "test/", "**/*.test.ts", "**/*.config.*"],
      thresholds: {
        statements: 85,
        branches: 70,
        functions: 83,
        lines: 92,
      },
      reporter: ["text", "html", "json-summary"],
    },
  },
  resolve: {
    alias: {
      "@orbital-stellar/pulse-core": fileURLToPath(
        new URL("../pulse-core/src/index.ts", import.meta.url),
      ),
      "@orbital-stellar/abi-registry": fileURLToPath(
        new URL("../abi-registry/src/index.ts", import.meta.url),
      ),
    },
  },
});
