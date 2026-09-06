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
        "src/index.ts",
        "src/guards/index.ts",
        "src/subscription/index.ts",
      ],
      reporter: ["text", "html", "json-summary"],
    },
  },
});
