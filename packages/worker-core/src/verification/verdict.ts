import { createHash } from "node:crypto";
import type { VerificationEvent, VerificationEventType } from "./canonical.js";
import { canonicalAddress, canonicalAsset, inferSubjectType } from "./canonical.js";

export const VERDICT_SCHEMA_VERSION = 1 as const;

export type VerdictWindow = {
  startLedger: number;
  endLedger: number;
  startCloseTime: string | null;
  endCloseTime: string | null;
};

export type VerdictMetrics = {
  eventCount: number;
  firstLedger: number | null;
  lastLedger: number | null;
  counts: Record<VerificationEventType, number>;
  /** Net signed volume per asset (canonical 7-decimal string). */
  volumeByAsset: Record<string, string>;
  distinctCounterparties: number;
  setAuthorizedTrue: number;
  setAuthorizedFalse: number;
};

export type VerdictSource = "live" | "backfill";

export type Verdict = {
  schemaVersion: typeof VERDICT_SCHEMA_VERSION;
  subject: string;
  subjectType: "account" | "contract";
  window: VerdictWindow;
  metrics: VerdictMetrics;
  /** SHA-256 (hex) over the canonical core. Identical for live + backfill over the same range. */
  fingerprint: string;
  /** Marks where the verdict came from. Backfilled verdicts carry `"backfill"`. */
  source: VerdictSource;
  /** ISO timestamp the verdict was produced. Excluded from the fingerprint. */
  computedAt: string;
};

const EMPTY_COUNTS = (): Record<VerificationEventType, number> => ({
  payment_sent: 0,
  payment_received: 0,
  payment_self: 0,
  mint: 0,
  burn: 0,
  clawback: 0,
  fee: 0,
  set_authorized: 0,
});

/** Signed stroop contribution of a verification event to an asset's net volume. */
function signedStroops(ev: VerificationEvent): bigint {
  const negative = ev.amount.startsWith("-");
  const abs = negative ? ev.amount.slice(1) : ev.amount;
  const [whole, frac] = abs.split(".");
  const stroops = BigInt(whole || "0") * 10_000_000n + BigInt(frac || "0");
  const sign = negative ? -1n : 1n;
  switch (ev.kind) {
    case "payment_sent":
    case "burn":
    case "clawback":
    case "fee":
      return -sign * stroops;
    case "payment_received":
    case "mint":
      return sign * stroops;
    default:
      return 0n;
  }
}

function formatStroops(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / 10_000_000n;
  const frac = abs % 10_000_000n;
  const num = `${whole}.${frac.toString().padStart(7, "0")}`;
  return negative ? `-${num}` : num;
}

/**
 * Compute a deterministic verdict for `subject` over `window` from a list of
 * canonical {@link VerificationEvent}s.
 *
 * This is the **single** scoring function used by both the live verifier and
 * the backfill runner. Because the inputs are already canonicalized (see
 * `canonical.ts`) and the metrics below are order-independent, the resulting
 * `fingerprint` - and therefore the verdict core - is byte-identical whether
 * the events arrived over RPC or were read from a Galexie/CDP export.
 */
export function computeVerdict(
  subject: string,
  window: { startLedger: number; endLedger: number },
  events: VerificationEvent[],
  opts?: { source?: VerdictSource; computedAt?: string },
): Verdict {
  const counts = EMPTY_COUNTS();
  const volume = new Map<string, bigint>();
  const counterparties = new Set<string>();
  let setAuthorizedTrue = 0;
  let setAuthorizedFalse = 0;
  let firstLedger: number | null = null;
  let lastLedger: number | null = null;
  let startCloseTime: string | null = null;
  let endCloseTime: string | null = null;

  for (const ev of events) {
    counts[ev.kind] += 1;
    const asset = canonicalAsset(ev.asset);
    const s = signedStroops({ ...ev, asset });
    if (s !== 0n) volume.set(asset, (volume.get(asset) ?? 0n) + s);
    if (ev.counterparty) counterparties.add(canonicalAddress(ev.counterparty));
    if (ev.kind === "set_authorized") {
      if (ev.authorized) setAuthorizedTrue += 1;
      else setAuthorizedFalse += 1;
    }
    if (firstLedger === null || ev.ledger < firstLedger) firstLedger = ev.ledger;
    if (lastLedger === null || ev.ledger > lastLedger) lastLedger = ev.ledger;
    if (startCloseTime === null || ev.closeTime < startCloseTime) startCloseTime = ev.closeTime;
    if (endCloseTime === null || ev.closeTime > endCloseTime) endCloseTime = ev.closeTime;
  }

  const volumeByAsset: Record<string, string> = {};
  for (const [asset, stroops] of [...volume.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    volumeByAsset[asset] = formatStroops(stroops);
  }

  const metrics: VerdictMetrics = {
    eventCount: events.length,
    firstLedger,
    lastLedger,
    counts,
    volumeByAsset,
    distinctCounterparties: counterparties.size,
    setAuthorizedTrue,
    setAuthorizedFalse,
  };

  const canonicalSubject = canonicalAddress(subject);
  const core = verdictCore(canonicalSubject, window, metrics);
  const fingerprint = createHash("sha256").update(core).digest("hex");

  return {
    schemaVersion: VERDICT_SCHEMA_VERSION,
    subject: canonicalSubject,
    subjectType: inferSubjectType(subject),
    window: {
      startLedger: window.startLedger,
      endLedger: window.endLedger,
      startCloseTime,
      endCloseTime,
    },
    metrics,
    fingerprint,
    source: opts?.source ?? "backfill",
    computedAt: opts?.computedAt ?? new Date().toISOString(),
  };
}

/**
 * The canonical, source-independent core of a verdict. This string is what the
 * `fingerprint` is hashed from, and is what "byte-identical" compares. It
 * deliberately excludes `source` and `computedAt`, so a backfilled verdict and
 * a live verdict over the same (subject, window, events) produce the same
 * bytes here even though their `source` marker differs.
 */
export function verdictCore(
  subject: string,
  window: { startLedger: number; endLedger: number },
  metrics: VerdictMetrics,
): string {
  return JSON.stringify({
    v: VERDICT_SCHEMA_VERSION,
    subject: canonicalAddress(subject),
    subjectType: inferSubjectType(subject),
    window: { startLedger: window.startLedger, endLedger: window.endLedger },
    metrics,
  });
}

/** Stable comparison helper: the core bytes (a string) of a verdict. */
export function verdictCoreBytes(v: Verdict): string {
  return verdictCore(
    v.subject,
    { startLedger: v.window.startLedger, endLedger: v.window.endLedger },
    v.metrics,
  );
}
