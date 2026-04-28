import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
    test: {
        environment: "node",
    },
    resolve: {
        alias: {
            "@orbital/pulse-core": fileURLToPath(
                new URL("../pulse-core/src/index.ts", import.meta.url)
            ),
        },
    },
});