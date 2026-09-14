import type { WorkerVerificationEngine } from "../../src/verification/WorkerVerificationEngine.js";
import type { WorkerDefinition } from "../../src/types.js";

/**
 * Type-only proof for issue #1049's acceptance criterion "verification never
 * reads operator-supplied logs - a test asserts the engine compiles with no
 * operator input beyond the definition."
 *
 * This file is never executed - compiled by `tsconfig.typetest.json`, same
 * mechanism as `types.exhaustive.test-d.ts` and `noAuthority.test-d.ts`. A
 * comment saying "do not add an operator-report parameter" is advice; this
 * is a build failure if one is added to any `verify*` method's signature.
 */

type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
type HasNoKeyOf<T, Forbidden extends string> = IsNever<Extract<keyof T, Forbidden>>;

/**
 * Every name that would represent the operator telling the engine what
 * happened, rather than the engine deriving it from chain-sourced events.
 */
type OperatorReportField =
  | "operatorReport"
  | "operatorLog"
  | "operatorLogs"
  | "selfReport"
  | "selfReported"
  | "selfReportedStatus"
  | "claimedStatus"
  | "operatorClaim"
  | "operatorClaims"
  | "reportedBy"
  | "attestedByOperator"
  | "operatorAttestation"
  | "trustOperator"
  | "operatorSaysFired"
  | "override";

type VerifyTimeTriggerOptions = Parameters<WorkerVerificationEngine["verifyTimeTrigger"]>[3];

// The worker definition every `verify*` method takes carries no
// operator-report field - the one input every method shares.
type _WorkerDefinitionHoldsNoOperatorInput = Assert<
  HasNoKeyOf<WorkerDefinition, OperatorReportField>
>;

// The options bag `verifyTimeTrigger` takes carries no operator-report field
// either - the only other structured (non-event-array) input any `verify*`
// method accepts.
type _TimeTriggerOptionsHoldNoOperatorInput = Assert<
  HasNoKeyOf<VerifyTimeTriggerOptions, OperatorReportField>
>;

/** The guard has to actually catch something, or it is decoration. */
type TamperedOptions = VerifyTimeTriggerOptions & { operatorClaim: string };
type _GuardCatchesATamperedOptionsBag = Assert<
  HasNoKeyOf<TamperedOptions, OperatorReportField> extends false ? true : false
>;
