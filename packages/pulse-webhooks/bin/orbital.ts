#!/usr/bin/env node
/**
 * orbital CLI — DLQ subcommands
 *
 * Usage:
 *   orbital dlq list   --url=<server> [--since=<ISO8601>]
 *   orbital dlq dump   --url=<server>
 *   orbital dlq replay --url=<server> <id>
 */

function parseArgs(argv: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) {
      flags[m[1]!] = m[2]!;
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

async function apiFetch(
  baseUrl: string,
  path: string,
  method = "GET"
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, { method });
  const body = await res.json();
  if (!res.ok) {
    const msg = (body as { error?: string }).error ?? res.statusText;
    throw new Error(`${res.status} ${msg}`);
  }
  return body;
}

async function main(): Promise<void> {
  const [, , group, sub, ...rest] = process.argv;

  if (group !== "dlq") {
    console.error("Usage: orbital dlq <list|dump|replay> --url=<server> [options]");
    process.exit(1);
  }

  const { flags, positional } = parseArgs(rest);
  const baseUrl = flags.url;

  if (!baseUrl) {
    console.error("Error: --url=<server> is required");
    process.exit(1);
  }

  switch (sub) {
    case "list": {
      const qs = flags.since ? `?since=${encodeURIComponent(flags.since)}` : "";
      const entries = await apiFetch(baseUrl, `/dlq${qs}`);
      console.log(JSON.stringify(entries, null, 2));
      break;
    }

    case "dump": {
      const entries = await apiFetch(baseUrl, "/dlq/dump");
      console.log(JSON.stringify(entries, null, 2));
      break;
    }

    case "replay": {
      const id = positional[0];
      if (!id) {
        console.error("Usage: orbital dlq replay --url=<server> <id>");
        process.exit(1);
      }
      const result = await apiFetch(baseUrl, `/dlq/${encodeURIComponent(id)}/replay`, "POST");
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      console.error(`Unknown dlq subcommand: "${sub}". Expected list, dump, or replay.`);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
