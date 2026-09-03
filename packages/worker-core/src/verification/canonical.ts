import type { ExportLedger, ExportOperation, ExportTransaction } from "../exports/types.js";

/**
 * The canonical, source-agnostic event that the verdict engine scores. Both
 * the export (backfill) path and the live path produce these via the *same*
 * canonicalization, which is what makes a backfilled verdict byte-identical to
 * a live-computed one: they are computed from identical {@link VerificationEvent}
 * inputs, never from two independently-written mappers.
 */

export type VerificationEventType =
  | "payment_sent"
  | "payment_received"
  | "payment_self"
  | "mint"
  | "burn"
  | "clawback"
  | "fee"
  | "set_authorized";

export type VerificationEvent = {
  ledger: number;
  closeTime: string;
  kind: VerificationEventType;
  subject: string;
  counterparty: string | null;
  asset: string;
  /** Canonical 7-decimal Stellar amount string (always non-negative). */
  amount: string;
  authorized: boolean | null;
  txHash: string | null;
};

/**
 * Normalize an amount string to a fixed 7-decimal form so "10.5", "10.50",
 * and "10.5000000" all canonicalize to "10.5000000". This is the linchpin of
 * byte-identical verdicts across export formats and the live path.
 */
export function canonicalAmount(amount: string): string {
  const s = amount.trim();
  const negative = s.startsWith("-");
  const abs = negative ? s.slice(1) : s;
  const parts = abs.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] ?? "").padEnd(7, "0").slice(0, 7);
  const num = `${whole}.${frac}`;
  return negative ? `-${num}` : num;
}

/** Normalize an asset string: `"native"` and `"XLM"` both become `"XLM"`. */
export function canonicalAsset(asset: string): string {
  const a = asset.trim();
  if (a === "native" || a === "XLM") return "XLM";
  return a;
}

/** Addresses are case-insensitive StrKey; uppercase for stable comparison. */
export function canonicalAddress(addr: string): string {
  return addr.trim().toUpperCase();
}

/** Stellar contract ids start with `C`; everything else is an account. */
export function inferSubjectType(subject: string): "account" | "contract" {
  return canonicalAddress(subject).startsWith("C") ? "contract" : "account";
}

/**
 * Which subject(s) an operation contributes reputation evidence for, and the
 * precise {@link VerificationEvent} shape for each. Shared by the export and
 * live mappers so the two paths cannot drift.
 */
export function mapOperationToVerificationEvents(
  op: ExportOperation,
  ledger: number,
  closeTime: string,
  txHash: string | null,
): VerificationEvent[] {
  const asset = "asset" in op ? canonicalAsset(op.asset) : canonicalAsset("XLM");
  const amount = "amount" in op ? canonicalAmount(op.amount) : "0";
  const make = (
    subject: string,
    kind: VerificationEventType,
    counterparty: string | null,
    authorized: boolean | null = null,
  ): VerificationEvent => ({
    ledger,
    closeTime,
    kind,
    subject: canonicalAddress(subject),
    counterparty: counterparty === null ? null : canonicalAddress(counterparty),
    asset,
    amount,
    authorized,
    txHash,
  });

  switch (op.kind) {
    case "payment": {
      const from = op.from;
      const to = op.to;
      if (canonicalAddress(from) === canonicalAddress(to)) {
        return [make(from, "payment_self", null)];
      }
      return [make(from, "payment_sent", to), make(to, "payment_received", from)];
    }
    case "mint":
      return [make(op.to, "mint", null)];
    case "burn":
      return [make(op.from, "burn", null)];
    case "clawback":
      return [make(op.from, "clawback", null)];
    case "fee":
      return [make(op.from, "fee", null, null)];
    case "set_authorized":
      return [make(op.trustor, "set_authorized", null, op.authorized)];
    default:
      return [];
  }
}

/** Export path: turn a parsed {@link ExportLedger} into verification events. */
export function fromExportLedger(ledger: ExportLedger): VerificationEvent[] {
  return fromTransactions(ledger.transactions, ledger.ledgerSequence, ledger.closeTime);
}

/**
 * Live path: pulse-core's normalized events already carry ledger context in
 * the live subscription envelope; the live verifier reduces them to
 * {@link ExportOperation}s and routes them through the *same*
 * {@link mapOperationToVerificationEvents} as the export path. The shape here
 * is the post-normalization operation list the live verifier supplies.
 */
export type LiveLedger = {
  ledger: number;
  closeTime: string;
  transactions: ExportTransaction[];
};

export function fromLiveLedger(live: LiveLedger): VerificationEvent[] {
  return fromTransactions(live.transactions, live.ledger, live.closeTime);
}

function fromTransactions(
  transactions: ExportTransaction[],
  ledger: number,
  closeTime: string,
): VerificationEvent[] {
  const out: VerificationEvent[] = [];
  for (const tx of transactions) {
    for (const op of tx.operations) {
      out.push(...mapOperationToVerificationEvents(op, ledger, closeTime, tx.transactionId));
    }
  }
  return out;
}
