import { Sep24CustomerInfoNeededError, Sep24StatusMachine } from "@orbital-stellar/anchor-sdk";
import { CustomerInfoNeededError, MissingFieldsError } from "@orbital-stellar/anchor-sdk";
import type { AnchorSession } from "./anchor.js";
import type { StarterConfig } from "./config.js";

export class UnsupportedByAnchorError extends Error {
  constructor(sep: "SEP-24" | "SEP-31") {
    super(`This anchor's stellar.toml does not advertise a ${sep} endpoint.`);
    this.name = "UnsupportedByAnchorError";
  }
}

/** How long to poll a transaction before giving up and returning its last-seen status. */
const POLL_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * SEP-24 interactive deposit: initiates the flow and prints the URL a human
 * completes it at (KYC, payment instructions - all anchor-hosted), then polls
 * until the transaction reaches a terminal status or {@link POLL_TIMEOUT_MS}
 * elapses, logging every status change via {@link Sep24StatusMachine}.
 */
export async function deposit(
  session: AnchorSession,
  config: StarterConfig,
  amount: string | undefined,
  log: (message: string) => void,
): Promise<void> {
  if (!session.sep24) throw new UnsupportedByAnchorError("SEP-24");

  let interactive;
  try {
    interactive = await session.sep24.initiateDeposit(
      {
        asset_code: config.assetCode,
        account: session.publicKey,
        ...(amount !== undefined ? { amount } : {}),
      },
      session.token,
    );
  } catch (error) {
    if (error instanceof Sep24CustomerInfoNeededError) {
      log(`Anchor needs more customer info before a deposit can start: ${error.fields.join(", ")}`);
      log("Register those fields via SEP-12 (@orbital-stellar/anchor-sdk's Sep12Client) and retry.");
      return;
    }
    throw error;
  }

  log(`Deposit started (id ${interactive.id}). Complete it at:`);
  log(`  ${interactive.url}`);

  const machine = new Sep24StatusMachine();
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (!machine.isTerminal && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const tx = await session.sep24.transaction(interactive.id, session.token);
    if (machine.transitionTo(tx.status)) {
      log(`  status: ${tx.status}`);
    }
  }

  if (!machine.isTerminal) {
    log(`Still ${machine.current} after ${POLL_TIMEOUT_MS / 1000}s - complete the flow above, then`);
    log(`re-run with the same account to see the final status.`);
  }
}

/**
 * SEP-31 cross-border send. A real send requires `sender_id`/`receiver_id`
 * from prior SEP-12 registration; without them the anchor legitimately
 * rejects the request, which this surfaces as guidance rather than a crash -
 * that rejection is itself the correct, spec-following behavior to
 * demonstrate, not a bug in the starter.
 */
export async function send(
  session: AnchorSession,
  config: StarterConfig,
  amount: string,
  log: (message: string) => void,
): Promise<void> {
  if (!session.sep31) throw new UnsupportedByAnchorError("SEP-31");

  const info = await session.sep31.info();
  const supportedAssets = Object.keys(info.receive);
  log(`Anchor SEP-31 assets: ${supportedAssets.join(", ") || "(none configured)"}`);

  if (!supportedAssets.includes(config.assetCode)) {
    log(`Anchor does not currently accept SEP-31 sends of ${config.assetCode} - nothing to do.`);
    return;
  }

  try {
    const tx = await session.sep31.initiateTransaction(
      { asset_code: config.assetCode, amount },
      session.token,
    );
    log(`Send started (id ${tx.id}). Pay ${tx.stellar_account_id}`);
    log(`  memo (${tx.stellar_memo_type}): ${tx.stellar_memo}`);
  } catch (error) {
    if (error instanceof CustomerInfoNeededError) {
      log(`Anchor needs ${error.customerType} info before a send can start: ${error.neededFields.join(", ")}`);
      log("Register it via SEP-12 (@orbital-stellar/anchor-sdk's Sep12Client) and retry.");
      return;
    }
    if (error instanceof MissingFieldsError) {
      log(`Anchor needs additional transaction fields: ${error.missingFields.join(", ")}`);
      return;
    }
    // Anchor-specific validation (e.g. a funding-method field this particular
    // anchor requires) that the SDK has no typed error for. Report it rather
    // than crash - a send failing this way is the anchor's real answer, and
    // an operator needs to see the reason to act on it.
    if (error instanceof Error) {
      log(`Anchor rejected the send: ${error.message}`);
      return;
    }
    throw error;
  }
}
