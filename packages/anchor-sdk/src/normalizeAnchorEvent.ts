import type {
  AnchorFlowEvent,
  AnchorFlowEventType,
  AnchorFlowStage,
  Sep24Status,
  Sep31Status,
} from "@orbital-stellar/pulse-core";
import type { Sep24Transaction } from "./sep24.js";

/**
 * Maps anchor transactions onto the `anchor.*` taxonomy in pulse-core.
 *
 * Two rules drive everything here:
 *
 * 1. The anchor's own status is preserved verbatim in `protocolStatus`. The
 *    normalized `type` is a convenience, never a replacement - a compliance
 *    consumer must be able to see exactly what the anchor said.
 * 2. `settlementTxHash` is only ever a hash the anchor published. When it does
 *    not expose one the field is `null`, never inferred from timing or from a
 *    Horizon lookup - a guessed correlation is indistinguishable from a
 *    fabricated one.
 */

/** SEP-24 status → lifecycle stage. */
const SEP24_STAGE: Record<Sep24Status, AnchorFlowStage> = {
  incomplete: "initiated",
  pending_user_transfer_start: "pending",
  pending_user_transfer_complete: "pending",
  pending_external: "pending",
  pending_anchor: "pending",
  pending_stellar: "pending",
  pending_trust: "pending",
  pending_user: "pending",
  completed: "completed",
  refunded: "refunded",
  expired: "failed",
  no_market: "failed",
  too_small: "failed",
  too_large: "failed",
  error: "failed",
};

/** SEP-31 status → lifecycle stage. */
const SEP31_STAGE: Record<Sep31Status, AnchorFlowStage> = {
  pending_sender: "initiated",
  pending_transaction_info_update: "pending",
  pending_stellar: "pending",
  pending_receiver: "pending",
  pending_external: "pending",
  completed: "completed",
  error: "failed",
};

export function sep24Stage(status: Sep24Status): AnchorFlowStage {
  return SEP24_STAGE[status];
}

export function sep31Stage(status: Sep31Status): AnchorFlowStage {
  return SEP31_STAGE[status];
}

function eventType(
  flow: "deposit" | "withdrawal" | "payment",
  stage: AnchorFlowStage,
): AnchorFlowEventType {
  return `anchor.${flow}.${stage}` as AnchorFlowEventType;
}

/**
 * `timestampDate` is a lazy, non-enumerable getter on every normalized event,
 * so anchor events match the shape pulse-core's own normalizers produce.
 */
function withTimestampDate<T extends { timestamp: string }>(event: T): T & { timestampDate: Date } {
  let cached: Date | undefined;
  Object.defineProperty(event, "timestampDate", {
    enumerable: false,
    configurable: true,
    get() {
      cached ??= new Date(event.timestamp);
      return cached;
    },
  });
  return event as T & { timestampDate: Date };
}

export type NormalizeSep24Options = {
  /** Base URL of the anchor, recorded on the event. */
  anchorUrl: string;
};

/**
 * Maps a SEP-24 transaction onto `anchor.deposit.*` or `anchor.withdrawal.*`.
 *
 * @param transaction The transaction as the anchor returned it.
 */
export function normalizeSep24Transaction(
  transaction: Sep24Transaction,
  options: NormalizeSep24Options,
): AnchorFlowEvent {
  const stage = sep24Stage(transaction.status);
  const flow = transaction.kind === "deposit" ? "deposit" : "withdrawal";

  const event = {
    type: eventType(flow, stage),
    protocol: "sep24" as const,
    stage,
    transactionId: transaction.id,
    protocolStatus: transaction.status,
    anchorUrl: options.anchorUrl,
    // Only what the anchor published. `?? null` rather than leaving the key
    // absent so a consumer can tell "no hash" from "field not modelled".
    settlementTxHash: transaction.stellar_transaction_id ?? null,
    ...(transaction.amount_in !== undefined ? { amountIn: transaction.amount_in } : {}),
    ...(transaction.amount_out !== undefined ? { amountOut: transaction.amount_out } : {}),
    ...(transaction.amount_fee !== undefined ? { amountFee: transaction.amount_fee } : {}),
    ...(transaction.message !== undefined ? { message: transaction.message } : {}),
    timestamp:
      transaction.completed_at ?? transaction.updated_at ?? transaction.started_at ?? isoNow(),
    raw: transaction,
  };

  return withTimestampDate(event) as AnchorFlowEvent;
}

export type NormalizeSep31Options = {
  anchorUrl: string;
  /** The transaction id, which SEP-31 returns separately from the status. */
  transactionId: string;
  /** Settlement hash, when the anchor exposed one. */
  stellarTransactionId?: string | null;
  amountIn?: string;
  amountOut?: string;
  amountFee?: string;
  message?: string;
  timestamp?: string;
  raw?: unknown;
};

/** Maps a SEP-31 status onto `anchor.payment.*`. */
export function normalizeSep31Status(
  status: Sep31Status,
  options: NormalizeSep31Options,
): AnchorFlowEvent {
  const stage = sep31Stage(status);

  const event = {
    type: eventType("payment", stage),
    protocol: "sep31" as const,
    stage,
    transactionId: options.transactionId,
    protocolStatus: status,
    anchorUrl: options.anchorUrl,
    settlementTxHash: options.stellarTransactionId ?? null,
    ...(options.amountIn !== undefined ? { amountIn: options.amountIn } : {}),
    ...(options.amountOut !== undefined ? { amountOut: options.amountOut } : {}),
    ...(options.amountFee !== undefined ? { amountFee: options.amountFee } : {}),
    ...(options.message !== undefined ? { message: options.message } : {}),
    timestamp: options.timestamp ?? isoNow(),
    ...(options.raw !== undefined ? { raw: options.raw } : {}),
  };

  return withTimestampDate(event) as AnchorFlowEvent;
}

function isoNow(): string {
  return new Date().toISOString();
}
