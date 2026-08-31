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
        "src/hotPath/index.ts",
        "src/vault/types.ts",
        "src/workers/index.ts",
        "src/guards/index.ts",
      ],
      reporter: ["text", "html", "json-summary"],
    },
  },
});
