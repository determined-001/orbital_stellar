/**
 * The starting taxonomy: SEP-41 token events (#909).
 *
 * Every shape here is taken from this repository's reviewed well-known specs
 * (`specs/well-known/*.json`), not from memory - those files record the topic
 * arity and types for `transfer`, `mint`, `burn` and `clawback` as the SEP-41
 * token interface defines them.
 *
 * ## Why these are interface-scoped
 *
 * SEP-41 defines these four events, so an entry that applies to "anything
 * implementing SEP-41" is a claim the SEP itself backs. That is the one case
 * `interface` scope is meant for. A protocol's own extension events must be
 * scoped to a contract or a WASM family instead, because nothing licenses
 * generalising them.
 *
 * ## Trailing topics
 *
 * All four allow trailing topics. CAP-67 appends an `asset` topic to Stellar
 * Asset Contract events that a pure contract-token event does not have, so a
 * strict arity would silently stop matching real SAC events on a protocol
 * upgrade.
 *
 * ## What is deliberately missing
 *
 * **The AMM swap shapes.** The issue asks for "the mainnet AMM swap shapes"
 * alongside these, and they are not here: this repository has no reviewed
 * record of Aquarius's or Soroswap's swap event topics, and a taxonomy entry
 * asserts what an event *means* to every downstream consumer. Writing one from
 * a half-remembered shape would put a confident name on an unverified claim -
 * the same failure as a contract address that looks right and is not.
 *
 * Adding them needs one of: the protocol's own documentation, its source, or
 * an explorer link to a real emitted event - which is exactly what
 * `TaxonomyProvenance.sources` exists to carry.
 */

import type { TaxonomyEntry } from "./taxonomy.js";

const SEP41_SOURCES = [
  "https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md",
  "https://github.com/determined-001/orbital_stellar/blob/main/packages/abi-registry/specs/well-known/usdc.json",
];

function sep41Entry(args: {
  id: string;
  name: string;
  title: string;
  description: string;
  symbol: string;
  /** Address topics after the event-name symbol, per the SEP-41 event shape. */
  addressTopics: number;
}): TaxonomyEntry {
  return {
    id: args.id,
    version: "1.0.0",
    name: args.name,
    title: args.title,
    description: args.description,
    match: {
      topics: [
        { kind: "symbol", symbol: args.symbol },
        ...Array.from(
          { length: args.addressTopics },
          () => ({ kind: "any", type: "address" }) as const,
        ),
      ],
      // CAP-67 appends an `asset` topic on Stellar Asset Contracts.
      trailingTopics: "allowed",
      dataShape: "scalar",
    },
    scope: { kind: "interface", interface: "SEP-41" },
    provenance: {
      submittedBy: "@determined-001",
      submittedAt: "2026-09-06T00:00:00Z",
      sources: SEP41_SOURCES,
    },
  };
}

/** SEP-41 token events, ready to hand to a `TaxonomyResolver`. */
export const SEP41_TAXONOMY: ReadonlyArray<TaxonomyEntry> = [
  sep41Entry({
    id: "sep41-transfer",
    name: "asset.transferred",
    title: "Token transferred",
    description: "A SEP-41 token moved from one holder to another.",
    symbol: "transfer",
    addressTopics: 2, // from, to
  }),
  sep41Entry({
    id: "sep41-mint",
    name: "asset.minted",
    title: "Token minted",
    description: "A SEP-41 token's admin created new supply and credited a holder.",
    symbol: "mint",
    addressTopics: 2, // admin, to
  }),
  sep41Entry({
    id: "sep41-burn",
    name: "asset.burned",
    title: "Token burned",
    description: "A holder destroyed some of their own SEP-41 token balance.",
    symbol: "burn",
    addressTopics: 1, // from
  }),
  sep41Entry({
    id: "sep41-clawback",
    name: "asset.clawed_back",
    title: "Token clawed back",
    description:
      "A SEP-41 token's admin reclaimed balance from a holder without the holder's consent.",
    symbol: "clawback",
    addressTopics: 2, // admin, from
  }),
];
