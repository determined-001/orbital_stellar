import { createHash } from "node:crypto";
import {
  Contract,
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  rpc as SorobanRpc,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import type { RegistryPublisher, PublishResult } from "./RegistryPublisher.js";
import { validateSpec, canonicalizeSpec } from "./spec.js";
import type { ContractSpec } from "./spec.js";

export type OnChainRegistryPublisherConfig = {
  /** The deployed registry contract's ID (see contracts/registry). */
  contractId: string;
  /** Soroban RPC endpoint, e.g. "https://soroban-testnet.stellar.org". */
  rpcUrl: string;
  /** Network passphrase for the target network (e.g. `Networks.TESTNET`). */
  networkPassphrase: string;
  /**
   * Secret key of the account that signs and pays for the publish
   * transaction. Also becomes the on-chain `publisher` address the spec is
   * filed under, unless `publisherAddress` overrides it.
   */
  publisherSecret: string;
  /**
   * On-chain `publisher` address, if it differs from the signing key's own
   * address (e.g. signing with a funded operational key on behalf of a
   * separate publisher identity). Defaults to the signer's own address.
   */
  publisherAddress?: string;
  /** Poll interval while waiting for transaction confirmation. Defaults to 1000ms. */
  pollIntervalMs?: number;
  /** How long to wait for confirmation before giving up. Defaults to 30000ms. */
  pollTimeoutMs?: number;
  /**
   * Simulate without submitting. The transaction is still built and run
   * through `prepareTransaction`, so the contract executes in simulation and
   * every host error a real submit would hit - `AlreadyPublished`, a missing
   * auth, an archived entry - surfaces exactly as it would. Nothing is signed
   * or sent, no fee is paid, and the returned {@link PublishResult} carries no
   * `txHash`.
   *
   * This exists so a publish run against a live network can be rehearsed. The
   * registry's writes are irreversible per `(contract_id, publisher, version)`,
   * so the first real run should never be the first run.
   */
  dryRun?: boolean;
};

export type OperatorPublishParams = {
  version: string;
  displayName: string;
  contact: string;
  triggerClasses: string[];
  networks: string[];
  price: number | bigint;
  denomination: string;
  latencyTier: string;
  pointer: string;
  /** Overrides operator address if signer is different identity. Defaults to signer's address. */
  operatorAddress?: string;
};

export type OfferingPublishParams = {
  version: string;
  targetContract: string;
  /** Target contract function name, e.g. "update_price" */
  functionName: string;
  triggerClass: string;
  price: number | bigint;
  denomination: string;
  pointer: string;
  /** Overrides operator address if signer is different identity. Defaults to signer's address. */
  operatorAddress?: string;
};

/**
 * Publishes {@link ContractSpec}s to the on-chain Orbital ABI registry
 * contract. Hashes the spec's canonical JSON, then invokes the registry's
 * `publish(publisher, contract_id, version, spec_hash, pointer)` entrypoint -
 * the contract stores the hash + pointer, not the spec body, so integrity is
 * verified by re-hashing whatever a resolver fetches from `pointer` and
 * comparing it to the on-chain `spec_hash` (see {@link OnChainAbiRegistryClient}).
 *
 * Also exposes `registerOperator` / `registerOffering` for the worker
 * marketplace registry. Both reuse the same contract, RPC, and publisher-auth
 * model as `publish` - one deployment, one secret - and emit
 * `worker_registered` / `operator_registered` events decodable via the
 * existing `decodeContractEvent` pipeline.
 */
export class OnChainRegistryPublisher implements RegistryPublisher {
  constructor(private readonly config: OnChainRegistryPublisherConfig) {}

  /**
   * Publish an operator record on chain. Requires the operator's own key
   * (the `publisherSecret` address must equal `operatorAddress` if set).
   * Emits `OperatorRegistered` and is versioned per operator.
   */
  async registerOperator(params: OperatorPublishParams): Promise<PublishResult> {
    if (!params.version)
      throw new Error("OnChainRegistryPublisher.registerOperator: version is required");
    if (!params.displayName)
      throw new Error("OnChainRegistryPublisher.registerOperator: displayName is required");
    if (!params.pointer)
      throw new Error("OnChainRegistryPublisher.registerOperator: pointer is required");

    const {
      rpcUrl,
      networkPassphrase,
      publisherSecret,
      contractId: registryContractId,
    } = this.config;
    const pollIntervalMs = this.config.pollIntervalMs ?? 1000;
    const pollTimeoutMs = this.config.pollTimeoutMs ?? 30_000;

    const server = new SorobanRpc.Server(rpcUrl);
    const keypair = Keypair.fromSecret(publisherSecret);
    const operatorAddress =
      params.operatorAddress ?? this.config.publisherAddress ?? keypair.publicKey();
    const source = await server.getAccount(keypair.publicKey());
    const registryContract = new Contract(registryContractId);

    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        registryContract.call(
          "register_operator",
          nativeToScVal(operatorAddress, { type: "address" }),
          nativeToScVal(params.version, { type: "string" }),
          nativeToScVal(params.displayName, { type: "string" }),
          nativeToScVal(params.contact ?? "", { type: "string" }),
          nativeToScVal(params.triggerClasses ?? []),
          nativeToScVal(params.networks ?? []),
          nativeToScVal(BigInt(params.price ?? 0), { type: "i128" }),
          nativeToScVal(params.denomination ?? "XLM", { type: "string" }),
          nativeToScVal(params.latencyTier ?? "standard", { type: "string" }),
          nativeToScVal(params.pointer, { type: "string" }),
        ),
      )
      .setTimeout(60)
      .build();

    const prepared = await server.prepareTransaction(tx);
    prepared.sign(keypair);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === "ERROR") {
      throw new Error(
        `OnChainRegistryPublisher.registerOperator: sendTransaction failed: ${JSON.stringify(sent.errorResult)}`,
      );
    }
    const deadline = Date.now() + pollTimeoutMs;
    while (Date.now() < deadline) {
      const result = await server.getTransaction(sent.hash);
      if (result.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
        if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
          throw new Error(
            `OnChainRegistryPublisher.registerOperator: transaction failed with status ${result.status}`,
          );
        }
        return {
          contractId: operatorAddress,
          version: params.version,
          etag: params.pointer,
          txHash: sent.hash,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(
      `OnChainRegistryPublisher.registerOperator: transaction not confirmed within ${pollTimeoutMs}ms`,
    );
  }

  /** Alias for {@link registerOperator} */
  async publishOperator(params: OperatorPublishParams): Promise<PublishResult> {
    return this.registerOperator(params);
  }

  /**
   * Publish a worker offering on chain. Only the operator's own key can
   * publish an offering under that operator's address (`operator.require_auth`).
   * Emits a `worker_registered` event decodable through the existing pipeline.
   * Versioned per operator, matching spec lookup semantics.
   */
  async registerOffering(params: OfferingPublishParams): Promise<PublishResult> {
    if (!params.version)
      throw new Error("OnChainRegistryPublisher.registerOffering: version is required");
    if (!params.targetContract)
      throw new Error("OnChainRegistryPublisher.registerOffering: targetContract is required");
    if (!params.triggerClass)
      throw new Error("OnChainRegistryPublisher.registerOffering: triggerClass is required");
    if (!params.pointer)
      throw new Error("OnChainRegistryPublisher.registerOffering: pointer is required");

    const {
      rpcUrl,
      networkPassphrase,
      publisherSecret,
      contractId: registryContractId,
    } = this.config;
    const pollIntervalMs = this.config.pollIntervalMs ?? 1000;
    const pollTimeoutMs = this.config.pollTimeoutMs ?? 30_000;

    const server = new SorobanRpc.Server(rpcUrl);
    const keypair = Keypair.fromSecret(publisherSecret);
    const operatorAddress =
      params.operatorAddress ?? this.config.publisherAddress ?? keypair.publicKey();
    const source = await server.getAccount(keypair.publicKey());
    const registryContract = new Contract(registryContractId);

    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        registryContract.call(
          "register_offering",
          nativeToScVal(operatorAddress, { type: "address" }),
          nativeToScVal(params.version, { type: "string" }),
          nativeToScVal(params.targetContract, { type: "address" }),
          nativeToScVal(params.functionName, { type: "string" }),
          nativeToScVal(params.triggerClass, { type: "string" }),
          nativeToScVal(BigInt(params.price ?? 0), { type: "i128" }),
          nativeToScVal(params.denomination ?? "XLM", { type: "string" }),
          nativeToScVal(params.pointer, { type: "string" }),
        ),
      )
      .setTimeout(60)
      .build();

    const prepared = await server.prepareTransaction(tx);
    prepared.sign(keypair);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === "ERROR") {
      throw new Error(
        `OnChainRegistryPublisher.registerOffering: sendTransaction failed: ${JSON.stringify(sent.errorResult)}`,
      );
    }
    const deadline = Date.now() + pollTimeoutMs;
    while (Date.now() < deadline) {
      const result = await server.getTransaction(sent.hash);
      if (result.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
        if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
          throw new Error(
            `OnChainRegistryPublisher.registerOffering: transaction failed with status ${result.status}`,
          );
        }
        return {
          contractId: params.targetContract,
          version: params.version,
          etag: params.pointer,
          txHash: sent.hash,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(
      `OnChainRegistryPublisher.registerOffering: transaction not confirmed within ${pollTimeoutMs}ms`,
    );
  }

  /** Alias for {@link registerOffering} */
  async publishOffering(params: OfferingPublishParams): Promise<PublishResult> {
    return this.registerOffering(params);
  }

  async publish(spec: unknown): Promise<PublishResult> {
    const validation = validateSpec(spec);
    if (!validation.valid) {
      throw new Error(
        `OnChainRegistryPublisher.publish: spec validation failed:\n${validation.errors
          .map((e) => `  - ${e}`)
          .join("\n")}`,
      );
    }

    const contractSpec = spec as ContractSpec;

    if (!contractSpec.contractId) {
      throw new Error("OnChainRegistryPublisher.publish: spec.contractId is required");
    }
    if (!contractSpec.pointer) {
      throw new Error(
        "OnChainRegistryPublisher.publish: spec.pointer is required - set it to where the spec blob will be hosted before publishing",
      );
    }

    const canonicalJson = canonicalizeSpec(contractSpec);
    const specHash = createHash("sha256").update(canonicalJson).digest();

    const {
      rpcUrl,
      networkPassphrase,
      publisherSecret,
      contractId: registryContractId,
    } = this.config;
    const pollIntervalMs = this.config.pollIntervalMs ?? 1000;
    const pollTimeoutMs = this.config.pollTimeoutMs ?? 30_000;

    const server = new SorobanRpc.Server(rpcUrl);
    const keypair = Keypair.fromSecret(publisherSecret);
    const publisherAddress = this.config.publisherAddress ?? keypair.publicKey();
    const source = await server.getAccount(keypair.publicKey());
    const registryContract = new Contract(registryContractId);

    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        registryContract.call(
          "publish",
          nativeToScVal(publisherAddress, { type: "address" }),
          nativeToScVal(contractSpec.contractId, { type: "address" }),
          nativeToScVal(contractSpec.version, { type: "string" }),
          nativeToScVal(specHash, { type: "bytes" }),
          nativeToScVal(contractSpec.pointer, { type: "string" }),
        ),
      )
      .setTimeout(60)
      .build();

    // prepareTransaction simulates against the live contract, so a dry run
    // still exercises every check the real submit would - it just stops
    // before anything is signed or sent.
    const prepared = await server.prepareTransaction(tx);

    if (this.config.dryRun) {
      return {
        contractId: contractSpec.contractId,
        version: contractSpec.version,
        etag: specHash.toString("hex"),
      };
    }

    prepared.sign(keypair);

    const sent = await server.sendTransaction(prepared);
    if (sent.status === "ERROR") {
      throw new Error(
        `OnChainRegistryPublisher.publish: sendTransaction failed: ${JSON.stringify(sent.errorResult)}`,
      );
    }

    const deadline = Date.now() + pollTimeoutMs;
    while (Date.now() < deadline) {
      const result = await server.getTransaction(sent.hash);
      if (result.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
        if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
          throw new Error(
            `OnChainRegistryPublisher.publish: transaction failed with status ${result.status}`,
          );
        }
        return {
          contractId: contractSpec.contractId,
          version: contractSpec.version,
          etag: specHash.toString("hex"),
          txHash: sent.hash,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(
      `OnChainRegistryPublisher.publish: transaction not confirmed within ${pollTimeoutMs}ms`,
    );
  }
}
