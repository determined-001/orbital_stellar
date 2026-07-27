import type {
  AbiRegistryClientLike,
  ContractEmittedEvent,
  ContractInvokedEvent,
  EventEngine,
  Logger,
} from "@orbital-stellar/pulse-core";
import {
  canonicalizeSpec,
  discoverContractSpec,
  NoEmbeddedSpecError,
  type ContractSpec,
  type PublishResult,
  type RegistryPublisher,
} from "@orbital-stellar/abi-registry";

const SUBSCRIPTION_ID = "orbital-indexer";
const DEFAULT_UNDISCOVERABLE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function isContractEvent(event: unknown): event is ContractEmittedEvent | ContractInvokedEvent {
  if (typeof event !== "object" || event === null) return false;
  const type = (event as { type?: unknown }).type;
  return type === "contract.emitted" || type === "contract.invoked";
}

export type AutoPublishIndexerConfig = {
  /** The engine to observe for unknown contractIds. Must already be started by the caller. */
  engine: EventEngine;
  /** Used to check whether a contractId already has a published spec before discovering/publishing a new one. */
  registryClient: AbiRegistryClientLike;
  /** Used to publish newly discovered specs - typically an `OnChainRegistryPublisher`. */
  publisher: RegistryPublisher;
  /** Soroban RPC endpoint used to fetch a contract's WASM for discovery. */
  rpcUrl: string;
  network?: "mainnet" | "testnet" | "futurenet";
  /**
   * Decides where a newly discovered spec's JSON blob will be hosted before
   * publishing - the registry contract stores this pointer alongside a hash
   * of `canonicalJson`, so whatever URL this returns must actually serve
   * that exact content once this resolves (e.g. commit it somewhere and
   * return the URL it'll be served from).
   */
  pointerStrategy: (spec: ContractSpec, canonicalJson: string) => Promise<string>;
  logger?: Logger;
  /** How long to back off from retrying a contract with no embedded spec before trying again. Defaults to 30 minutes. */
  undiscoverableTtlMs?: number;
};

/**
 * Watches an `EventEngine`'s contract stream for `contractId`s the registry
 * doesn't yet have a spec for, discovers their interface via WASM
 * auto-discovery, and publishes the result under Orbital's key - closing
 * the loop so Orbital writes on-chain continuously as part of normal
 * operation, per maintainer.md's stage 4. Manual `abi-registry publish`
 * stays available as the override path for teams that want custom naming;
 * this indexer never touches or overrides publications under any publisher
 * address other than the one configured on `publisher`.
 *
 * Deliberately NOT wired into any public-facing route - anonymous visitors
 * triggering real signed transactions per typed contract ID is an abuse
 * vector. This is a standalone process/script class.
 */
export class AutoPublishIndexer {
  private readonly undiscoverableUntil = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<ContractSpec | null>>();
  private listening = false;

  constructor(private readonly config: AutoPublishIndexerConfig) {}

  /** Subscribes to the engine's contract stream. Idempotent. */
  start(): void {
    if (this.listening) return;
    this.listening = true;
    const watcher = this.config.engine.subscribeContract(SUBSCRIPTION_ID, {
      // No type/contractIds restriction - per EventEngine's
      // matchesContractFilters, an empty filter object matches every
      // contract.emitted and contract.invoked event, which is exactly what
      // "watch for unknown contractIds" requires.
      filters: [{}],
    });
    watcher.on("*", this.handleEvent);
  }

  /** Unsubscribes from the engine's contract stream. Idempotent. Does not clear caches. */
  stop(): void {
    if (!this.listening) return;
    this.listening = false;
    this.config.engine.unsubscribeContract(SUBSCRIPTION_ID);
  }

  /**
   * Ensures `contractId` has a published spec, discovering and publishing
   * one if needed. Returns the spec (existing or newly published), or
   * `null` if the contract has no embedded spec to discover (and is
   * currently within its backoff window) or discovery is already in flight
   * for a contract that turns out undiscoverable. Concurrent calls for the
   * same not-yet-known `contractId` share one in-flight discovery -
   * duplicate events for the same unseen contract don't trigger duplicate
   * publish attempts.
   */
  async ensureDiscovered(contractId: string): Promise<ContractSpec | null> {
    const backoffUntil = this.undiscoverableUntil.get(contractId);
    if (backoffUntil !== undefined && Date.now() < backoffUntil) {
      return null;
    }

    const existingInFlight = this.inFlight.get(contractId);
    if (existingInFlight) return existingInFlight;

    const promise = this.discoverAndPublish(contractId).finally(() => {
      this.inFlight.delete(contractId);
    });
    this.inFlight.set(contractId, promise);
    return promise;
  }

  private handleEvent = (event: unknown): void => {
    if (!isContractEvent(event)) return;
    const contractId = event.contractId;
    if (!contractId) return;
    this.ensureDiscovered(contractId).catch((err: unknown) => {
      this.config.logger?.warn("orbital-indexer: ensureDiscovered failed", {
        contractId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  };

  private async discoverAndPublish(contractId: string): Promise<ContractSpec | null> {
    const existing = await this.config.registryClient.getSpec(contractId);
    if (existing != null) {
      // Already published (by this indexer on a prior run, or by a team's
      // own manual override) - nothing to do.
      return existing as ContractSpec;
    }

    let spec: ContractSpec;
    try {
      spec = await discoverContractSpec({
        rpcUrl: this.config.rpcUrl,
        contractId,
        network: this.config.network,
      });
    } catch (err) {
      if (err instanceof NoEmbeddedSpecError) {
        const ttl = this.config.undiscoverableTtlMs ?? DEFAULT_UNDISCOVERABLE_TTL_MS;
        this.undiscoverableUntil.set(contractId, Date.now() + ttl);
        this.config.logger?.info("orbital-indexer: no embedded spec, backing off", {
          contractId,
          backoffMs: ttl,
        });
        return null;
      }
      throw err;
    }

    const canonicalJson = canonicalizeSpec(spec);
    const pointer = await this.config.pointerStrategy(spec, canonicalJson);
    const specWithPointer: ContractSpec = { ...spec, pointer };

    let publishResult: PublishResult;
    try {
      publishResult = await this.config.publisher.publish(specWithPointer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // ── Republish rejection ────────────────────────────────────────────
      // The registry contract rejects duplicate (contractId, version, publisher)
      // triples with AlreadyPublished. Treat this as success-with-existing:
      // another process (or a prior run) already filed this version.
      if (
        message.includes("AlreadyPublished") ||
        message.includes("already been published") ||
        message.includes("contract_error")
      ) {
        this.config.logger?.info(
          "orbital-indexer: spec already published by another process, using existing",
          { contractId, version: spec.version },
        );
        return specWithPointer;
      }

      // ── Sequence-number collision ──────────────────────────────────────
      // Another process using the same signing key submitted a tx with the
      // same sequence number. Refresh and retry once.
      if (message.includes("tx_bad_seq") || message.includes("sequence")) {
        this.config.logger?.info("orbital-indexer: sequence collision, retrying publish once", {
          contractId,
        });
        publishResult = await this.config.publisher.publish(specWithPointer);
      } else {
        throw err;
      }
    }

    this.config.logger?.info("orbital-indexer: published auto-discovered spec", {
      contractId,
      version: spec.version,
      specHash: publishResult.etag,
      txHash: publishResult.txHash,
    });
    return specWithPointer;
  }
}
