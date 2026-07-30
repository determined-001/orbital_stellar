import type { ContractSpec } from "./spec.js";

export type RegisteredSpec = {
  contractId: string;
  spec: ContractSpec;
  publisher?: string;
  submittedAt: string;
  attestedBy?: string[];
};

export interface SpecStore {
  register(spec: RegisteredSpec): Promise<void>;
  get(contractId: string): Promise<RegisteredSpec | null>;
  getAll(): Promise<RegisteredSpec[]>;
  remove(contractId: string): Promise<void>;
}

export class InMemorySpecStore implements SpecStore {
  private readonly specs: Map<string, RegisteredSpec> = new Map();

  async register(spec: RegisteredSpec): Promise<void> {
    this.specs.set(spec.contractId, spec);
  }

  async get(contractId: string): Promise<RegisteredSpec | null> {
    return this.specs.get(contractId) ?? null;
  }

  async getAll(): Promise<RegisteredSpec[]> {
    return Array.from(this.specs.values());
  }

  async remove(contractId: string): Promise<void> {
    this.specs.delete(contractId);
  }
}
