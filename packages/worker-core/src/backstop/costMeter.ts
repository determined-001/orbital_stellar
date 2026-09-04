/**
 * Backstop readiness cost metering (issue #1063, "21.2 Readiness cost
 * metering").
 *
 * §C.7 is explicit: model the readiness cost before pricing, because it is not
 * pure margin. **Monitoring cost scales with the number of backstopped
 * subscriptions regardless of how many ever need intervention.** A tier priced
 * off intervention frequency prices the rare event and gives away the common
 * one, and the margin is then discovered in a monthly bill.
 *
 * Two decisions shape this module, both from
 * `docs/design/backstop-cost-model.md`:
 *
 * 1. **Shared drivers take a list of subscription ids, not one id.** One RPC
 *    call can serve N subscriptions watching the same condition. A single-id
 *    signature would force each call site to decide attribution, scattering the
 *    split policy across the codebase instead of keeping it in one place.
 *
 * 2. **Every cost is recorded twice.** `attributedCost` is the even split, so
 *    it sums to spend actually incurred; `standaloneCost` is what the
 *    subscription would have cost alone, and is never summed. The gap between
 *    them *is* the value of shared monitoring, as a number rather than an
 *    intuition — and pricing needs both: one for margin, one to know what
 *    happens to a subscription that ends up alone on its condition.
 */

/** The four cost drivers §C.7 asks to meter, per subscription per window. */
export interface CostBreakdown {
  /** RPC calls. Fractional in `attributedCost` — a shared call splits. */
  rpcCalls: number;
  /** Wall-clock milliseconds spent in those RPC calls. */
  rpcMs: number;
  /** Export scans performed. */
  exportScans: number;
  /** Bytes scanned by those exports. */
  exportScanBytes: number;
  /** Watcher CPU milliseconds attributed to evaluating this subscription. */
  computeMs: number;
  /** Bytes × windows retained. Direct: coverage records are per subscription. */
  storageByteLedgers: number;
}

export function emptyCostBreakdown(): CostBreakdown {
  return {
    rpcCalls: 0,
    rpcMs: 0,
    exportScans: 0,
    exportScanBytes: 0,
    computeMs: 0,
    storageByteLedgers: 0,
  };
}

const DRIVER_KEYS = [
  "rpcCalls",
  "rpcMs",
  "exportScans",
  "exportScanBytes",
  "computeMs",
  "storageByteLedgers",
] as const satisfies readonly (keyof CostBreakdown)[];

function addInto(target: CostBreakdown, key: keyof CostBreakdown, value: number): void {
  target[key] += value;
}

function sumBreakdowns(items: Iterable<CostBreakdown>): CostBreakdown {
  const total = emptyCostBreakdown();
  for (const item of items) {
    for (const key of DRIVER_KEYS) {
      total[key] += item[key];
    }
  }
  return total;
}

function scaleBreakdown(b: CostBreakdown, factor: number): CostBreakdown {
  const out = emptyCostBreakdown();
  for (const key of DRIVER_KEYS) {
    out[key] = b[key] * factor;
  }
  return out;
}

function subtractBreakdowns(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  const out = emptyCostBreakdown();
  for (const key of DRIVER_KEYS) {
    out[key] = a[key] - b[key];
  }
  return out;
}

/**
 * The metering surface the watcher calls. Mirrors the metrics idiom already in
 * `pulse-webhooks` (`metrics.ts` + the Prometheus/OTel adapters): one
 * interface, a no-op default, adapters elsewhere.
 *
 * `subscriptionIds` on the shared drivers is the list of subscriptions the one
 * call actually served. Pass every one of them; the split lives here.
 */
export interface CostMeter {
  recordRpcCall(subscriptionIds: readonly string[], method: string, durationMs: number): void;
  recordExportScan(subscriptionIds: readonly string[], bytesScanned: number): void;
  recordCompute(subscriptionId: string, durationMs: number): void;
  recordStorage(subscriptionId: string, bytes: number): void;
}

/** The default. Metering is opt-in and costs nothing when it is off. */
export const NOOP_COST_METER: CostMeter = {
  recordRpcCall: () => undefined,
  recordExportScan: () => undefined,
  recordCompute: () => undefined,
  recordStorage: () => undefined,
};

