import type {
  AlertManager,
  VerdictRecord,
  VerdictStatus,
  VerdictStore,
} from "@orbital-stellar/abi-registry";

export const ORBITAL_BACKSTOP_OPERATOR_ID = "orbital";

const MAX_LEDGER = 1_000_000;
const MAX_STROOPS = 9223372036854775807n;
const WINDOW_STATUSES = new Set<WorkerWindowStatus>(["fired", "missed", "late", "not-due"]);

export type WorkerWindowStatus = "fired" | "missed" | "late" | "not-due";

export type WorkerWindowVerdict = {
  workerId: string;
  operatorId: string;
  windowId: string;
  status: WorkerWindowStatus;
  ledgerStart: number;
  ledgerEnd: number;
};

export type BackstopSloBounds = {
  latencyBoundLedgers: number;
  gracePeriodLedgers: number;
  xlmFloatMinStroops: bigint;
  monitoringLagGraceLedgers: number;
};

export type SloStatus = "meeting" | "breached" | "unverifiable";

export type WorkerVerdictStore = {
  record(verdict: WorkerWindowVerdict): Promise<void>;
  getByOperator(operatorId: string): Promise<WorkerWindowVerdict[]>;
};

export type OperatorScore = {
  operatorId: string;
  formulaVersion: string;
  kind: "scored" | "insufficient-data";
};

export type OperatorScorer = {
  score(store: WorkerVerdictStore, operatorId: string): Promise<OperatorScore>;
};

export type EvaluateBackstopSloInput = {
  windows: WorkerWindowVerdict[];
  bounds: BackstopSloBounds;
  xlmFloatStroops: bigint;
  chainHeadLedger: number;
  lastProcessedLedger: number;
  store: WorkerVerdictStore;
  scorer: OperatorScorer;
  alertManager: AlertManager;
  sloVerdictStore: VerdictStore;
};

export type BackstopSloResult = {
  status: SloStatus;
  operatorScore: OperatorScore;
  abiRecord: VerdictRecord;
};

export type BackstopSloErrorCode =
  | "MISSING_DEPENDENCY"
  | "INVALID_OPERATOR"
  | "LEDGER_OUT_OF_RANGE"
  | "STROOPS_OUT_OF_RANGE"
  | "BOUNDS_OUT_OF_RANGE"
  | "UNKNOWN_VERDICT";

export class BackstopSloError extends Error {
  readonly code: BackstopSloErrorCode;

  constructor(code: BackstopSloErrorCode, message: string) {
    super(message);
    this.name = "BackstopSloError";
    this.code = code;
  }
}

function requireDep<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null) {
    throw new BackstopSloError("MISSING_DEPENDENCY", `Missing ${name}`);
  }
  return value;
}

function assertLedger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_LEDGER) {
    throw new BackstopSloError(
      "LEDGER_OUT_OF_RANGE",
      `${label} must be an integer in 0..${MAX_LEDGER}`,
    );
  }
}

function assertBoundLedger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_LEDGER) {
    throw new BackstopSloError(
      "BOUNDS_OUT_OF_RANGE",
      `${label} must be an integer in 1..${MAX_LEDGER}`,
    );
  }
}

function sloToAbi(status: SloStatus): VerdictStatus {
  switch (status) {
    case "meeting":
      return "verified";
    case "breached":
      return "mismatch";
    case "unverifiable":
      return "unverifiable";
  }
}

function assertOperatorId(id: string): void {
  if (id.length === 0 || id.length > 128) {
    throw new BackstopSloError("INVALID_OPERATOR", "operatorId must be 1..128 characters");
  }
}

