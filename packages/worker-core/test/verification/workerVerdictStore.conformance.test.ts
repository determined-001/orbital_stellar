/**
 * Conformance test suite for WorkerFireVerdictStore backends (issue #1050).
 *
 * Every implementation (Memory, Postgres) must pass all cases here. Postgres
 * runs against the in-process `MockPg` fake in `workerVerdictStore.fakes.ts`,
 * so the suite is fully hermetic - no live server required - and proves the
 * remote adapter agrees with the Memory reference implementation, matching
 * `stateStore.conformance.test.ts`'s structure.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  WorkerFireVerdictStore,
  DuplicateVerdictRecordError,
  MissingCorrectionReasonError,
  type RecordVerdictInput,
} from "../../src/verification/WorkerFireVerdictStore.js";
import { MemoryWorkerVerdictStore } from "../../src/verification/MemoryWorkerVerdictStore.js";
import { PostgresWorkerVerdictStore } from "../../src/verification/PostgresWorkerVerdictStore.js";
import { MockPg } from "./workerVerdictStore.fakes.js";

function verdict(overrides: Partial<RecordVerdictInput> = {}): RecordVerdictInput {
  return {
    recordId: "w1:ev-1:v1",
    windowId: "w1:ev-1",
    workerId: "w1",
    operator: "GOPERATOR",
    conditionLedger: 100,
    deadlineLedger: 110,
    status: "fired",
    invocationLedger: 105,
    engineVersion: "@orbital-stellar/worker-core@0.1.0",
    ...overrides,
  };
}

function runConformanceTests(label: string, factory: () => WorkerFireVerdictStore) {
  describe(`WorkerFireVerdictStore conformance — ${label}`, () => {
    let store: WorkerFireVerdictStore;

    beforeEach(() => {
      store = factory();
    });

    it("records a verdict and reads it back as the latest for its window", async () => {
      await store.record(verdict());
      const latest = await store.getLatestForWindow("w1:ev-1");
      expect(latest).toMatchObject({ recordId: "w1:ev-1:v1", status: "fired" });
    });

    it("returns null for a window with no records", async () => {
      expect(await store.getLatestForWindow("nonexistent")).toBeNull();
    });

    it("stamps schemaVersion and recordedAt when not supplied", async () => {
      const before = Date.now();
      const record = await store.record(verdict());
      expect(record.schemaVersion).toBe(1);
      expect(new Date(record.recordedAt).getTime()).toBeGreaterThanOrEqual(before);
    });

    it("rejects a repeated recordId", async () => {
      await store.record(verdict());
      await expect(store.record(verdict())).rejects.toThrow(DuplicateVerdictRecordError);
    });

    it("rejects a correction with no correctionReason", async () => {
      await store.record(verdict());
      await expect(
        store.record(verdict({ recordId: "w1:ev-1:v2", status: "late", supersedes: "w1:ev-1:v1" })),
      ).rejects.toThrow(MissingCorrectionReasonError);
    });

    it("a correction (supersedes + reason) becomes the latest, without mutating the original", async () => {
      await store.record(verdict());
      await store.record(
        verdict({
          recordId: "w1:ev-1:v2",
          status: "late",
          invocationLedger: 115,
          latencyLedgers: 5,
          supersedes: "w1:ev-1:v1",
          correctionReason: "engine v0.2.0 fixed a late-window off-by-one",
        }),
      );

      const latest = await store.getLatestForWindow("w1:ev-1");
      expect(latest).toMatchObject({ recordId: "w1:ev-1:v2", status: "late" });

      const history = await store.getHistoryForWindow("w1:ev-1");
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ recordId: "w1:ev-1:v1", status: "fired" });
      expect(history[1]).toMatchObject({ recordId: "w1:ev-1:v2", status: "late" });
    });

    it("getHistoryForWindow returns every record oldest-first, including superseded ones", async () => {
      await store.record(verdict());
      await store.record(
        verdict({
          recordId: "w1:ev-1:v2",
          supersedes: "w1:ev-1:v1",
          correctionReason: "correction",
        }),
      );
      const history = await store.getHistoryForWindow("w1:ev-1");
      expect(history.map((r) => r.recordId)).toEqual(["w1:ev-1:v1", "w1:ev-1:v2"]);
    });

    it("queryByWorker returns only that worker's latest-per-window verdicts", async () => {
      await store.record(verdict({ recordId: "w1:ev-1:v1", workerId: "w1", windowId: "w1:ev-1" }));
      await store.record(verdict({ recordId: "w2:ev-1:v1", workerId: "w2", windowId: "w2:ev-1" }));

      const results = await store.queryByWorker("w1");
      expect(results.map((r) => r.recordId)).toEqual(["w1:ev-1:v1"]);
    });

    it("queryByWorker excludes a superseded record and includes its correction", async () => {
      await store.record(verdict({ recordId: "w1:ev-1:v1", windowId: "w1:ev-1" }));
      await store.record(
        verdict({
          recordId: "w1:ev-1:v2",
          windowId: "w1:ev-1",
          status: "late",
          supersedes: "w1:ev-1:v1",
          correctionReason: "correction",
        }),
      );

      const results = await store.queryByWorker("w1");
      expect(results.map((r) => r.recordId)).toEqual(["w1:ev-1:v2"]);
    });

    it("queryByWorker with latestOnly: false returns every record", async () => {
      await store.record(verdict({ recordId: "w1:ev-1:v1", windowId: "w1:ev-1" }));
      await store.record(
        verdict({
          recordId: "w1:ev-1:v2",
          windowId: "w1:ev-1",
          supersedes: "w1:ev-1:v1",
          correctionReason: "correction",
        }),
      );

      const results = await store.queryByWorker("w1", { latestOnly: false });
      expect(results.map((r) => r.recordId).sort()).toEqual(["w1:ev-1:v1", "w1:ev-1:v2"]);
    });

    it("queryByOperator returns every worker belonging to that operator", async () => {
      await store.record(
        verdict({ recordId: "w1:ev-1:v1", workerId: "w1", windowId: "w1:ev-1", operator: "GOP1" }),
      );
      await store.record(
        verdict({ recordId: "w2:ev-1:v1", workerId: "w2", windowId: "w2:ev-1", operator: "GOP1" }),
      );
      await store.record(
        verdict({ recordId: "w3:ev-1:v1", workerId: "w3", windowId: "w3:ev-1", operator: "GOP2" }),
      );

      const results = await store.queryByOperator("GOP1");
      expect(results.map((r) => r.workerId).sort()).toEqual(["w1", "w2"]);
    });

    it("queryByLedgerRange returns verdicts whose window overlaps the range", async () => {
      await store.record(
        verdict({
          recordId: "in-range",
          windowId: "in-range",
          conditionLedger: 100,
          deadlineLedger: 110,
        }),
      );
      await store.record(
        verdict({
          recordId: "out-of-range",
          windowId: "out-of-range",
          conditionLedger: 500,
          deadlineLedger: 510,
        }),
      );

      const results = await store.queryByLedgerRange(90, 120);
      expect(results.map((r) => r.recordId)).toEqual(["in-range"]);
    });

    it("queryByWorker bounded by fromLedger/toLedger excludes a window entirely outside the bound", async () => {
      await store.record(
        verdict({
          recordId: "early",
          windowId: "early",
          conditionLedger: 10,
          deadlineLedger: 20,
        }),
      );
      await store.record(
        verdict({
          recordId: "late-window",
          windowId: "late-window",
          conditionLedger: 200,
          deadlineLedger: 210,
        }),
      );

      const results = await store.queryByWorker("w1", { fromLedger: 100, toLedger: 300 });
      expect(results.map((r) => r.recordId)).toEqual(["late-window"]);
    });
  });
}

runConformanceTests("Memory", () => new MemoryWorkerVerdictStore());
runConformanceTests("Postgres (MockPg)", () => new PostgresWorkerVerdictStore(new MockPg()));
