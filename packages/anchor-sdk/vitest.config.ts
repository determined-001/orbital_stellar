import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["node_modules/", "dist/", "test/", "**/*.test.ts", "**/*.config.*"],
      // Ratcheted to just under the measured numbers after the SEP-1/10/24
      // work landed. `functions` was 100 when the package was three files;
      // it is 95 now because two abort-timer callbacks are only reachable
      // through a real socket stall.
      thresholds: {
        statements: 93,
        branches: 74,
        functions: 95,
        lines: 96,
      },
      reporter: ["text", "html", "json-summary"],
    },
  },
});
