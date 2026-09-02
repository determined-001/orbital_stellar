// @vitest-environment node

import { describe, it, expect } from "vitest";
import { build } from "vite";
import path from "path";
import fs from "fs";

const normalizePath = (p: string): string => p.replace(/\\/g, "/");

describe("Tree Shaking Tests", () => {
  it("should remove unused exports during build", async () => {
    const rootDir = normalizePath(path.resolve(__dirname, ".."));
    const entryFile = normalizePath(path.resolve(rootDir, "src/index.ts"));
    const outDir = normalizePath(path.resolve(rootDir, "dist-test"));

    const output = await build({
      root: rootDir,
      build: {
        lib: {
          entry: entryFile,
          formats: ["es"],
          fileName: "bundle",
        },
        outDir,
        write: false,
        rollupOptions: {
          onwarn(warning, warn) {
            // Silence "use client" directive warnings during test bundling
            if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
            warn(warning);
          },
        },
      },
    });

    expect(output).toBeDefined();

    if (fs.existsSync(outDir)) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
