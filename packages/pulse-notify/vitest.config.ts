import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["node_modules/", "dist/", "test/", "**/*.test.{ts,tsx}", "**/*.config.*"],
      thresholds: {
        statements: 62,
        branches: 50,
        functions: 54,
        lines: 67,
      },
      reporter: ["text", "html", "json-summary"],
    },
  },
});
