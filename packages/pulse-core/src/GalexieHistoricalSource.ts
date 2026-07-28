/**
 * Reference `HistoricalSource` adapter reading Galexie-exported ledger data
 * directly from an object-storage bucket (Composable Data Platform), per the
 * recommendation in `docs/design/long-range-replay.md`.
 *
 * **Illustrative, not verified-working.** Nothing in this file has been run
 * against a real Galexie export bucket - there is no Node.js runtime
 * available in the environment this was authored in (true of every change in
 * this session). Two things in particular are assumptions, not confirmed
 * facts, and are surfaced as configuration precisely because they're
 * unverified:
 *
 * 1. **Object key layout.** Galexie partitions exported ledgers into files
 *    covering a fixed-size ledger range each, but the exact key/path
 *    convention (prefix depth, zero-padding, extension) is operator/config
 *    dependent. `objectKeyForLedger` defaults to a plausible convention
 *    (`ledgers/{rangeStart}-{rangeEnd}.xdr.gz`) but callers pointing at a
 *    real bucket should supply their own based on that bucket's actual
 *    layout.
 * 2. **XDR accessor names.** The event-extraction path
 *    (`LedgerCloseMeta` → `txProcessing` → `TransactionMeta` v3 →
 *    `sorobanMeta().events()`) matches the public CAP-46/CAP-67 XDR schema
 *    as documented, but the exact generated accessor names in the installed
 *    `@stellar/stellar-sdk` version have not been checked against a live
 *    import.
 *
 * Both are called out again inline at the point they're used.
 */

import { gunzipSync } from "node:zlib";
import { xdr } from "@stellar/stellar-sdk";
import type { HistoricalReplayRange, HistoricalSource } from "./HistoricalSource.js";
import type { SorobanEvent } from "./SorobanSubscriber.js";

export type GalexieHistoricalSourceConfig = {
  /** Base URL of the export bucket, e.g. `https://storage.googleapis.com/my-galexie-bucket`. No trailing slash. */
  bucketBaseUrl: string;
  /** How many ledgers each exported file covers. Galexie's own default is operator-configured; verify against the actual bucket before relying on this. */
  ledgersPerFile?: number;
  /**
   * Computes the object key for the partition file covering
   * `[rangeStart, rangeEnd)`. Defaults to a plausible-but-unverified
   * convention - see this module's doc comment. Override with the real
   * bucket's actual layout.
   */
  objectKeyForLedger?: (rangeStart: number, rangeEnd: number) => string;
  /** Fetch implementation. Defaults to the global fetch. */
  transport?: typeof fetch;
};

const DEFAULT_LEDGERS_PER_FILE = 64;

function defaultObjectKey(rangeStart: number, rangeEnd: number): string {
  return `ledgers/${rangeStart}-${rangeEnd}.xdr.gz`;
}

/** Thrown when an exported partition file can't be fetched or parsed - distinct from "range not covered at all" (see `canServe`). */
export class GalexiePartitionError extends Error {
  constructor(objectKey: string, cause: unknown) {
    super(
      `[pulse-core] GalexieHistoricalSource: failed to fetch/parse partition "${objectKey}": ` +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    this.name = "GalexiePartitionError";
  }
}

export class GalexieHistoricalSource implements HistoricalSource {
  readonly name = "galexie";

  private readonly bucketBaseUrl: string;
  private readonly ledgersPerFile: number;
  private readonly objectKeyForLedger: (rangeStart: number, rangeEnd: number) => string;
  private readonly transport: typeof fetch;

  constructor(config: GalexieHistoricalSourceConfig) {
    this.bucketBaseUrl = config.bucketBaseUrl.replace(/\/+$/, "");
    this.ledgersPerFile = config.ledgersPerFile ?? DEFAULT_LEDGERS_PER_FILE;
    this.objectKeyForLedger = config.objectKeyForLedger ?? defaultObjectKey;
    this.transport = config.transport ?? fetch.bind(globalThis);
  }

