import { createWriteStream, type WriteStream } from "fs";
import { open, mkdir, stat } from "fs/promises";
import { createInterface } from "readline";
import path from "path";
import { fsync } from "fs";

/**
 * A single record in the append-only audit log.
 *
 * Every record is a self-contained snapshot of one on-chain event relevant to
 * an anchor's distribution accounts: who paid whom, which asset, on which
 * ledger, and every piece of metadata needed for a compliance auditor to
 * reconstruct the exact transaction later.
 */
export interface AuditRecord {
  /** The ledger sequence number where this event occurred. */
  ledger: number;
  /** The transaction hash (hex string) of the enclosing transaction. */
  txHash: string;
  /** Zero-based operation index within the transaction. */
  operationIndex: number;
  /**
   * Memo attached to the transaction, or null when absent.
   *
   * **Best-effort.** The Horizon SSE stream attaches memos at the transaction
   * level; individual operation records in the raw payload may not carry a
   * memo field. When Horizon does not include memo data on the operation,
   * this field is `null`.
   */
  memo: string | null;
  /** The Stellar asset code (e.g. "USDC:GABC..." or "XLM"). */
  asset: string;
  /** Source account in the operation (sender for payments, trustor for trustlines). */
  from: string;
  /** Destination account in the operation (receiver for payments, issuer for trustlines). */
  to: string;
  /** Normalized event type (e.g. "payment.received", "trustline.added"). */
  eventType: string;
  /** ISO 8601 timestamp of the ledger close time. */
  timestamp: string;
  /** The full raw Horizon operation record, for audit trail completeness. */
  raw: unknown;
}

/** Options for the {@link AuditLogWriter}. */
export interface AuditLogWriterOptions {
  /** Path to the audit log file (will be created if it does not exist). */
  filePath: string;
  /**
   * When true, every `append()` call is followed by an `fsync` on the file
   * descriptor so the record is durable before the promise resolves. Defaults
   * to `false` for throughput; enable when every record must survive a crash.
   */
  fsyncOnAppend?: boolean;
}

/**
 * Append-only JSON Lines audit log.
 *
 * Every record is written as one line of deterministic JSON (sorted keys) so
 * that replay from a given cursor produces byte-identical output. The writer
 * opens the file in append mode and flushes after every write.
 *
 * **Thread safety.** This writer is NOT safe for concurrent use from multiple
 * processes or worker threads writing to the same file. If you need multiprocess
 * durability, use a database-backed append-only store instead.
 */
export class AuditLogWriter {
  private stream: WriteStream | null = null;
  private fd: number | null = null;
  private readonly filePath: string;
  private readonly fsyncOnAppend: boolean;
  private _recordCount = 0;

  constructor(options: AuditLogWriterOptions) {
    this.filePath = options.filePath;
    this.fsyncOnAppend = options.fsyncOnAppend ?? false;
  }

  /**
   * Opens the underlying file for appending. Call once before `append()`.
   * Idempotent - safe to call multiple times.
   */
  async open(): Promise<void> {
    if (this.stream !== null) return;

    await mkdir(path.dirname(this.filePath), { recursive: true });

    this.stream = createWriteStream(this.filePath, { flags: "a", encoding: "utf8" });

    // Resolve the raw fd for optional fsync.
    await new Promise<void>((resolve, reject) => {
      this.stream!.once("open", (fd: number) => {
        this.fd = fd;
        resolve();
      });
      this.stream!.once("error", reject);
    });
  }

  /**
   * Appends a single audit record to the log.
   *
   * The record is serialized with sorted keys for deterministic output, and a
   * trailing newline is appended to form a valid JSON Lines entry.
   */
  async append(record: AuditRecord): Promise<void> {
    if (this.stream === null) {
      throw new Error("AuditLogWriter is not open. Call open() first.");
    }

    const line = JSON.stringify(record, sortedKeysReplacer) + "\n";

    await new Promise<void>((resolve, reject) => {
      const ok = this.stream!.write(line, (err: Error | null | undefined) => {
        if (err) return reject(err);
        if (this.fsyncOnAppend && this.fd !== null) {
          fsync(this.fd, (syncErr: Error | null) => {
            if (syncErr) return reject(syncErr);
            this._recordCount++;
            resolve();
          });
        } else {
          this._recordCount++;
          resolve();
        }
      });
      if (!ok) {
        // Drain the stream before accepting more writes.
        this.stream!.once("drain", () => resolve());
      }
    });
  }

  /** Number of records appended since the writer was opened. */
  get recordCount(): number {
    return this._recordCount;
  }

  /**
   * Flushes and closes the underlying file. Safe to call even if not open.
   * After `close()`, further `append()` calls will throw.
   */
  async close(): Promise<void> {
    if (this.stream === null) return;
    await new Promise<void>((resolve) => {
      this.stream!.end(resolve);
    });
    this.stream = null;
    this.fd = null;
  }
}

/**
 * Reads an audit log file and yields every record in insertion order.
 *
 * Uses a streaming readline interface so it works on large files without
 * loading the entire log into memory.
 *
 * @param filePath - Path to the JSON Lines audit log.
 * @returns An async generator of {@link AuditRecord} objects.
 */
export async function* readAuditLog(filePath: string): AsyncGenerator<AuditRecord> {
  const fh = await open(filePath, "r");
  const stream = fh.createReadStream({ encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      yield JSON.parse(trimmed) as AuditRecord;
    }
  } finally {
    rl.close();
    await fh.close();
  }
}

/**
 * Returns the number of records in an audit log file.
 *
 * Counts newline characters, which is O(n) in file size but accurate for any
 * valid JSON Lines file.
 */
export async function countAuditLogRecords(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    if (s.size === 0) return 0;
  } catch {
    return 0;
  }

  let count = 0;
  const fh = await open(filePath, "r");
  const stream = fh.createReadStream({ encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (line.trim().length > 0) count++;
    }
  } finally {
    rl.close();
    await fh.close();
  }

  return count;
}

/**
 * JSON.stringify replacer that forces sorted keys for deterministic output.
 *
 * When events are replayed from the same cursor, the underlying Horizon data
 * is identical, so deterministic serialization guarantees byte-identical audit
 * log output.
 */
function sortedKeysReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
