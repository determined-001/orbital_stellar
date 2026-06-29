/*
 * Utility to demonstrate exhaustive switch over NormalizedEvent.
 * This function is useful for type-level checks and ensures that
 * address‑typed fields are correctly narrowed per event branch.
 */
import type {
  NormalizedEvent,
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
} from "./index.js";

/**
 * Perform an exhaustive switch over a NormalizedEvent.
 * The body is intentionally minimal – we simply return a string
 * describing the event type and demonstrate that address fields are
 * correctly typed within each branch.
 */
export function describeEvent(event: NormalizedEvent): string {
  switch (event.type) {
    case "payment.received":
    case "payment.sent":
    case "payment.self": {
      const e = event as PaymentEvent; // addresses are AccountAddress | MuxedAddress
      return `Payment ${e.type} from ${e.from} to ${e.to}`;
    }
    case "account.options_changed": {
      const e = event as AccountOptionsEvent; // source is AccountAddress
      return `Account options changed for ${e.source}`;
    }
    case "account.created": {
      const e = event as AccountCreatedEvent; // funder and account are AccountAddress
      return `Account created: ${e.account} funded by ${e.funder}`;
    }
    case "trustline.added":
    case "trustline.removed":
    case "trustline.updated": {
      const e = event as TrustlineEvent; // account is AccountAddress
      return `Trustline ${event.type} for ${e.account}`;
    }
    case "account.merged": {
      const e = event as AccountMergeEvent; // source and destination are AccountAddress
      return `Account merged: ${e.source} -> ${e.destination}`;
    }
    case "offer.created":
    case "offer.updated":
    case "offer.deleted": {
      const e = event as OfferEvent; // source is AccountAddress
      return `Offer ${event.type} by ${e.source}`;
    }
    case "account.bump_sequence": {
      const e = event as BumpSequenceEvent; // source is AccountAddress
      return `Bump sequence for ${e.source}`;
    }
    case "data.set":
    case "data.cleared": {
      const e = event as DataEvent; // source is AccountAddress
      return `Data ${event.type} for ${e.source}`;
    }
    case "claimable.created": {
      const e = event as ClaimableCreatedEvent; // sponsor is AccountAddress
      return `Claimable created by ${e.sponsor}`;
    }
    case "claimable.claimed": {
      const e = event as ClaimableClaimedEvent; // claimant is AccountAddress
      return `Claimable claimed by ${e.claimant}`;
    }
    case "lp.deposited": {
      const e = event as LiquidityPoolDepositEvent; // source is AccountAddress
      return `Liquidity pool deposit by ${e.source}`;
    }
    case "lp.withdrawn": {
      const e = event as LiquidityPoolWithdrawEvent; // source is AccountAddress
      return `Liquidity pool withdrawal by ${e.source}`;
    }
    case "trustline.authorized":
    case "trustline.deauthorized": {
      const e = event as TrustAuthEvent; // trustor and issuer are AccountAddress
      return `Trust ${event.type} between ${e.trustor} and ${e.issuer}`;
    }
    case "contract.invoked": {
      const e = event as ContractInvokedEvent; // contractId is ContractAddress
      return `Contract invoked ${e.contractId}`;
    }
    case "contract.emitted": {
      const e = event as ContractEmittedEvent; // contractId is ContractAddress
      return `Contract emitted ${e.contractId}`;
    }
    default:
      const _exhaustiveCheck: never = event;
      return _exhaustiveCheck;
  }
}
