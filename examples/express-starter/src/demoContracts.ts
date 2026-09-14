import type { ContractEmittedEvent } from "@orbital-stellar/pulse-core";
import { isPingEvent } from "./generated/demoEmitter.js";
import { isTransferEvent, isMintEvent, isBurnEvent } from "./generated/usdc.js";

/**
 * The two contracts `orbital.config.ts` generates types for (issue #908):
 * this repo's deployed testnet demo-emitter, and mainnet USDC as the
 * well-known-contract example. Watching both through one testnet-configured
 * `EventEngine` means only the demo-emitter's events actually arrive in a
 * default run - USDC's guards below still run for real against every
 * contract.emitted event, they just won't match one from a different
 * network's contract. That is real code exercising real generated types,
 * not a demonstration that requires two networks running at once.
 */
export const DEMO_EMITTER_CONTRACT_ID = "CBGPM7FULEXM2WO4USIPC6XDJXKFUODU3EFAOVUZTJRAW4EJ2ZUA7PBJ";
export const USDC_CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

/** Human-readable summary of a contract.emitted event, using the generated guards - `null` for anything neither contract's generated types recognize. */
export function describeContractEvent(event: ContractEmittedEvent): string | null {
  if (isPingEvent(event)) {
    return `demo-emitter ping at ${event.decodedData.timestamp}`;
  }
  if (isTransferEvent(event)) {
    return `USDC transfer of ${event.decodedData.amount}`;
  }
  if (isMintEvent(event)) {
    return `USDC mint of ${event.decodedData.amount}`;
  }
  if (isBurnEvent(event)) {
    return `USDC burn of ${event.decodedData.amount}`;
  }
  return null;
}
