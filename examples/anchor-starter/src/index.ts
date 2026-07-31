#!/usr/bin/env node

/**
 * orbital-anchor-starter CLI
 *
 * Captures payment and trustline events for anchor distribution accounts into
 * an append-only audit log. Supports replay from any cursor for byte-identical
 * audit trail reconstruction.
 *
 * Usage:
 *   node dist/index.js --accounts GABC...,GDEF... --audit-log ./audit.jsonl
 *   node dist/index.js replay --accounts GABC...,GDEF... --from <cursor> --output ./audit-replay.jsonl
 */

import { AuditLogWriter } from "./audit-log.js";
import { AnchorService } from "./anchor-service.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): {
  command: "capture" | "replay";
  accounts: string[];
  auditLog: string;
  network: "mainnet" | "testnet";
  cursorDir: string;
  horizonUrl?: string;
  replayCursor?: string;
  replayOutput?: string;
} {
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = "true";
        }
      }
    } else {
      positional.push(arg);
    }
  }

  const command = positional[0] === "replay" ? "replay" : "capture";
  const accounts = (flags.accounts ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    command,
    accounts,
    auditLog: flags["audit-log"] ?? "./audit.jsonl",
    network: (flags.network as "mainnet" | "testnet") ?? "testnet",
    cursorDir: flags["cursor-dir"] ?? "./.orbital-cursors",
    horizonUrl: flags["horizon-url"] as string | undefined,
    replayCursor: flags.from as string | undefined,
    replayOutput: flags.output as string | undefined,
  };
}

function printUsage(): void {
  console.log(`
orbital-anchor-starter - Audit-grade event capture for Stellar anchors

USAGE:
  node dist/index.js --accounts <accts> [options]
  node dist/index.js replay --accounts <accts> --from <cursor> [options]

CAPTURE MODE:
  --accounts     Comma-separated list of Stellar distribution accounts (required)
  --audit-log    Path to the append-only audit log file (default: ./audit.jsonl)
  --network      Stellar network: "mainnet" or "testnet" (default: testnet)
  --cursor-dir   Directory for cursor persistence (default: ./.orbital-cursors)
  --horizon-url  Horizon URL override for self-hosted nodes

REPLAY MODE:
  replay         Enter replay mode
  --accounts     Comma-separated list of Stellar distribution accounts (required)
  --from         Horizon cursor to replay from (required)
  --output       Output path for the replayed audit log (default: audit.replay.jsonl)
  --audit-log    Path to the original audit log (used to derive output path when --output is omitted)
  --cursor-dir   Directory for cursor persistence (default: ./.orbital-cursors)
  --network      Stellar network: "mainnet" or "testnet" (default: testnet)
  --horizon-url  Horizon URL override for self-hosted nodes
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.accounts.length === 0) {
    console.error("Error: --accounts is required.");
    printUsage();
    process.exit(1);
  }

  if (opts.command === "replay" && !opts.replayCursor) {
    console.error("Error: --from <cursor> is required for replay mode.");
    printUsage();
    process.exit(1);
  }

  if (opts.command === "replay") {
    await runReplay(opts);
  } else {
    await runCapture(opts);
  }
}

async function runCapture(opts: ReturnType<typeof parseArgs>): Promise<void> {
  const auditLog = new AuditLogWriter({
    filePath: opts.auditLog,
    fsyncOnAppend: true,
  });
  await auditLog.open();

  const service = new AnchorService({
    accounts: opts.accounts,
    network: opts.network,
    cursorDir: opts.cursorDir,
    auditLog,
    horizonUrl: opts.horizonUrl,
  });

  // Graceful shutdown on SIGTERM / SIGINT.
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down...`);
    await service.stop();
    console.log(`Audit log: ${opts.auditLog} (${auditLog.recordCount} records)`);

    // Print DLQ summary.
    const dlq = service.getDeadLetterStore();
    const failures = await dlq.list();
    if (failures.length > 0) {
      console.log(`Dead-letter entries: ${failures.length}`);
      for (const f of failures.slice(0, 5)) {
        console.log(`  ${f.id}: ${f.error} (${f.attempts} attempts)`);
      }
      if (failures.length > 5) {
        console.log(`  ... and ${failures.length - 5} more`);
      }
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log(`Anchor service starting on ${opts.network}`);
  console.log(`  Accounts: ${opts.accounts.join(", ")}`);
  console.log(`  Audit log: ${opts.auditLog}`);
  console.log(`  Cursor dir: ${opts.cursorDir}`);

  await service.start();
  console.log("Listening for events. Press Ctrl+C to stop.");
}

async function runReplay(opts: ReturnType<typeof parseArgs>): Promise<void> {
  // Create a minimal service just to drive the replay.
  const service = new AnchorService({
    accounts: opts.accounts,
    network: opts.network,
    cursorDir: opts.cursorDir,
    horizonUrl: opts.horizonUrl,
  });

  const cursor = opts.replayCursor!;
  const outputPath = opts.replayOutput;

  console.log(`Replaying from cursor: ${cursor}`);
  console.log(`Output: ${outputPath ?? "(derived from audit-log path)"}`);

  const replayService = await service.replayFrom(cursor, outputPath);

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Stopping replay...`);
    await replayService.stop();
    console.log("Replay complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log("Replay running. Press Ctrl+C when caught up to stop.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
