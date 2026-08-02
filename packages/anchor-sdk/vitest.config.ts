import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["node_modules/", "dist/", "test/", "**/*.test.ts", "**/*.config.*"],
      thresholds: {
        statements: 89,
        branches: 60,
        functions: 100,
        lines: 91,
      },
      reporter: ["text", "html", "json-summary"],
    },
  },
});
