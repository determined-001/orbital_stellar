/**
 * The off-chain-computation trigger class (issue #1061, "20.7"), per
 * `docs/design/worker-offchain-triggers.md`.
 *
 * Mirrors `eventTrigger.ts`'s planning/verification split - this module
 * turns a stream of *attestation occurrences* into either a real window
 * (§5's `fired`/`late`/`missed` become reachable once a valid, correctly-bound
 * attestation exists) or a direct `unverifiable` result (no attestation
 * exists, or the one that does is invalid or misbound). Unlike an event
 * trigger, an off-chain condition inverts the default: without an
 * attestation the condition has no chain evidence at all, so the window is
 * `unverifiable` *by construction* (design note §7), not as a fallback.
 *
 * **What this module does not do**, per the design note's own §9 scope
 * boundary: it does not know that a window *should* exist absent any
 * attestation at all - detecting a fully-withheld window (T5 in the
 * security review) needs an independent expectation source this module has
 * no access to, and inventing one would be exactly the "trust the
 * operator's claim of what should have happened" this whole component
 * exists not to do. It only resolves the occurrences it is given.
 */
import type {
  WorkerVerdictWindow,
  WorkerVerdictReason,
} from "../verification/workerFireVerdict.js";
import {
  verifyComputationAttestation,
  type ComputationAttestationEnvelope,
} from "./attestation.js";

/**
 * The subset of a worker manifest this trigger class needs, per the design
 * note §8's registration gates. Mirrors `EventTriggerDefinition`'s reasons
 * for being its own type rather than `Pick<>`ing from the manifest (20.4's
 * `TriggerSpec` has no `computation` member yet either).
 */
export type ComputationTriggerDefinition = {
  readonly workerId: string;
  /** Which declared off-chain condition this is - a worker may have several. */
  readonly conditionId: string;
  /**
   * The manifest-declared authoritative source(s) for this condition
   * (design note §8, T4). An attestation from anyone else is a
   * registration-time-refused condition, not merely an unverifiable window.
   * Quorum semantics beyond "any of these" are a follow-up (§9).
   */
  readonly declaredSources: ReadonlyArray<string>;
  /** Ledgers after the attestation's on-chain record the invocation must land in. */
  readonly latencyBoundLedgers: number;
  /** First ledger at which this definition is in effect. */
  readonly activationLedger: number;
};

/**
 * One attestation as observed on chain: the envelope itself (or `null` if a
 * reference to one exists on chain but the referenced document could not be
 * retrieved - design note §4's reference form, §5's "attestation references
 * a result nobody can produce" row), plus the ledger and stable identity of
 * the on-chain record that carried or referenced it.
 */
export type ComputationConditionOccurrence = {
  readonly attestation: ComputationAttestationEnvelope | null;
  readonly ledger: number;
  /** Stable identity of the on-chain record (event id, tx hash) - for fire-once/replay dedup, mirroring `eventIdentity` in `eventTrigger.ts`. */
  readonly occurrenceId: string;
};

/** A window this planner opened for a valid, correctly-bound attestation - ready for the engine's usual invocation search. */
export type ComputationWindow = WorkerVerdictWindow;

/**
 * A result the planner resolved directly to `unverifiable`, without opening
 * a real window. `conditionLedger`/`deadlineLedger` are still reported -
 * the occurrence's on-chain ledger is known regardless of whether its
 * attestation turned out valid, and the latency bound is a property of the
 * trigger definition, not of the attestation - so both are honest, not
 * guessed, even for an unverifiable result.
 */
export type ComputationUnverifiableResult = WorkerVerdictWindow & {
  readonly reason: WorkerVerdictReason;
  readonly detail: string;
};

export type ComputationPlanResult = {
  readonly windows: ReadonlyArray<ComputationWindow>;
  readonly unverifiable: ReadonlyArray<ComputationUnverifiableResult>;
};

export class ComputationTriggerPlanner {
  private constructor(readonly definition: ComputationTriggerDefinition) {}