/** One subscription's cost over one closed window. */
export interface CostWindow {
  subscriptionId: string;
  startLedger: number;
  endLedger: number;
  /** Even-split share of actually-incurred cost. Sums to real spend. */
  attributedCost: CostBreakdown;
  /** What this subscription would have cost alone. Never summed. */
  standaloneCost: CostBreakdown;
}

/** Mean cost of adding one more subscription, for one kind of addition. */
export interface MarginalCostEstimate {
  /** How many window-to-window transitions this mean is drawn from. */
  samples: number;
  /** Mean delta in total attributed cost, per subscription added. */
  perSubscription: CostBreakdown;
}

/**
 * The marginal number §C.7 actually needs, split two ways.
 *
 * Total cost hides the shape of the curve, and the shape is what decides
 * whether the tier is viable at scale. The two figures differ by a large
 * factor, so a blended average of them would hide precisely the thing being
 * measured — which is why a window where both kinds of subscription were added
 * is counted in `windowsSkippedMixed` rather than folded into either estimate.
 */
export interface MarginalCostReport {
  /** Window-to-window transitions considered. */
  transitionsObserved: number;
  /** Transitions where the subscription count did not change. */
  transitionsSkippedFlat: number;
  /**
   * Transitions that could not be attributed to one kind of arrival — either
   * both kinds were added at once, or nothing was `track()`ed to say which.
   * Skipped rather than blended, since a blend hides the very difference
   * being measured.
   */
  transitionsSkippedMixed: number;
  /** Adding a subscription onto a condition already being watched. */
  sharedCondition: MarginalCostEstimate | null;
  /** Adding a subscription that introduced a condition nobody watched. */
  newCondition: MarginalCostEstimate | null;
}

export type CostMeterErrorCode =
  | "NO_SUBSCRIPTIONS"
  | "NEGATIVE_VALUE"
  | "LEDGER_OUT_OF_RANGE"
  | "WINDOW_NOT_ADVANCING"
  | "UNKNOWN_SUBSCRIPTION";

export class CostMeterError extends Error {
  readonly code: CostMeterErrorCode;

  constructor(code: CostMeterErrorCode, message: string) {
    super(message);
    this.name = "CostMeterError";
    this.code = code;
  }
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new CostMeterError(
      "NEGATIVE_VALUE",
      `${label} must be a finite non-negative number, got ${String(value)}`,
    );
  }
}

function assertLedger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CostMeterError(
      "LEDGER_OUT_OF_RANGE",
      `${label} must be a non-negative safe integer, got ${String(value)}`,
    );
  }
}

/** How a subscription joined: onto a watched condition, or bringing its own. */
export type SubscriptionArrival = "shared-condition" | "new-condition";

type OpenCost = { attributed: CostBreakdown; standalone: CostBreakdown };

/**
 * In-memory cost meter and aggregator: the reference implementation, and what
 * the acceptance criteria are asserted against.
 *
 * Costs accumulate into an open window. `closeWindow(endLedger)` seals it into
 * per-subscription {@link CostWindow} records and opens the next one, so cost
 * buckets line up exactly with the watcher's coverage windows and the two can
 * be joined without interpolation.
 *
 * Durable and exporting implementations (see `../metrics.js`) implement
 * {@link CostMeter} and forward; this one is what answers questions about
 * history and marginal cost.
 */
export class InMemoryCostMeter implements CostMeter {
  private openStart: number;
  private open = new Map<string, OpenCost>();
  /** subscriptionId -> the condition it watches. */
  private readonly conditions = new Map<string, string>();
  /** How each subscription arrived, for the marginal split. */
  private readonly arrivals = new Map<string, SubscriptionArrival>();
  private readonly closed: CostWindow[] = [];
  /** Per closed window, in seal order: the arrivals recorded during it. */
  private readonly arrivalsPerWindow: SubscriptionArrival[][] = [];
  private pendingArrivals: SubscriptionArrival[] = [];

  constructor(startLedger = 0) {
    assertLedger(startLedger, "startLedger");
    this.openStart = startLedger;
  }