export async function evaluateBackstopSlo(
  input: EvaluateBackstopSloInput,
): Promise<BackstopSloResult> {
  const store = requireDep(input.store, "store");
  const scorer = requireDep(input.scorer, "scorer");
  const alertManager = requireDep(input.alertManager, "alertManager");
  const sloVerdictStore = requireDep(input.sloVerdictStore, "sloVerdictStore");
  const windows = requireDep(input.windows, "windows");
  const bounds = requireDep(input.bounds, "bounds");

  assertBoundLedger(bounds.latencyBoundLedgers, "latencyBoundLedgers");
  assertBoundLedger(bounds.gracePeriodLedgers, "gracePeriodLedgers");
  assertBoundLedger(bounds.monitoringLagGraceLedgers, "monitoringLagGraceLedgers");
  if (bounds.xlmFloatMinStroops < 0n || bounds.xlmFloatMinStroops > MAX_STROOPS) {
    throw new BackstopSloError("BOUNDS_OUT_OF_RANGE", "xlmFloatMinStroops out of range");
  }

  assertLedger(input.chainHeadLedger, "chainHeadLedger");
  assertLedger(input.lastProcessedLedger, "lastProcessedLedger");
  if (input.lastProcessedLedger > input.chainHeadLedger) {
    throw new BackstopSloError(
      "LEDGER_OUT_OF_RANGE",
      "lastProcessedLedger exceeds chainHeadLedger",
    );
  }
  if (
    typeof input.xlmFloatStroops !== "bigint" ||
    input.xlmFloatStroops < 0n ||
    input.xlmFloatStroops > MAX_STROOPS
  ) {
    throw new BackstopSloError("STROOPS_OUT_OF_RANGE", "xlmFloatStroops must be in 0..2^63-1");
  }

  for (const window of windows) {
    assertOperatorId(window.operatorId);
    if (window.operatorId !== ORBITAL_BACKSTOP_OPERATOR_ID) {
      throw new BackstopSloError(
        "INVALID_OPERATOR",
        "evaluateBackstopSlo only publishes Orbital windows",
      );
    }
    if (!WINDOW_STATUSES.has(window.status)) {
      throw new BackstopSloError("UNKNOWN_VERDICT", `Unknown window status: ${window.status}`);
    }
    assertLedger(window.ledgerStart, "ledgerStart");
    assertLedger(window.ledgerEnd, "ledgerEnd");
    await store.record(window);
  }

  let operatorScore = await scorer.score(store, ORBITAL_BACKSTOP_OPERATOR_ID);
  const orbitalRows = await store.getByOperator(ORBITAL_BACKSTOP_OPERATOR_ID);
  if (orbitalRows.length === 0) {
    operatorScore = {
      operatorId: ORBITAL_BACKSTOP_OPERATOR_ID,
      formulaVersion: operatorScore.formulaVersion,
      kind: "insufficient-data",
    };
  }

  const lag = input.chainHeadLedger - input.lastProcessedLedger;
  const missed = windows.some((w) => w.status === "missed");
  const floatLow = input.xlmFloatStroops < bounds.xlmFloatMinStroops;
  const lagHigh = lag > bounds.monitoringLagGraceLedgers;

  let status: SloStatus;
  if (missed || floatLow || lagHigh) {
    status = "breached";
  } else if (windows.length === 0) {
    status = "unverifiable";
  } else {
    status = "meeting";
  }

  const contractId = `backstop:${ORBITAL_BACKSTOP_OPERATOR_ID}`;
  const abiStatus = sloToAbi(status);
  const previous = await sloVerdictStore.getLatest(contractId);
  const abiRecord: VerdictRecord = {
    contractId,
    status: abiStatus,
    verifiedAt: new Date().toISOString(),
    previousStatus: previous?.status,
  };
  await sloVerdictStore.record(abiRecord);

  const isRepeat = previous?.status === abiStatus;
  const isFirstNonBreach = previous === null && abiStatus !== "mismatch";
  if (!isRepeat && !isFirstNonBreach) {
    const prevRecord: VerdictRecord = previous ?? {
      contractId,
      status: "verified",
      verifiedAt: "",
    };
    await alertManager.alertTransition(prevRecord, abiRecord);
  }

  return { status, operatorScore, abiRecord };
}
