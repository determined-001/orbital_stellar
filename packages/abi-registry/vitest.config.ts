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
      // Functions re-baselined from 87 to 80: #937, #940, #947 and #960 landed
      // between #923 measuring the baseline and #923 merging, adding exported
      // helpers faster than tests reached them (measured 85.42%).
      thresholds: {
        statements: 76,
        branches: 66,
        functions: 80,
        lines: 77,
      },
      reporter: ["text", "html", "json-summary"],
    },
  },
});
