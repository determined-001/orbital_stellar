import { EventEngine } from "@orbital-stellar/pulse-core";
import { getNetwork } from "./network";

const g = globalThis as unknown as { __orbitalEngine?: EventEngine };

export function getEngine(): EventEngine {
  if (!g.__orbitalEngine) {
    const engine = new EventEngine({ network: getNetwork() });
    engine.start();
    g.__orbitalEngine = engine;
  }
  return g.__orbitalEngine;
}
