import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirrors packages/pulse-core/vitest.config.ts. The `@/` alias matches the
// tsconfig `paths` entry so tests import modules exactly as the app does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` throws on import outside a React Server Component graph,
      // which would make every server-side lib untestable. `next build` still
      // enforces the real boundary.
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["node_modules/", "**/*.test.ts", "**/*.config.*"],
      reporter: ["text", "html", "json-summary"],
    },
  },
});
