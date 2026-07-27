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
        // Barrel re-export — no runtime code to cover
        "src/index.ts",
        // Pure type declarations — no runtime code to cover
        "src/types.ts",
      ],
      thresholds: {
        statements: 76,
        branches: 66,
        functions: 87,
        lines: 77,
      },
      reporter: ["text", "html", "json-summary"],
    },
  },
});
