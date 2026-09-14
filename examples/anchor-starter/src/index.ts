import { loadConfig } from "./config.js";
import { connect } from "./anchor.js";
import { deposit, send } from "./commands.js";
import { checkUsdcBalance } from "./balance.js";

const USAGE =
  "Usage: orbital-anchor-starter <deposit [amount] | send <amount> | balance <account>>";

/**
 * `orbital-anchor-starter deposit [amount]`, `... send <amount>`, or
 * `... balance <account>`. See README.md for the walkthrough - `deposit`/
 * `send` run SEP-1 discovery and SEP-10 authentication first, then the
 * SEP-24/31 flow specific to them; `balance` is a standalone read against
 * mainnet USDC and needs neither.
 *
 * Argument validation happens before any network call, deliberately: a typo'd
 * command should fail instantly, not after a round trip to the anchor.
 */
async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);

  if (command !== "deposit" && command !== "send" && command !== "balance") {
    console.error(USAGE);
    process.exit(1);
  }
  if (command === "send" && !arg) {
    console.error("Usage: orbital-anchor-starter send <amount>");
    process.exit(1);
  }
  if (command === "balance" && !arg) {
    console.error("Usage: orbital-anchor-starter balance <account>");
    process.exit(1);
  }

  const log = (message: string) => console.log(message);

  if (command === "balance") {
    // Confirming a SEP-31 send actually landed by checking the recipient's
    // USDC balance - the generated-types example that doesn't need an
    // anchor session at all (issue #908).
    const balance = await checkUsdcBalance(arg as string);
    log(`USDC balance for ${arg}: ${balance}`);
    return;
  }

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
