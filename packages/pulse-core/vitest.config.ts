import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
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
        // Type stubs re-exported from @stellar/stellar-sdk — no runtime code to cover
        "src/events.ts",
        "src/raw-horizon.ts",
        "src/raw-soroban.ts",
      ],
      thresholds: {
        statements: 83,
        branches: 75,
        functions: 84,
        lines: 85,
      },
      reporter: ["text", "html", "json-summary"],
    },
  },
});
