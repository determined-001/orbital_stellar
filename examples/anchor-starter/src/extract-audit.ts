import type { NormalizedEvent } from "@orbital-stellar/pulse-core";
import type { AuditRecord } from "./audit-log.js";

/**
 * Extracts an {@link AuditRecord} from a normalized Stellar event.
 *
 * Returns `null` for event types that are not payment or trustline events
 * (the caller should already have filtered these out).
 *
 * ## Field extraction strategy
 *
 * | Field           | Source                                                    |
 * |-----------------|-----------------------------------------------------------|
 * | `ledger`        | `raw.id` (first segment before `-`)                       |
 * | `operationIndex`| `raw.id` (second segment after `-`)                       |
 * | `txHash`        | `raw._links.transaction.href` (last path segment)         |
 * | `memo`          | Raw Horizon `transaction_attr.memo` if present, else null |
 * | `asset`         | `event.asset`                                             |
 * | `from`          | Payment: `event.from`; Trustline: `event.account`         |
 * | `to`            | Payment: `event.to`; Trustline: issuer from asset         |
 * | `raw`           | Full `event.raw` record for audit trail completeness      |
 *
 * ## Caveats
 *
 * - **Memo extraction is best-effort.** The Horizon SSE stream attaches memos
 *   at the transaction level; individual operation records may not carry a
 *   `memo` field. When absent, `memo` is `null`.
 * - **Native XLM trustlines.** For XLM trustlines, `asset` is `"XLM"` (no
 *   issuer), so `to` is set to the empty string.
 */
export function extractAuditRecord(event: NormalizedEvent): AuditRecord | null {
  const raw = event.raw as Record<string, unknown> | undefined;

  // Parse ledger and operation index from the raw operation ID.
  // Horizon operation IDs are formatted as "{ledger}-{operationIndex}".
  let ledger = 0;
  let operationIndex = 0;
  if (raw && typeof raw.id === "string") {
    const parts = raw.id.split("-");
    ledger = parseInt(parts[0] ?? "0", 10) || 0;
    operationIndex = parseInt(parts[1] ?? "0", 10) || 0;
  }

  // Extract transaction hash from the transaction link.
  let txHash = "";
  if (raw?._links && typeof raw._links === "object") {
    const links = raw._links as Record<string, unknown>;
    if (links.transaction && typeof links.transaction === "object") {
      const txLink = links.transaction as Record<string, unknown>;
      if (typeof txLink.href === "string") {
        // Href format: ".../transactions/{txHash}"
        const segments = txLink.href.split("/");
        txHash = segments[segments.length - 1] ?? "";
      }
    }
  }

  // Extract memo from the raw transaction attributes if present.
  // Best-effort: Horizon SSE may not include memo on individual ops.
  let memo: string | null = null;
  if (raw) {
    // Some Horizon responses include "transaction_attr" with a "memo" field.
    const txAttr = raw.transaction_attr as Record<string, unknown> | undefined;
    if (txAttr?.memo !== undefined) {
      memo = String(txAttr.memo);
    } else if (raw.memo !== undefined) {
      memo = String(raw.memo);
    }
  }

  // Build the audit record based on event type.
  switch (event.type) {
    case "payment.received":
    case "payment.sent":
    case "payment.self":
      return {
        ledger,
        txHash,
        operationIndex,
        memo,
        asset: event.asset,
        from: event.from,
        to: event.to,
        eventType: event.type,
        timestamp: event.timestamp,
        raw: event.raw,
      };

    case "trustline.added":
    case "trustline.removed":
    case "trustline.updated": {
      // Trustline events: `account` is the trustor, issuer is embedded in asset.
      // For native XLM, asset is "XLM" (no colon), so issuer is empty.
      const assetParts = event.asset.split(":");
      const issuer = assetParts.length > 1 ? (assetParts[1] ?? "") : "";
      return {
        ledger,
        txHash,
        operationIndex,
        memo,
        asset: event.asset,
        from: event.account, // trustor
        to: issuer, // issuer (empty string for native XLM)
        eventType: event.type,
        timestamp: event.timestamp,
        raw: event.raw,
      };
    }

    default:
      return null;
  }
}
