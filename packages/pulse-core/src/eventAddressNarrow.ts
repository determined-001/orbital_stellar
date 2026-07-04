import type { NormalizedEvent } from "./index.js";

export function describeEvent(event: NormalizedEvent): string {
  switch (event.type) {
    case "payment.received":
    case "payment.sent":
    case "payment.self":
      return `Payment ${event.type} from ${event.from} to ${event.to}`;
    case "account.options_changed":
      return `Account options changed for ${event.source}`;
    case "account.created":
      return `Account created: ${event.account} funded by ${event.funder}`;
    case "trustline.added":
    case "trustline.removed":
    case "trustline.updated":
      return `Trustline ${event.type} for ${event.account}`;
    case "account.merged":
      return `Account merged: ${event.source} -> ${event.destination}`;
    case "offer.created":
    case "offer.updated":
    case "offer.deleted":
      return `Offer ${event.type} by ${event.source}`;
    case "account.bump_sequence":
      return `Bump sequence for ${event.source}`;
    case "data.set":
    case "data.cleared":
      return `Data ${event.type} for ${event.source}`;
    case "claimable.created":
      return `Claimable created by ${event.sponsor}`;
    case "claimable.claimed":
      return `Claimable claimed by ${event.claimant}`;
    case "lp.deposited":
      return `Liquidity pool deposit by ${event.source}`;
    case "lp.withdrawn":
      return `Liquidity pool withdrawal by ${event.source}`;
    case "trustline.authorized":
    case "trustline.deauthorized":
      return `Trust ${event.type} between ${event.trustor} and ${event.issuer}`;
    case "contract.invoked":
      return `Contract invoked ${event.contractId}`;
    case "contract.emitted":
      return `Contract emitted ${event.contractId}`;
    default: {
      const _exhaustiveCheck: never = event;
      return _exhaustiveCheck;
    }
  }
}
