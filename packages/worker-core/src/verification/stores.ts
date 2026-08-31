import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Verdict } from "./verdict.js";

/**
 * Where backfilled verdicts land. Implementations upsert by a stable key so a
 * re-run (or a resume) overwrites the previous record rather than appending a
 * duplicate - this is what makes the backfill idempotent. Orbital does not
 * keep a ledger here; the sink holds *verdicts*, which are small and derived.
 */
export interface VerdictSink {
  /** Persist (or overwrite) a verdict. Keyed by subject + window. */
  upsert(verdict: Verdict): Promise<void>;
  /** Read the latest verdict for a subject+window, if any. */
  get(subject: string, windowStart: number, windowEnd: number): Promise<Verdict | null>;
  /** All verdicts currently held. */
  all(): Promise<Verdict[]>;
}

/** Stable, filesystem-safe key for a verdict. */
export function verdictKey(subject: string, windowStart: number, windowEnd: number): string {
  return `${subject}|${windowStart}-${windowEnd}`;
}

export class InMemoryVerdictSink implements VerdictSink {
  private readonly map = new Map<string, Verdict>();
  async upsert(verdict: Verdict): Promise<void> {
    this.map.set(
      verdictKey(verdict.subject, verdict.window.startLedger, verdict.window.endLedger),
      verdict,
    );
  }
  async get(subject: string, windowStart: number, windowEnd: number): Promise<Verdict | null> {
    return this.map.get(verdictKey(subject, windowStart, windowEnd)) ?? null;
  }
  async all(): Promise<Verdict[]> {
    return [...this.map.values()];
  }
}

/**
 * File-backed sink: one JSON file per verdict, named by its key. Idempotent by
 * construction - re-upserting rewrites the same file. No ledger is stored,
 * only the derived verdicts.
 */
export class FileVerdictSink implements VerdictSink {
  private readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }
  private path(key: string): string {
    return join(this.dir, `${encodeURIComponent(key)}.json`);
  }
  async upsert(verdict: Verdict): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const key = verdictKey(verdict.subject, verdict.window.startLedger, verdict.window.endLedger);
    await writeFile(this.path(key), JSON.stringify(verdict, null, 2), "utf8");
  }
  async get(subject: string, windowStart: number, windowEnd: number): Promise<Verdict | null> {
    const key = verdictKey(subject, windowStart, windowEnd);
    const p = this.path(key);
    if (!existsSync(p)) return null;
    return JSON.parse(await readFile(p, "utf8")) as Verdict;
  }
  async all(): Promise<Verdict[]> {
    if (!existsSync(this.dir)) return [];
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    const out: Verdict[] = [];
    for (const f of files)
      out.push(JSON.parse(await readFile(join(this.dir, f), "utf8")) as Verdict);
    return out;
  }
}

/**
 * Resume state for a backfill. Only the highest *fully flushed* ledger is
 * recorded, so a crash mid-window reprocesses at most one window (idempotently).
 */
export type BackfillCheckpoint = {
  lastProcessedLedger: number;
  updatedAt: string;
};

export interface CheckpointStore {
  load(): Promise<BackfillCheckpoint | null>;
  save(state: BackfillCheckpoint): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private state: BackfillCheckpoint | null = null;
  async load(): Promise<BackfillCheckpoint | null> {
    return this.state;
  }
  async save(state: BackfillCheckpoint): Promise<void> {
    this.state = state;
  }
  async clear(): Promise<void> {
    this.state = null;
  }
}

export class FileCheckpointStore implements CheckpointStore {
  private readonly file: string;
  constructor(dir: string) {
    this.file = join(dir, "backfill-checkpoint.json");
  }
  async load(): Promise<BackfillCheckpoint | null> {
    if (!existsSync(this.file)) return null;
    return JSON.parse(await readFile(this.file, "utf8")) as BackfillCheckpoint;
  }
  async save(state: BackfillCheckpoint): Promise<void> {
    await mkdir(join(this.file, ".."), { recursive: true });
    await writeFile(this.file, JSON.stringify(state, null, 2), "utf8");
  }
  async clear(): Promise<void> {
    if (existsSync(this.file)) {
      const { unlink } = await import("node:fs/promises");
      await unlink(this.file);
    }
  }
}
