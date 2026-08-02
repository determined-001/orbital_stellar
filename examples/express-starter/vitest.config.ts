import { defineConfig } from "vitest/config";

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
});
