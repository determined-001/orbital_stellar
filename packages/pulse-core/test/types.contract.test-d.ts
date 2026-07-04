import type {
  ContractEmittedEvent,
  ContractEvent,
  ContractInvokedEvent,
  NormalizedEvent,
  RawSorobanEvent,
} from "../src/index.js";

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type IsNever<T> = [T] extends [never] ? true : false;
type IsOptional<T, K extends keyof T> = Record<never, never> extends Pick<T, K> ? true : false;

type ContractNormalizedEvent = Extract<NormalizedEvent, { type: ContractEvent["type"] }>;
type InvokedMember = Extract<ContractNormalizedEvent, { type: "contract.invoked" }>;
type EmittedMember = Extract<ContractNormalizedEvent, { type: "contract.emitted" }>;

// Both public contract types must remain members of NormalizedEvent.
type _InvokedIsPresent = Assert<Equal<IsNever<InvokedMember>, false>>;
type _EmittedIsPresent = Assert<Equal<IsNever<EmittedMember>, false>>;
type _InvokedNarrows = Assert<InvokedMember extends ContractInvokedEvent ? true : false>;
type _EmittedNarrows = Assert<EmittedMember extends ContractEmittedEvent ? true : false>;

// The exported shapes must retain their contract-specific fields.
type _InvokedFunction = Assert<Equal<ContractInvokedEvent["function"], string>>;
type _InvokedArgs = Assert<Equal<ContractInvokedEvent["args"], unknown[]>>;
type _InvokedLedger = Assert<Equal<NonNullable<ContractInvokedEvent["ledger"]>, number>>;
type _InvokedTxHash = Assert<Equal<NonNullable<ContractInvokedEvent["txHash"]>, string>>;
type _InvokedRaw = Assert<Equal<NonNullable<ContractInvokedEvent["raw"]>, RawSorobanEvent>>;

type _EmittedTopics = Assert<Equal<ContractEmittedEvent["topics"], string[]>>;
type _EmittedData = Assert<Equal<ContractEmittedEvent["data"], unknown>>;
type _EmittedLedger = Assert<Equal<NonNullable<ContractEmittedEvent["ledger"]>, number>>;
type _EmittedId = Assert<Equal<NonNullable<ContractEmittedEvent["eventId"]>, string>>;
type _EmittedTxHash = Assert<Equal<NonNullable<ContractEmittedEvent["txHash"]>, string>>;
type _EmittedSuccess = Assert<
  Equal<NonNullable<ContractEmittedEvent["inSuccessfulContractCall"]>, boolean>
>;
type _EmittedRaw = Assert<Equal<NonNullable<ContractEmittedEvent["raw"]>, RawSorobanEvent>>;
type _DecodedDataStaysOptional = Assert<IsOptional<ContractEmittedEvent, "decodedData">>;

/**
 * This switch deliberately has no default clause. Its explicit return type is
 * valid only while both contract-event variants are handled.
 */
export function describeContractEvent(event: ContractNormalizedEvent): string {
  switch (event.type) {
    case "contract.invoked": {
      const invoked: ContractInvokedEvent = event;
      return invoked.function;
    }
    case "contract.emitted": {
      const emitted: ContractEmittedEvent = event;
      return emitted.topics.join(",");
    }
  }
}

// Each negative example omits one contract variant. The explicit string return
// type must therefore fail, proving the positive switch needs both cases.
// @ts-expect-error - contract.emitted is not handled.
export function missingEmittedCase(event: ContractNormalizedEvent): string {
  switch (event.type) {
    case "contract.invoked":
      return event.function;
  }
}

// @ts-expect-error - contract.invoked is not handled.
export function missingInvokedCase(event: ContractNormalizedEvent): string {
  switch (event.type) {
    case "contract.emitted":
      return event.topics.join(",");
  }
}
