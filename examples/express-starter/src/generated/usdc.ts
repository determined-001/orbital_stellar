import type { ContractEmittedEvent } from "@orbital-stellar/pulse-core";
import { z } from "zod";

export interface TransferParams {
  from: string;
  to: string;
  amount: string;
}
export type TransferReturns = void;

export interface TransferFromParams {
  spender: string;
  from: string;
  to: string;
  amount: string;
}
export type TransferFromReturns = void;

export interface ApproveParams {
  from: string;
  spender: string;
  amount: string;
  expirationLedger: number;
}
export type ApproveReturns = void;

export interface AllowanceParams {
  from: string;
  spender: string;
}
export type AllowanceReturns = string;

export interface BalanceParams {
  id: string;
}
export type BalanceReturns = string;

export type DecimalsParams = Record<string, never>;
export type DecimalsReturns = number;

export type NameParams = Record<string, never>;
export type NameReturns = string;

export type SymbolParams = Record<string, never>;
export type SymbolReturns = string;

export type TotalSupplyParams = Record<string, never>;
export type TotalSupplyReturns = string;

export interface MintParams {
  to: string;
  amount: string;
}
export type MintReturns = void;

export interface BurnParams {
  from: string;
  amount: string;
}
export type BurnReturns = void;

export interface BurnFromParams {
  spender: string;
  from: string;
  amount: string;
}
export type BurnFromReturns = void;

export interface ClawbackParams {
  from: string;
  amount: string;
}
export type ClawbackReturns = void;

export interface SetAuthorizedParams {
  id: string;
  authorize: boolean;
}
export type SetAuthorizedReturns = void;

export interface AuthorizedParams {
  id: string;
}
export type AuthorizedReturns = boolean;

export interface SetAdminParams {
  newAdmin: string;
}
export type SetAdminReturns = void;

export type AdminParams = Record<string, never>;
export type AdminReturns = string;

export interface TransferEvent {
  amount: string;
}

export interface MintEvent {
  amount: string;
}

export interface BurnEvent {
  amount: string;
}

export interface ClawbackEvent {
  amount: string;
}

export interface SetAuthorizedEvent {
  authorize: boolean;
}

export interface ApproveEvent {
  amount: string;
  expirationLedger: number;
}


export const TransferEventSchema = z.object({
  amount: z.string(),
});

export const MintEventSchema = z.object({
  amount: z.string(),
});

export const BurnEventSchema = z.object({
  amount: z.string(),
});

export const ClawbackEventSchema = z.object({
  amount: z.string(),
});

export const SetAuthorizedEventSchema = z.object({
  authorize: z.boolean(),
});

export const ApproveEventSchema = z.object({
  amount: z.string(),
  expirationLedger: z.number(),
});


export function isTransferEvent(event: ContractEmittedEvent): event is ContractEmittedEvent & { decodedData: TransferEvent } {
  return event.topics[0] === "transfer" && TransferEventSchema.safeParse(event.decodedData).success;
}

export function isMintEvent(event: ContractEmittedEvent): event is ContractEmittedEvent & { decodedData: MintEvent } {
  return event.topics[0] === "mint" && MintEventSchema.safeParse(event.decodedData).success;
}

export function isBurnEvent(event: ContractEmittedEvent): event is ContractEmittedEvent & { decodedData: BurnEvent } {
  return event.topics[0] === "burn" && BurnEventSchema.safeParse(event.decodedData).success;
}

export function isClawbackEvent(event: ContractEmittedEvent): event is ContractEmittedEvent & { decodedData: ClawbackEvent } {
  return event.topics[0] === "clawback" && ClawbackEventSchema.safeParse(event.decodedData).success;
}

export function isSetAuthorizedEvent(event: ContractEmittedEvent): event is ContractEmittedEvent & { decodedData: SetAuthorizedEvent } {
  return event.topics[0] === "set_authorized" && SetAuthorizedEventSchema.safeParse(event.decodedData).success;
}

export function isApproveEvent(event: ContractEmittedEvent): event is ContractEmittedEvent & { decodedData: ApproveEvent } {
  return event.topics[0] === "approve" && ApproveEventSchema.safeParse(event.decodedData).success;
}

export type ContractEventUnion = ContractEmittedEvent & { topics: ["transfer", ...string[]]; decodedData: TransferEvent } | ContractEmittedEvent & { topics: ["mint", ...string[]]; decodedData: MintEvent } | ContractEmittedEvent & { topics: ["burn", ...string[]]; decodedData: BurnEvent } | ContractEmittedEvent & { topics: ["clawback", ...string[]]; decodedData: ClawbackEvent } | ContractEmittedEvent & { topics: ["set_authorized", ...string[]]; decodedData: SetAuthorizedEvent } | ContractEmittedEvent & { topics: ["approve", ...string[]]; decodedData: ApproveEvent };

export function assertExhaustiveContractEvent(event: ContractEventUnion): string {
  switch (event.topics[0]) {
    case "transfer":
      return event.topics[0];
    case "mint":
      return event.topics[0];
    case "burn":
      return event.topics[0];
    case "clawback":
      return event.topics[0];
    case "set_authorized":
      return event.topics[0];
    case "approve":
      return event.topics[0];
    default: {
      const _exhaustive: never = event.topics[0];
      return _exhaustive;
    }
  }
}
