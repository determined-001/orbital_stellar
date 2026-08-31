import { promises as fsPromises, type Dirent } from "fs";
import path from "path";
import {
  WorkerStateStore,
  WORKER_STATE_SCHEMA_VERSION,
  type WorkerState,
  type RegisterWorkerInput,
  type AppendFireRecordInput,
  type WriteClaimInput,
  type ReleaseClaimInput,
} from "./WorkerStateStore.js";

/** Minimal logger interface (same shape as pulse-core Logger). */
export interface Logger {
  warn(msg: string, meta?: Record<string, unknown>): void;
}

function safeFilename(workerId: string): string {
  return encodeURIComponent(workerId) + ".json";
}

/**
 * File-system implementation of {@link WorkerStateStore}.
 *
 * Each worker's state is stored as a single JSON file under `dir`, named
 * `<encodeURIComponent(workerId)>.json`. Writes use an atomic tmp→rename
 * pattern to prevent partial-write corruption.
 *
 * Fire history is append-only: reads always deserialize the full record and
 * the write path only ever pushes to the `fireHistory` array.
 */
export class FileWorkerStateStore extends WorkerStateStore {
  readonly #dir: string;
  readonly #logger?: Logger;

  constructor(dir: string, logger?: Logger) {
    super();
    this.#dir = dir;
    this.#logger = logger;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  #filePathFor(workerId: string): string {
    return path.join(this.#dir, safeFilename(workerId));
  }

  async #ensureDir(): Promise<void> {
    await fsPromises.mkdir(this.#dir, { recursive: true });
  }

  async #readRaw(workerId: string): Promise<WorkerState | null> {
    const file = this.#filePathFor(workerId);
    try {
      const data = await fsPromises.readFile(file, "utf8");
      try {
        const parsed = JSON.parse(data) as WorkerState;
        if (parsed && typeof parsed.workerId === "string") return parsed;
        return null;
      } catch {
        this.#logger?.warn(
          `FileWorkerStateStore: failed to parse state file ${file}, treating as missing`,
          { file },
        );
        return null;
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async #writeAtomic(workerId: string, state: WorkerState): Promise<void> {
    await this.#ensureDir();
    const file = this.#filePathFor(workerId);
    const tmp = `${file}.tmp-${Math.random().toString(36).slice(2)}`;
    const payload = JSON.stringify(state, null, 2);

    const fd = await fsPromises.open(tmp, "w");
    try {
      await fd.writeFile(payload, "utf8");
      await fd.sync();
    } finally {
      await fd.close();
    }

    await fsPromises.rename(tmp, file);

    // fsync the directory to make the rename durable (best-effort)
    try {
      const dirFd = await fsPromises.open(this.#dir, "r");
      try {
        // @ts-expect-error - access internal numeric fd for fsync
        await fsPromises.fsync((dirFd as unknown as { fd: number }).fd);
      } catch {
        // ignore: not all platforms support fsync on directories
      } finally {
        await dirFd.close();
      }
    } catch {
      // ignore
    }
  }

  // -------------------------------------------------------------------------
  // WorkerStateStore interface
  // -------------------------------------------------------------------------

  async getWorker(workerId: string): Promise<WorkerState | null> {
    return this.#readRaw(workerId);
  }

  async registerWorker(input: RegisterWorkerInput): Promise<WorkerState> {
    const existing = await this.#readRaw(input.workerId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const state: WorkerState = {
      schemaVersion: WORKER_STATE_SCHEMA_VERSION,
      workerId: input.workerId,
      registeredAt: input.registeredAt ?? now,
      updatedAt: now,
      lastFiredWindowStart: null,
      lastFiredWindowEnd: null,
      fireHistory: [],
      activeClaims: [],
      metadata: input.metadata ?? {},
    };
    await this.#writeAtomic(input.workerId, state);
    return state;
  }

  async appendFireRecord(input: AppendFireRecordInput): Promise<WorkerState> {
    const existing = await this.#readRaw(input.workerId);
    if (!existing) {
      throw new Error(
        `WorkerStateStore: worker "${input.workerId}" is not registered. Call registerWorker first.`,
      );
    }

    const now = new Date().toISOString();
    const updated: WorkerState = {
      ...existing,
      updatedAt: now,
      lastFiredWindowStart: input.record.windowStart,
      lastFiredWindowEnd: input.record.windowEnd,
      fireHistory: [...existing.fireHistory, input.record],
    };
    await this.#writeAtomic(input.workerId, updated);
    return updated;
  }

  async writeClaim(input: WriteClaimInput): Promise<WorkerState> {
    const existing = await this.#readRaw(input.workerId);
    if (!existing) {
      throw new Error(
        `WorkerStateStore: worker "${input.workerId}" is not registered. Call registerWorker first.`,
      );
    }

    const now = new Date().toISOString();
    const withoutExisting = existing.activeClaims.filter(
      (c) => c.windowId !== input.claim.windowId,
    );
    const updated: WorkerState = {
      ...existing,
      updatedAt: now,
      activeClaims: [...withoutExisting, input.claim],
    };
    await this.#writeAtomic(input.workerId, updated);
    return updated;
  }

  async releaseClaim(input: ReleaseClaimInput): Promise<WorkerState> {
    const existing = await this.#readRaw(input.workerId);
    if (!existing) {
      throw new Error(
        `WorkerStateStore: worker "${input.workerId}" is not registered. Call registerWorker first.`,
      );
    }

    const now = new Date().toISOString();
    const updated: WorkerState = {
      ...existing,
      updatedAt: now,
      activeClaims: existing.activeClaims.filter((c) => c.windowId !== input.windowId),
    };
    await this.#writeAtomic(input.workerId, updated);
    return updated;
  }

  override async getAllWorkers(): Promise<WorkerState[]> {
    let entries: Dirent[];
    try {
      entries = await fsPromises.readdir(this.#dir, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const results: WorkerState[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const workerId = decodeURIComponent(entry.name.slice(0, -".json".length));
      const state = await this.#readRaw(workerId);
      if (state !== null) results.push(state);
    }
    return results;
  }
}