  async canServe(range: HistoricalReplayRange): Promise<boolean> {
    const [firstPartition] = this.partitionsFor(range.startLedger, range.endLedger);
    if (!firstPartition) return false;
    try {
      const res = await this.transport(this.urlFor(firstPartition), { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async *replay(range: HistoricalReplayRange): AsyncIterable<SorobanEvent> {
    const contractFilter = range.contractIds ? new Set(range.contractIds) : undefined;

    for (const [partitionStart, partitionEnd] of this.partitionsFor(
      range.startLedger,
      range.endLedger,
    )) {
      const objectKey = this.objectKeyForLedger(partitionStart, partitionEnd);
      const events = await this.fetchPartitionEvents(objectKey);

      for (const event of events) {
        if (event.ledger === undefined) continue;
        if (event.ledger < range.startLedger || event.ledger >= range.endLedger) continue;
        if (contractFilter && (!event.contractId || !contractFilter.has(event.contractId))) {
          continue;
        }
        yield event;
      }
    }
  }

  /** Partition boundaries `[start, end)` covering `[startLedger, endLedger)`, in ascending order. */
  private partitionsFor(startLedger: number, endLedger: number): Array<[number, number]> {
    const partitions: Array<[number, number]> = [];
    let cursor = Math.floor(startLedger / this.ledgersPerFile) * this.ledgersPerFile;
    while (cursor < endLedger) {
      partitions.push([cursor, cursor + this.ledgersPerFile]);
      cursor += this.ledgersPerFile;
    }
    return partitions;
  }

  private urlFor(partition: [number, number]): string {
    return `${this.bucketBaseUrl}/${this.objectKeyForLedger(partition[0], partition[1])}`;
  }

  private async fetchPartitionEvents(objectKey: string): Promise<SorobanEvent[]> {
    const url = `${this.bucketBaseUrl}/${objectKey}`;
    try {
      const res = await this.transport(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
      }
      const compressed = Buffer.from(await res.arrayBuffer());
      const raw = gunzipSync(compressed);
      return extractSorobanEvents(raw);
    } catch (err) {
      throw new GalexiePartitionError(objectKey, err);
    }
  }
}

/**
 * Parses a Galexie-exported `LedgerCloseMetaBatch` XDR blob and extracts
 * every contract event across every ledger/transaction in it.
 *
 * **Unverified accessor names** - see this module's doc comment. Wrapped so
 * a schema mismatch surfaces as a clear parse failure (via
 * `GalexiePartitionError`, from the caller) rather than a silent empty
 * result or an opaque TypeError deep in XDR internals.
 */
function extractSorobanEvents(raw: Buffer): SorobanEvent[] {
  const batch = xdr.LedgerCloseMetaBatch.fromXDR(raw);
  const events: SorobanEvent[] = [];

  for (const meta of batch.ledgerCloseMetas()) {
    const arm = meta.switch().name;
    if (arm === "ledgerCloseMetaV0") {
      // v0 predates Soroban entirely (no contract events possible) - skip rather than guess its shape.
      continue;
    }
    const v = arm === "ledgerCloseMetaV2" ? meta.v2() : meta.v1();
    const ledgerSeq = v.ledgerHeader().header().ledgerSeq();
    const closeTime = v.ledgerHeader().header().scpValue().closeTime().toString();

    for (const txProcessing of v.txProcessing()) {
      const txMeta = txProcessing.txApplyProcessing();
      if (txMeta.switch().value !== 3) continue; // only TransactionMetaV3 carries sorobanMeta

      const sorobanMeta = txMeta.v3().sorobanMeta();
      if (!sorobanMeta) continue;

      for (const contractEvent of sorobanMeta.events()) {
        const body = contractEvent.body().v0();
        const topics = body
          .topics()
          .map((t) => xdr.ScVal.toXDR(t).toString("base64"));

        events.push({
          id: `${ledgerSeq}-${events.length}`,
          pagingToken: `${ledgerSeq}-${events.length}`,
          topic: topics,
          value: body.data(),
          contractId: contractEvent.contractId()?.toString(),
          type: "contract",
          ledger: ledgerSeq,
          ledgerClosedAt: closeTime,
        });
      }
    }
  }

  return events;
}
