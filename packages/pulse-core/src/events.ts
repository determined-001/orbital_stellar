/**
 * Per-event named types for pulse-core, grouped for precise type narrowing.
 * Accessible via the `events` namespace export from "@orbital/pulse-core".
 *
 * @example
 * import type { events } from "@orbital/pulse-core";
 * type Payment = events.PaymentEvent;
 */
export type {
  PaymentEvent,
  AccountOptionsEvent,
  AccountCreatedEvent,
  TrustlineEvent,
  AccountMergeEvent,
  OfferEvent,
  BumpSequenceEvent,
  DataEvent,
  ClaimableCreatedEvent,
  ClaimableClaimedEvent,
  LiquidityPoolDepositEvent,
  LiquidityPoolWithdrawEvent,
  TrustAuthEvent,
  ContractInvokedEvent,
  ContractEmittedEvent,
  ContractEvent,
} from "./index.js";