  /**
   * Register a subscription and the condition it watches.
   *
   * The condition key is what makes the marginal split possible: whether this
   * subscription joined an existing cohort or opened a new one is the whole
   * question, and it cannot be recovered afterwards from cost numbers alone.
   */
  track(subscriptionId: string, condition: string): SubscriptionArrival {
    const alreadyWatched = [...this.conditions.values()].includes(condition);
    const arrival: SubscriptionArrival = alreadyWatched ? "shared-condition" : "new-condition";
    this.conditions.set(subscriptionId, condition);
    this.arrivals.set(subscriptionId, arrival);
    this.pendingArrivals.push(arrival);
    return arrival;
  }

  /** Stop counting a subscription. Its already-recorded cost is untouched. */
  untrack(subscriptionId: string): void {
    this.conditions.delete(subscriptionId);
    this.arrivals.delete(subscriptionId);
  }

  /** Subscriptions currently counted. */
  get activeCount(): number {
    return this.conditions.size;
  }

  /** Distinct conditions currently watched — the denominator sharing acts on. */
  get conditionCount(): number {
    return new Set(this.conditions.values()).size;
  }

  recordRpcCall(subscriptionIds: readonly string[], method: string, durationMs: number): void {
    assertNonNegative(durationMs, "durationMs");
    this.shared(subscriptionIds, (bucket, share) => {
      addInto(bucket.attributed, "rpcCalls", share);
      addInto(bucket.attributed, "rpcMs", durationMs * share);
      addInto(bucket.standalone, "rpcCalls", 1);
      addInto(bucket.standalone, "rpcMs", durationMs);
    });
    void method;
  }

  recordExportScan(subscriptionIds: readonly string[], bytesScanned: number): void {
    assertNonNegative(bytesScanned, "bytesScanned");
    this.shared(subscriptionIds, (bucket, share) => {
      addInto(bucket.attributed, "exportScans", share);
      addInto(bucket.attributed, "exportScanBytes", bytesScanned * share);
      addInto(bucket.standalone, "exportScans", 1);
      addInto(bucket.standalone, "exportScanBytes", bytesScanned);
    });
  }

  recordCompute(subscriptionId: string, durationMs: number): void {
    assertNonNegative(durationMs, "durationMs");
    const bucket = this.bucket(subscriptionId);
    addInto(bucket.attributed, "computeMs", durationMs);
    addInto(bucket.standalone, "computeMs", durationMs);
  }

  recordStorage(subscriptionId: string, bytes: number): void {
    assertNonNegative(bytes, "bytes");
    const bucket = this.bucket(subscriptionId);
    addInto(bucket.attributed, "storageByteLedgers", bytes);
    addInto(bucket.standalone, "storageByteLedgers", bytes);
  }

  /**
   * Seal the open window at `endLedger` and open the next from there.
   *
   * Subscriptions tracked but with no recorded cost still get a record: a
   * backstopped subscription that cost nothing measurable in a window is a
   * fact worth storing, and omitting it would bias the per-subscription mean.
   */
  closeWindow(endLedger: number): CostWindow[] {
    assertLedger(endLedger, "endLedger");
    if (endLedger <= this.openStart) {
      throw new CostMeterError(
        "WINDOW_NOT_ADVANCING",
        `Window must advance past ${this.openStart}, got ${endLedger}`,
      );
    }

    const ids = new Set<string>([...this.open.keys(), ...this.conditions.keys()]);
    const sealed: CostWindow[] = [];
    for (const subscriptionId of [...ids].sort()) {
      const bucket = this.open.get(subscriptionId);
      sealed.push({
        subscriptionId,
        startLedger: this.openStart,
        endLedger,
        attributedCost: bucket ? { ...bucket.attributed } : emptyCostBreakdown(),
        standaloneCost: bucket ? { ...bucket.standalone } : emptyCostBreakdown(),
      });
    }

    this.closed.push(...sealed);
    this.arrivalsPerWindow.push(this.pendingArrivals);
    this.pendingArrivals = [];
    this.open = new Map();
    this.openStart = endLedger;
    return sealed;
  }

  /** Every sealed window for one subscription, in ledger order. */
  history(subscriptionId: string): CostWindow[] {
    return this.closed
      .filter((w) => w.subscriptionId === subscriptionId)
      .map((w) => ({
        ...w,
        attributedCost: { ...w.attributedCost },
        standaloneCost: { ...w.standaloneCost },
      }));
  }

