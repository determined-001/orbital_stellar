import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["node_modules/", "dist/", "test/", "**/*.test.ts", "**/*.config.*", "src/index.ts"],
      // service.ts wires a live EventEngine against Horizon, so only its
      // shutdown ordering is unit-testable; the rest is exercised by running
      // the starter, not by CI. Floors reflect what is genuinely covered.
      thresholds: { statements: 55, branches: 75, functions: 48, lines: 58 },
      reporter: ["text", "json-summary"],
    },
  },
  resolve: {
    // Resolve the workspace packages from source, like the other packages do -
    // otherwise the suite needs their dist output to have been built first.
    alias: {
      "@orbital-stellar/pulse-core": fileURLToPath(
        new URL("../../packages/pulse-core/src/index.ts", import.meta.url),
      ),
      "@orbital-stellar/pulse-webhooks": fileURLToPath(
        new URL("../../packages/pulse-webhooks/src/index.ts", import.meta.url),
      ),
    },
  },
});
