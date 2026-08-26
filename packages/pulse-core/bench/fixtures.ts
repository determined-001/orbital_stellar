/**
 * Loads the recorded CAP-67 fixture corpus.
 *
 * Each fixture is a full Soroban RPC `getEvents` JSON-RPC response with a single
 * event under `result.events[0]`. Benchmarks run against these recorded records
 * rather than a live network so the numbers are reproducible: a fixture-driven
 * benchmark measures pulse-core, whereas one that hit testnet would measure the
 * network. See the implementation note on issue #924.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the committed CAP-67 fixture directory. */
export const CAP67_DIR = join(here, "..", "test", "fixtures", "cap67");

/** The raw event shape pulled out of a fixture's `result.events[0]`. */
export interface RawSorobanFixtureEvent {
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  id: string;
  txHash: string;
  inSuccessfulContractCall: boolean;
  topic: string[];
  value: string;
  [key: string]: unknown;
}

/** A loaded fixture: its file stem plus the unwrapped event. */
export interface LoadedFixture {
  /** File name without extension, e.g. "transfer_plain". */
  name: string;
  /** The single event from `result.events[0]`. */
  event: RawSorobanFixtureEvent;
}

/** Reads and unwraps every `*.json` fixture in the CAP-67 corpus, sorted by name. */
export function loadCap67Corpus(): LoadedFixture[] {
  const files = readdirSync(CAP67_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    throw new Error(`[bench] no CAP-67 fixtures found in ${CAP67_DIR}`);
  }

  return files.map((file) => {
    const raw = JSON.parse(readFileSync(join(CAP67_DIR, file), "utf8")) as {
      result?: { events?: RawSorobanFixtureEvent[] };
    };
    const event = raw.result?.events?.[0];
    if (!event) {
      throw new Error(`[bench] fixture ${file} has no result.events[0]`);
    }
    return { name: file.replace(/\.json$/, ""), event };
  });
}

/** The subset of the corpus that carries a CAP-67 `transfer` topic. */
export function loadTransferFixtures(): LoadedFixture[] {
  const transfers = loadCap67Corpus().filter((f) => f.name.startsWith("transfer"));
  if (transfers.length === 0) {
    throw new Error(`[bench] no transfer fixtures found in ${CAP67_DIR}`);
  }
  return transfers;
}
