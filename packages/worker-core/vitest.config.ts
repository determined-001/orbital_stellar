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
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
      reporter: ["text", "html", "json-summary"],
    },
  },
  resolve: {
    alias: {
      "@orbital-stellar/abi-registry": fileURLToPath(
        new URL("../abi-registry/src/index.ts", import.meta.url),
      ),
    },
  },
});
