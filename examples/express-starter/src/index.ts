import { loadConfig } from "./config.js";
import { installSignalHandlers, startService } from "./service.js";

/**
 * Entry point. `pnpm start` after `pnpm build`, or `pnpm dev` to run from
 * source. See README.md for the resume-after-restart walkthrough.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const service = await startService(config);
  installSignalHandlers(service);
}

main().catch((error: unknown) => {
  console.error("[starter] failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