  /** @internal - use {@link registerComputationTrigger}. */
  static _create(definition: ComputationTriggerDefinition): ComputationTriggerPlanner {
    return new ComputationTriggerPlanner(definition);
  }

  /**
   * Resolves each occurrence to either a window or an `unverifiable`
   * result. Pure and synchronous, same determinism guarantee as
   * `EventTriggerPlanner.plan`: the same occurrences in the same order
   * produce the same result every time (occurrences are sorted by ledger
   * first, for the same reason).
   */
  plan(
    occurrences: ReadonlyArray<ComputationConditionOccurrence>,
    now?: Date,
  ): ComputationPlanResult {
    const windows: ComputationWindow[] = [];
    const unverifiable: ComputationUnverifiableResult[] = [];
    const seen = new Set<string>();

    const ordered = [...occurrences].sort(
      (a, b) => a.ledger - b.ledger || a.occurrenceId.localeCompare(b.occurrenceId),
    );

    for (const occurrence of ordered) {
      if (seen.has(occurrence.occurrenceId)) continue;
      seen.add(occurrence.occurrenceId);

      if (occurrence.ledger < this.definition.activationLedger) continue;

      const windowId = `${this.definition.workerId}:c:${occurrence.occurrenceId}`;
      const conditionLedger = occurrence.ledger;
      const deadlineLedger = occurrence.ledger + this.definition.latencyBoundLedgers;

      if (occurrence.attestation === null) {
        unverifiable.push({
          windowId,
          workerId: this.definition.workerId,
          conditionLedger,
          deadlineLedger,
          reason: "attestation-unretrievable",
          detail: `occurrence "${occurrence.occurrenceId}" references an attestation that could not be retrieved`,
        });
        continue;
      }

      const verdict = verifyComputationAttestation(occurrence.attestation, {
        declaredSources: this.definition.declaredSources,
        expectedWindowId: windowId,
        expectedConditionId: this.definition.conditionId,
        now,
      });

      if (verdict.status === "invalid") {
        unverifiable.push({
          windowId,
          workerId: this.definition.workerId,
          conditionLedger,
          deadlineLedger,
          reason:
            verdict.reason === "window-mismatch"
              ? "attestation-window-mismatch"
              : "attestation-invalid",
          detail: verdict.detail,
        });
        continue;
      }

      windows.push({
        windowId,
        workerId: this.definition.workerId,
        conditionLedger,
        deadlineLedger,
      });
    }

    return { windows, unverifiable };
  }
}

export type RegisterComputationTriggerResult =
  | { readonly ok: true; readonly trigger: ComputationTriggerPlanner }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

/**
 * Registers a computation trigger, running the design note's §8 gates.
 * Refusing at registration rather than warning is what keeps the taxonomy
 * honest - a worker that cannot produce verifiable windows should not be
 * able to accrue a reputation score composed entirely of exclusions.
 */
export function registerComputationTrigger(
  definition: ComputationTriggerDefinition,
): RegisterComputationTriggerResult {
  const errors: string[] = [];

  if (!definition.workerId || definition.workerId.trim().length === 0) {
    errors.push("workerId is required");
  }
  if (!definition.conditionId || definition.conditionId.trim().length === 0) {
    errors.push("conditionId is required");
  }
  if (definition.declaredSources.length === 0) {
    errors.push(
      "declaredSources must name at least one authoritative source - an off-chain condition with " +
        "no declared source can never produce a verifiable window",
    );
  }
  if (!Number.isInteger(definition.latencyBoundLedgers) || definition.latencyBoundLedgers <= 0) {
    errors.push(
      "latencyBoundLedgers must be a positive integer - 19.1 measures `late` against it, and a " +
        "bound that was never declared is not one an operator can be held to",
    );
  }
  if (!Number.isInteger(definition.activationLedger) || definition.activationLedger < 0) {
    errors.push("activationLedger must be a non-negative integer");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, trigger: ComputationTriggerPlanner._create(definition) };
}
