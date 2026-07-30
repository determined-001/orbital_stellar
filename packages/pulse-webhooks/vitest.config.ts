import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "node_modules/",
        "dist/",
        "test/",
        "**/*.test.ts",
        "**/*.config.*",
        "bin/",
        "migrations/",
        // Pure interface (no runtime code to cover)
        "src/RetryQueue.ts",
        // Unreferenced dead code — no test coverage expected
        "src/url-validator.ts",
      ],
      thresholds: {
        statements: 83,
        branches: 72,
        functions: 85,
        lines: 87,
      },
      reporter: ["text", "html", "json-summary"],
    },
  },
  resolve: {
    alias: {
      "@orbital-stellar/pulse-core": fileURLToPath(
        new URL("../pulse-core/src/index.ts", import.meta.url),
      ),
    },
  },
});
