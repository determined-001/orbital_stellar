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
      ],
      // Ratcheted after url-validator.ts came under test in #926 - it was
      // previously excluded as unreferenced, which meant an exported SSRF
      // check shipped with no coverage at all.
      thresholds: {
        statements: 88,
        branches: 79,
        functions: 91,
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
    },
  },
});
