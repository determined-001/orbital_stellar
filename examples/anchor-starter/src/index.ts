import { loadConfig } from "./config.js";
import { connect } from "./anchor.js";
import { deposit, send } from "./commands.js";

const USAGE = "Usage: orbital-anchor-starter <deposit [amount] | send <amount>>";

/**
 * `orbital-anchor-starter deposit [amount]` or `... send <amount>`.
 * See README.md for the walkthrough - both commands run SEP-1 discovery and
 * SEP-10 authentication first, then the SEP-24/31 flow specific to them.
 *
 * Argument validation happens before any network call, deliberately: a typo'd
 * command should fail instantly, not after a round trip to the anchor.
 */
async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);

  if (command !== "deposit" && command !== "send") {
    console.error(USAGE);
    process.exit(1);
  }
  if (command === "send" && !arg) {
    console.error("Usage: orbital-anchor-starter send <amount>");
    process.exit(1);
  }

  const log = (message: string) => console.log(message);
  const config = loadConfig();
  log(`Connecting to ${config.homeDomain} as ${config.assetCode}...`);
  const session = await connect(config);
  log(`Authenticated as ${session.publicKey}.`);

  if (command === "deposit") {
    await deposit(session, config, arg, log);
  } else {
    await send(session, config, arg as string, log);
  }
}

main().catch((error: unknown) => {
  console.error("[anchor-starter] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
