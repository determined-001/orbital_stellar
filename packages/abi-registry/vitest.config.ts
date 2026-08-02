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
      // Ratcheted to just under measured on `main` after #944 landed:
      // statements 77.19, branches 68.68, functions 89.37, lines 78.00.
      //
      // The lines floor had been dropped 77 -> 76 in #944 with a TODO, when the
      // branch was 0.05% short. It is not short any more, so the floor is back
      // above where it was rather than left as a ratchet that moved backwards.
      thresholds: {
        statements: 77,
        branches: 68,
        functions: 89,
        lines: 77,
      },
      reporter: ["text", "html", "json-summary"],
    },
  },
});
