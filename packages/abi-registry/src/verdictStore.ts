import type { SchemaFieldDiff } from "./verifySchema.js";

export type VerdictStatus = "verified" | "mismatch" | "unverifiable";

export type VerdictRecord = {
  contractId: string;
  status: VerdictStatus;
  verifiedAt: string;
  previousStatus?: VerdictStatus;
  diffs?: SchemaFieldDiff[];
  reason?: string;
  attestedBy?: string[];
  specVersion?: string;
};

export interface VerdictStore {
  record(verdict: VerdictRecord): Promise<void>;
  getLatest(contractId: string): Promise<VerdictRecord | null>;
  getAll(): Promise<VerdictRecord[]>;
  getHistory(contractId: string): Promise<VerdictRecord[]>;
}

export class InMemoryVerdictStore implements VerdictStore {
  private readonly records: Map<string, VerdictRecord[]> = new Map();

  async record(verdict: VerdictRecord): Promise<void> {
    const existing = this.records.get(verdict.contractId) ?? [];
    existing.push(verdict);
    this.records.set(verdict.contractId, existing);
  }

  async getLatest(contractId: string): Promise<VerdictRecord | null> {
    const existing = this.records.get(contractId);
    if (!existing || existing.length === 0) return null;
    return existing[existing.length - 1]!;
  }

  async getAll(): Promise<VerdictRecord[]> {
    const all: VerdictRecord[] = [];
    for (const records of this.records.values()) {
      const latest = records[records.length - 1];
      if (latest) all.push(latest);
    }
    return all;
  }

  async getHistory(contractId: string): Promise<VerdictRecord[]> {
    return this.records.get(contractId) ?? [];
  }
}
