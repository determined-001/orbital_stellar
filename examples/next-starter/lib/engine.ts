import { EventEngine, FileCursorStore } from "@orbital-stellar/pulse-core";
// No `.js` extension: this app resolves with `moduleResolution: "bundler"`
// (see tsconfig.json), unlike the packages, which are NodeNext and need one.
import { loadConfig } from "./config";

/**
 * One engine per server process, cached on `globalThis` so Next's dev-mode
 * module reloading does not open a second Horizon stream on every edit.
 *
 * The cursor is file-backed: restart the dev server and it resumes where it
 * left off instead of replaying or skipping.
 */
const globalRef = globalThis as unknown as { __orbitalStarterEngine?: EventEngine };

export function getEngine(): EventEngine {
  if (!globalRef.__orbitalStarterEngine) {
    const config = loadConfig();

    const engine = new EventEngine({
      network: config.network,
      cursorStore: new FileCursorStore(config.cursorDir),
      soroban: { rpcUrl: config.sorobanRpcUrl },
    });

    engine.start();
    globalRef.__orbitalStarterEngine = engine;
  }

  return globalRef.__orbitalStarterEngine;
}
