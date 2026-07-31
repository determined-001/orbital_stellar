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
};

/**
 * Publishes {@link ContractSpec}s to the on-chain Orbital ABI registry
 * contract. Hashes the spec's canonical JSON, then invokes the registry's
 * `publish(publisher, contract_id, version, spec_hash, pointer)` entrypoint -
 * the contract stores the hash + pointer, not the spec body, so integrity is
 * verified by re-hashing whatever a resolver fetches from `pointer` and
 * comparing it to the on-chain `spec_hash` (see {@link OnChainAbiRegistryClient}).
 */
export class OnChainRegistryPublisher implements RegistryPublisher {
  constructor(private readonly config: OnChainRegistryPublisherConfig) {}

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

    const prepared = await server.prepareTransaction(tx);
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
