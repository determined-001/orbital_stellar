import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // src/index.ts is a barrel re-export - no statements of its own.
      exclude: ["node_modules/", "dist/", "test/", "**/*.test.ts", "**/*.config.*", "src/index.ts"],
      // Re-baselined after #933 landed: the live-registry paths in
      // AutoPublishIndexer are only exercised when INTEGRATION_TESTS is set,
      // so they read as uncovered in the default run.
      thresholds: {
        statements: 74,
        branches: 48,
        functions: 83,
        lines: 79,
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
