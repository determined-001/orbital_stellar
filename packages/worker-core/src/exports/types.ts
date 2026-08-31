/**
 * Shared export substrate for verification backfill (#1054) and long-range
 * replay (#920).
 *
 * Orbital operates **no ledger store of its own** (see design doc §B.5). Every
 * historical ledger is read from an external export - either a Galexie ledger
 * export or a Composable Data Platform (CDP) export - and never re-hosted. The
 * reader here is the single component both consumers depend on; backfill and
 * replay do not each bring their own.
 *
 * The reader is intentionally dumb about *meaning*: it turns a range of
 * ledgers into {@link ExportLedger} records in ledger order. Turning those
 * records into verification events (this package) or into replay injections
 * (#920) is the consumer's job, so the two never have to agree on a single
 * normalized shape to share the reader.
 */

/** Half-open ledger range `[startLedger, endLedger)`. */
export type LedgerRange = {
  startLedger: number;
  endLedger: number;
};

/** A canonical, source-agnostic operation pulled out of an export transaction. */
export type ExportOperation =
  | {
      kind: "payment";
      from: string;
      to: string;
      amount: string;
      asset: string;
    }
  | { kind: "mint"; to: string; amount: string; asset: string }
  | { kind: "burn"; from: string; amount: string; asset: string }
  | { kind: "clawback"; from: string; amount: string; asset: string }
  | { kind: "fee"; from: string; amount: string }
  | {
      kind: "set_authorized";
      trustor: string;
      asset: string;
      authorized: boolean;
    };

export type ExportTransaction = {
  transactionId: string;
  operations: ExportOperation[];
};

/**
 * One ledger as delivered by an export. `closeTime` is the RFC3339 ledger
 * close time; `ledgerSequence` is the absolute Stellar ledger number. The
 * reader guarantees callers never see two records for the same
 * `ledgerSequence`.
 */
export type ExportLedger = {
  ledgerSequence: number;
  closeTime: string;
  network: "mainnet" | "testnet";
  transactions: ExportTransaction[];
};

/** Where an {@link ExportLedger} came from - used for provenance in the PR body and logs. */
export type ExportSourceKind = "galexie" | "cdp" | "file";

/**
 * A readable ledger export. Implementations stream ledgers for a requested
 * {@link LedgerRange}; they must not retain the chain. Concrete
 * implementations: {@link FileExportSource} (local/object-storage JSONL) and
 * the in-memory source used by tests.
 */
export interface ExportSource {
  /** Human-readable provenance of the data (where it lives, who operates it). */
  describe(): { kind: ExportSourceKind; location: string };
  /**
   * List the ledger records covering `range`, in ascending `ledgerSequence`
   * order. Implementations may page internally; the contract is that every
   * ledger in `range` is yielded exactly once (deduplicated by the reader).
   */
  read(range: LedgerRange): AsyncIterable<ExportLedger>;
}

/**
 * Drives an {@link ExportSource}, deduplicates ledgers, and enforces range
 * bounds. This is the one reader reused by backfill and replay - neither
 * consumer re-implements ledger enumeration, paging, or dedupe.
 */
export class ExportReader {
  private readonly source: ExportSource;

  constructor(source: ExportSource) {
    this.source = source;
  }

  provenance(): { kind: ExportSourceKind; location: string } {
    return this.source.describe();
  }

  /**
   * Stream ledgers in `range`, ascending and deduplicated by
   * `ledgerSequence`. Ledgers outside `range` are dropped. A duplicate
   * ledger (same sequence from the source) yields only its first occurrence.
   */
  async *read(range: LedgerRange): AsyncIterable<ExportLedger> {
    const seen = new Set<number>();
    for await (const ledger of this.source.read(range)) {
      const seq = ledger.ledgerSequence;
      if (seq < range.startLedger || seq >= range.endLedger) continue;
      if (seen.has(seq)) continue;
      seen.add(seq);
      yield ledger;
    }
  }
}
