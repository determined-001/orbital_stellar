import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExportLedger, ExportSource, ExportSourceKind, LedgerRange } from "./types.js";
import { parseCdpLedger, parseGalexieLedger } from "./parsers.js";

export type ExportFormat = "galexie" | "cdp";

/**
 * Reads Galexie/CDP ledger exports from a directory of JSONL files. Each file
 * is a sequence of one-JSON-object-per-line ledger records. This is the
 * concrete {@link ExportSource} used in production; the in-memory source is
 * for tests.
 *
 * This source reads the export and discards it - it never writes a copy. That
 * is the entire "no Orbital-operated ledger store" guarantee: the directory
 * is operated by SDF / the export provider, not by Orbital.
 */
export class FileExportSource implements ExportSource {
  private readonly directory: string;
  private readonly format: ExportFormat;
  private readonly location: string;

  constructor(opts: { directory: string; format: ExportFormat; location?: string }) {
    this.directory = opts.directory;
    this.format = opts.format;
    this.location = opts.location ?? `file://${opts.directory}`;
  }

  describe(): { kind: ExportSourceKind; location: string } {
    return { kind: this.format, location: this.location };
  }

  async *read(range: LedgerRange): AsyncIterable<ExportLedger> {
    const files = (await readdir(this.directory)).filter((f) => f.endsWith(".jsonl")).sort();
    for (const file of files) {
      const text = await readFile(join(this.directory, file), "utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const ledger =
          this.format === "galexie"
            ? parseGalexieLedger(JSON.parse(trimmed))
            : parseCdpLedger(JSON.parse(trimmed));
        if (ledger.ledgerSequence < range.startLedger) continue;
        if (ledger.ledgerSequence >= range.endLedger) continue;
        yield ledger;
      }
    }
  }
}

/**
 * In-memory {@link ExportSource} for tests and ad-hoc tooling. Holds the
 * ledgers passed in and yields them in ascending order. No I/O, no retained
 * copy beyond the provided array.
 */
export class MemoryExportSource implements ExportSource {
  private readonly ledgers: ExportLedger[];
  private readonly location: string;

  constructor(ledgers: ExportLedger[], opts?: { location?: string }) {
    this.ledgers = [...ledgers].sort((a, b) => a.ledgerSequence - b.ledgerSequence);
    this.location = opts?.location ?? "memory://export";
  }

  describe(): { kind: ExportSourceKind; location: string } {
    return { kind: "file", location: this.location };
  }

  async *read(range: LedgerRange): AsyncIterable<ExportLedger> {
    for (const ledger of this.ledgers) {
      if (ledger.ledgerSequence < range.startLedger) continue;
      if (ledger.ledgerSequence >= range.endLedger) continue;
      yield ledger;
    }
  }
}
