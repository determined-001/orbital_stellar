import type { ContractEmittedEvent } from "@orbital-stellar/pulse-core";
import { z } from "zod";

export type PingParams = Record<string, never>;
export type PingReturns = number;

export interface PingEvent {
  timestamp: string;
}


export const PingEventSchema = z.object({
  timestamp: z.string(),
});


export function isPingEvent(event: ContractEmittedEvent): event is ContractEmittedEvent & { decodedData: PingEvent } {
  return event.topics[0] === "Ping" && PingEventSchema.safeParse(event.decodedData).success;
}

export type ContractEventUnion = ContractEmittedEvent & { topics: ["Ping", ...string[]]; decodedData: PingEvent };

export function assertExhaustiveContractEvent(event: ContractEventUnion): string {
  switch (event.topics[0]) {
    case "Ping":
      return event.topics[0];
    default: {
      const _exhaustive: never = event.topics[0];
      return _exhaustive;
    }
  }
}