  /** Every sealed window, in seal order. */
  windows(): CostWindow[] {
    return this.closed.map((w) => ({
      ...w,
      attributedCost: { ...w.attributedCost },
      standaloneCost: { ...w.standaloneCost },
    }));
  }

  /** Total attributed cost across all subscriptions in one sealed window. */
  totalForWindow(startLedger: number): CostBreakdown {
    return sumBreakdowns(
      this.closed.filter((w) => w.startLedger === startLedger).map((w) => w.attributedCost),
    );
  }

  /**
   * Standalone ÷ attributed, per driver: how much sharing is actually saving.
   * A driver with no attributed cost reports `1` — no sharing to measure, not
   * an infinite saving.
   */
  sharingFactor(startLedger: number): CostBreakdown {
    const windows = this.closed.filter((w) => w.startLedger === startLedger);
    const attributed = sumBreakdowns(windows.map((w) => w.attributedCost));
    const standalone = sumBreakdowns(windows.map((w) => w.standaloneCost));
    const out = emptyCostBreakdown();
    for (const key of DRIVER_KEYS) {
      out[key] = attributed[key] === 0 ? 1 : standalone[key] / attributed[key];
    }
    return out;
  }

  /**
   * The marginal cost of one more backstopped subscription, split by whether it
   * shared a watched condition or introduced a new one.
   *
   * Computed as the delta in total attributed cost between consecutive sealed
   * windows in which the subscription count changed. A window that added both
   * kinds is skipped rather than blended — see {@link MarginalCostReport}.
   */
  marginalCost(): MarginalCostReport {
    const starts = [...new Set(this.closed.map((w) => w.startLedger))].sort((a, b) => a - b);
    const totals = starts.map((s) => this.totalForWindow(s));
    const counts = starts.map((s) => this.closed.filter((w) => w.startLedger === s).length);

    const samples: Record<SubscriptionArrival, CostBreakdown[]> = {
      "shared-condition": [],
      "new-condition": [],
    };
    let flat = 0;
    let mixed = 0;

    for (let i = 1; i < starts.length; i++) {
      const current = counts[i] ?? 0;
      const previous = counts[i - 1] ?? 0;
      const added = current - previous;
      if (added <= 0) {
        flat++;
        continue;
      }
      const kinds = new Set(this.arrivalsPerWindow[i] ?? []);
      const [kind] = [...kinds];
      if (kinds.size !== 1 || kind === undefined) {
        mixed++;
        continue;
      }
      const totalNow = totals[i] ?? emptyCostBreakdown();
      const totalBefore = totals[i - 1] ?? emptyCostBreakdown();
      samples[kind].push(scaleBreakdown(subtractBreakdowns(totalNow, totalBefore), 1 / added));
    }

    const estimate = (kind: SubscriptionArrival): MarginalCostEstimate | null => {
      const rows = samples[kind];
      if (rows.length === 0) return null;
      return {
        samples: rows.length,
        perSubscription: scaleBreakdown(sumBreakdowns(rows), 1 / rows.length),
      };
    };

    return {
      transitionsObserved: Math.max(0, starts.length - 1),
      transitionsSkippedFlat: flat,
      transitionsSkippedMixed: mixed,
      sharedCondition: estimate("shared-condition"),
      newCondition: estimate("new-condition"),
    };
  }

  private shared(
    subscriptionIds: readonly string[],
    apply: (bucket: OpenCost, share: number) => void,
  ): void {
    if (subscriptionIds.length === 0) {
      throw new CostMeterError(
        "NO_SUBSCRIPTIONS",
        "A shared cost must name at least one subscription; an unattributed cost is an unpriced one",
      );
    }
    const unique = [...new Set(subscriptionIds)];
    const share = 1 / unique.length;
    for (const id of unique) {
      apply(this.bucket(id), share);
    }
  }

  private bucket(subscriptionId: string): OpenCost {
    let bucket = this.open.get(subscriptionId);
    if (!bucket) {
      bucket = { attributed: emptyCostBreakdown(), standalone: emptyCostBreakdown() };
      this.open.set(subscriptionId, bucket);
    }
    return bucket;
  }
}
