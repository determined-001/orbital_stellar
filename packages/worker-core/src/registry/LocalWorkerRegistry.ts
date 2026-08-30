/**
 * Local file-backed worker registry for offline resolution of operator and
 * offering records. Mirrors the pattern of {@link LocalAbiRegistryClient}
 * from the abi-registry package.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateOperatorRecord, validateWorkerOfferingRecord } from "@orbital-stellar/abi-registry";
import type { OperatorRecord, WorkerOfferingRecord } from "@orbital-stellar/abi-registry";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Local file-backed worker registry client. Reads operator and offering
 * records from a local directory tree. Useful for offline resolution,
 * testing, and bundling known records.
 */
export class LocalWorkerRegistry {
  private readonly basePath: string;

  constructor(options?: { basePath?: string }) {
    this.basePath = options?.basePath ?? resolve(__dirname, "../../data");
  }

  /**
   * Resolve an operator record from a local JSON file. Returns `null` if
   * the file does not exist or validation fails.
   */
  resolveOperator(id: string): OperatorRecord | null {
    try {
      const filePath = resolve(this.basePath, `operators/${id}.json`);
      const raw = readFileSync(filePath, "utf-8");
      const json = JSON.parse(raw);
      const result = validateOperatorRecord(json);
      if (!result.valid) return null;
      return json as OperatorRecord;
    } catch {
      return null;
    }
  }

  /**
   * Resolve a worker offering record from a local JSON file. Returns
   * `null` if the file does not exist or validation fails.
   */
  resolveOffering(id: string): WorkerOfferingRecord | null {
    try {
      const filePath = resolve(this.basePath, `offerings/${id}.json`);
      const raw = readFileSync(filePath, "utf-8");
      const json = JSON.parse(raw);
      const result = validateWorkerOfferingRecord(json);
      if (!result.valid) return null;
      return json as WorkerOfferingRecord;
    } catch {
      return null;
    }
  }
}
