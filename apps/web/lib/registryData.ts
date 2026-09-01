// Read-only access to the open taxonomy/label data (`data/taxonomy.json`,
// `data/labels.json`) for the hosted registry read API. Mirrors
// `docs/search`'s memoized-corpus pattern: the files are build-time static,
// so each is parsed once per process rather than on every request.

import fs from "fs";
import path from "path";

export type TaxonomyRecord = {
  id: string;
  name: string;
  type: string;
  category: string;
  eventType: string;
  description: string;
  source: string;
};

export type LabelRecord = {
  contractId: string;
  name: string;
  description: string;
  network: string;
  tags: string[];
  category: string;
  verified: boolean;
  specFile: string;
};

type DataFile<T> = {
  schemaVersion: string;
  generatedAt: string;
  recordCount: number;
  records: T[];
};

// These routes are dynamic (they read `request.nextUrl`/`clientIp`), so this
// read happens per request in the deployed function, not at build time.
// Reaching two levels above `apps/web` for the repo-root `data/` directory
// works in CI (full repo checked out) but not in production: Next's file
// tracing has no way to discover a dynamically-constructed path outside the
// app root, so it isn't bundled and the read 404s at runtime. `apps/web/public/data/`
// is the in-app copy `scripts/generate-open-data.mjs` already writes
// alongside `data/`, kept in sync by `packages/abi-registry/test/openData.test.ts`.
const dataDir = path.join(process.cwd(), "public", "data");

let taxonomy: TaxonomyRecord[] | null = null;
let labels: LabelRecord[] | null = null;

export function getTaxonomyRecords(): TaxonomyRecord[] {
  if (taxonomy) return taxonomy;
  const raw = fs.readFileSync(path.join(dataDir, "taxonomy.json"), "utf-8");
  taxonomy = (JSON.parse(raw) as DataFile<TaxonomyRecord>).records;
  return taxonomy;
}

export function getLabelRecords(): LabelRecord[] {
  if (labels) return labels;
  const raw = fs.readFileSync(path.join(dataDir, "labels.json"), "utf-8");
  labels = (JSON.parse(raw) as DataFile<LabelRecord>).records;
  return labels;
}

/** Test helper - clears the in-process memoization between cases. */
export function __resetRegistryDataCacheForTests(): void {
  taxonomy = null;
  labels = null;
}

/**
 * A window generous enough that repeated lookups within it never re-read the
 * file, while `stale-while-revalidate` means a request just past the window
 * still gets an instant (if slightly stale) response instead of blocking on
 * a fresh read - per issue 16.2's "must not fan out ... per request".
 */
export const REGISTRY_DATA_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=3600";
