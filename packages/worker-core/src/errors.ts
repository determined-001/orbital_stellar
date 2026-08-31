import { SorobanRpcError } from "@orbital-stellar/pulse-core";

/**
 * 18.5 submission failure classification.
 *
 * Submission failures split into two classes:
 *
 *  - **Retryable** infrastructure failures: RPC timeout, network blip, ledger
 *    contention (bad sequence / too late / duplication), insufficient fee, and
 *    rate limiting. These are transient and safe to replay with backoff.
 *  - **Terminal** contract rejections: the transaction reached the network and
 *    was *rejected* because the contract logic, auth, or payload was invalid.
 *    Replaying these is pointless - the same rejection will recur forever, so
 *    they must dead-letter immediately.
 *
 * The retry engine (18.8) keys entirely off {@link SubmissionFailure.retryable};
 * keeping this classification here means the two issues share one source of
 * truth instead of each re-deriving "is this safe to retry?".
 */
export type SubmissionFailureKind =
  | "rpc_timeout"
  | "rpc_network"
  | "ledger_contention"
  | "insufficient_fee"
  | "rate_limit"
  | "contract_rejection"
  | "contract_invalid"
  | "unauthorized"
  | "unknown";

/** Normalized submission failure produced by {@link classifySubmissionError}. */
export type SubmissionFailure = {
  kind: SubmissionFailureKind;
  message: string;
  /** Whether the submission may be safely replayed with backoff. */
  retryable: boolean;
  /** The originating error, preserved for operator inspection. */
  cause?: unknown;
};

/**
 * Classify an arbitrary submission error into a {@link SubmissionFailure}.
 *
 * Accepts `SorobanRpcError` (which already carries a `retryable` flag) and raw
 * Stellar SDK / Horizon submission errors, which are matched on their
 * `result_code` / message text.
 */
export function classifySubmissionError(error: unknown): SubmissionFailure {
  if (error instanceof SorobanRpcError) {
    return {
      kind: mapRpcCode(error.code),
      message: error.message,
      retryable: error.retryable,
      cause: error,
    };
  }

  const message = extractMessage(error);
  const code = extractResultCode(error);

  // Insufficient fee is a special ledger-contention case: bump the fee and the
  // same transaction can succeed, so it is retryable.
  if (matches(message, code, ["insufficient fee", "tx_insufficient_fee"], "insufficient_fee")) {
    return terminalOrRetryable("insufficient_fee", message, error, true);
  }

  // Ledger contention: the transaction's relationship to the ledger state was
  // wrong (bad seq, too early/late, duplicated). The next attempt, once the
  // ledger advances, can land.
  if (
    matches(
      message,
      code,
      [
        "tx bad seq",
        "tx_too_early",
        "tx_too_late",
        "tx_outdated",
        "tx_duplication",
        "tx_duplicate",
        "bad seq",
        "too late",
        "too early",
      ],
      "tx_bad_seq",
    )
  ) {
    return terminalOrRetryable("ledger_contention", message, error, true);
  }

  // Rate limiting / throttle: retryable after backoff.
  if (matches(message, code, ["rate limit", "too many requests", "throttled"], "rate_limit")) {
    return terminalOrRetryable("rate_limit", message, error, true);
  }

  // Network / timeout: the request never completed; safe to retry.
  if (
    matches(
      message,
      code,
      ["timeout", "etimedout", "econnreset", "econnrefused", "network", "socket"],
      "timeout",
    )
  ) {
    return terminalOrRetryable("rpc_timeout", message, error, true);
  }
  if (hasNetworkCause(error)) {
    return terminalOrRetryable("rpc_network", message, error, true);
  }

  // Terminal contract rejections: the contract ran and said no.
  if (
    matches(
      message,
      code,
      [
        "contract",
        "op_invalid",
        "tx_failed",
        "wasm",
        "auth",
        "bad auth",
        "invalid auth",
        "rejected",
      ],
      "contract_rejection",
    )
  ) {
    return terminalOrRetryable("contract_rejection", message, error, false);
  }

  // Unauthorized: credentials / auth are wrong; replaying won't help.
  if (matches(message, code, ["unauthorized", "unauthorised", "401", "403"], "unauthorized")) {
    return terminalOrRetryable("unauthorized", message, error, false);
  }

  // Anything we cannot positively identify as transient is treated as terminal:
  // retrying an unknown failure forever is worse than dead-lettering it for an
  // operator to inspect. The cause is preserved so mis-classification is visible.
  return terminalOrRetryable("unknown", message, error, false);
}

/** True when {@link classifySubmissionError} would mark the error retryable. */
export function isRetryableSubmissionFailure(error: unknown): boolean {
  return classifySubmissionError(error).retryable;
}

function mapRpcCode(code: string): SubmissionFailureKind {
  switch (code) {
    case "network":
      return "rpc_network";
    case "rate_limit":
      return "rate_limit";
    case "server":
      return "rpc_timeout";
    case "auth":
      return "unauthorized";
    case "invalid_request":
    default:
      return "contract_invalid";
  }
}

function terminalOrRetryable(
  kind: SubmissionFailureKind,
  message: string,
  cause: unknown,
  retryable: boolean,
): SubmissionFailure {
  return { kind, message, retryable, cause };
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

function extractResultCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "result_code" in error) {
    const code = (error as { result_code: unknown }).result_code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function hasNetworkCause(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = error.cause;
  if (cause instanceof Error) {
    const name = cause.name.toLowerCase();
    if (name.includes("timeout") || name.includes("network") || name.includes("ECONN")) {
      return true;
    }
  }
  return false;
}

function matches(
  message: string,
  code: string | undefined,
  needles: string[],
  _expectedCodeFragment: string,
): boolean {
  const haystack = `${message} ${code ?? ""}`.toLowerCase();
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}
