# Competitive landscape

Who else solves the problems Orbital solves, on Stellar, today.

This is deliberately separate from [`sep/prior-art.md`](./sep/prior-art.md),
which surveys *retroactive interface attestation* (Sourcify, Etherscan, 4byte,
Anchor IDL) to inform the attestation design. That document asks "how have other
ecosystems solved verification?" This one asks a blunter question: **if someone
can already buy or install a thing that does what Orbital does, why would they
choose Orbital?**

Every claim below carries a citation. Where Orbital loses, this document says
so - a landscape memo that concludes the author wins everywhere is not a
landscape memo.

**As of 2026-09-05.** The two upstream items in §1 move fastest; recheck them
before any grant submission or public positioning.

---

## 1. The protocol is absorbing part of the problem

This is the most important section, and it is not about a competitor.

### SEP-48 embeds event schemas in the contract itself

[SEP-48][sep48] reached `Version: 1.1.0` with event support merged on
2025-07-31 ([stellar-protocol#1766][pr1766]), the event XDR merged 2025-05-12
([stellar-xdr#268][xdr268]), and `#[contractevent]` shipped in `soroban-sdk`
2025-07-15 ([rs-soroban-sdk#1473][sdk1473]).

The spec lives in a `contractspecv0` Wasm custom section - **on chain, inside
the contract**. For any contract compiled with a current SDK, the dictionary
travels with the code and no external registry is needed to read it.

**Consequence for Orbital.** The registry's addressable surface is
*pre-SEP-48 contracts and contracts with no embedded spec*, and that set shrinks
with every new deployment. This is not a surprise - it is exactly the position
[`sep/sep48-gap-analysis.md`](./sep/sep48-gap-analysis.md) already takes (an
embedded spec is canonical; registry attestation is the fallback). It is
restated here because it is easy to lose when describing the registry to
someone who has not read that memo, and because a shrinking market has to be
said out loud.

**What SEP-48 does not settle**, per that same analysis: G4, *no semantic layer
above the schema*. SEP-48 tells you a contract emits `swap` with three fields.
It does not tell you that this contract's `swap` and that contract's
`exchange_executed` are the same concept. Cross-contract semantics is the part
of the registry SEP-48 does not reach, and it is where the durable value is.

### The official JS SDK now decodes events

[js-stellar-sdk#1257][sdk1257] - "Event bindings and parsers for Soroban
contract events", asking for event schemas, typed event models, parsers, and
subscribe-and-decode examples - is **closed as Done**, resolved by
[js-stellar-sdk#1556][pr1556].

**Consequence for Orbital.** Raw decoding is table stakes now, not a
differentiator. `pulse-core`'s remaining advantages are operational rather than
representational: reconnection, rate-limit backoff, cursor persistence and
resumable replay, unified Horizon + Soroban normalization, and a single event
model across both transports. Those are real and the SDK does not provide them -
but "we decode Soroban events" is no longer a claim worth leading with.

---

## 2. Mercury (xyclooLabs)

**What it is.** The incumbent commercial indexer for Stellar.
[Mercury][mercury] offers instant querying of events and transactions, and
[Retroshades][retroshades] - contract-level data structures defined and emitted
*inside* the contract, indexed by the Mercury network - for custom indexing
logic. Mercury "Classic" exposes contract events and Stellar transactions over
GraphQL.

**Where it beats Orbital.**

- **It is running, in production, with paying users.** Orbital's contracts have
  never been invoked on any network (see
  [`testnet-deployment.md`](./testnet-deployment.md) and the provenance notes in
  [`../contracts/README.md`](../contracts/README.md)).
- **Retroshades is more powerful than schema decoding** for the case it targets:
  a contract author who controls their own source can emit exactly the indexed
  shape they want, with no schema-matching step at all.
- **Hosted.** No infrastructure decision for the consumer.

**Where Orbital differs.**

- **Retroshades requires modifying the contract.** It serves contract *authors*
  indexing their *own* contracts. Orbital's registry targets the opposite case:
  reading contracts you did not write and cannot change. These are adjacent
  markets, not the same one.
- **Orbital is MIT and self-hostable**; Mercury is an operated service. For an
  anchor with data-residency or vendor-dependency constraints, that is decisive.
- **The registry is on-chain and public.** A Mercury index is Mercury's. A spec
  published to Orbital's registry contract survives Orbital.

**Honest read.** For "I want Stellar contract data in my app, now, and I will
pay for it", Mercury is the better answer today and will stay so until Orbital
is operated at parity. Orbital's case is the open standard and the read-anyone's-
contract path, not hosted convenience.

---

## 3. Allium (SDF-contracted)

Under contract with the Stellar Development Foundation to build indexing tools,
with a target launch of Q1 2026 ([Stellar Docs - Indexers][indexers]).

**Consequence for Orbital.** SDF is funding a data layer. Any Orbital
positioning that assumes "SDF needs someone to solve indexing" is out of date.
Positioning should assume the commodity data layer is covered and compete above
it - on semantics and verification, not on ingestion.

---

## 4. General-purpose indexers

**SubQuery** (decentralized indexer SDK, 300+ chains) and **OnFinality**
(hosting for SubQuery logic) both reach Stellar ([Stellar Docs -
Indexers][indexers]).

These are a weaker threat than Mercury: multi-chain indexers are generic by
construction and do not carry Stellar-specific semantics. They compete for the
"get the data" job and not for the "know what the data means" job.

---

## 5. Where Orbital is actually uncontested

Two things in this repository have no counterpart in any system above.

**Chain-derived verification.** Every system here reports *what happened*. None
independently checks whether an automated actor did what it promised, by
re-deriving the answer from the chain rather than from the actor's own logs.
That is the worker layer's verification engine (#1049), and it is only possible
because the event-decoding layer exists underneath it. It is the one component
that cannot be copied without also building everything below it.

**A semantic layer across contracts.** SEP-48 §G4, by SDF's own framing, leaves
this open. Mapping many contracts' differently-named events onto shared concepts
(`swap.executed`, `loan.liquidated`) is the registry's durable value, distinct
from schema storage that SEP-48 now handles.

Both are **incomplete**. Verification depends on the vault contract (#1068),
which is a placeholder. The semantic resolver is #909, partly built. The
uncontested ground is real but currently unoccupied, including by Orbital.

---

## 6. Recheck before citing

| Item | Why it moves | Where to look |
| --- | --- | --- |
| SEP-48 adoption rate | Determines how fast the registry's fallback market shrinks | [sep-0048.md][sep48] |
| js-stellar-sdk event API surface | May absorb more of `pulse-core` | [js-stellar-sdk releases][sdkrel] |
| Allium launch | Changes the funded-competitor picture | [Indexers overview][indexers] |
| Mercury pricing/free tier | Determines whether self-hosting has a cost argument | [mercurydata.app][mercury] |

[sep48]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0048.md
[pr1766]: https://github.com/stellar/stellar-protocol/pull/1766
[xdr268]: https://github.com/stellar/stellar-xdr/pull/268
[sdk1473]: https://github.com/stellar/rs-soroban-sdk/pull/1473
[sdk1257]: https://github.com/stellar/js-stellar-sdk/issues/1257
[pr1556]: https://github.com/stellar/js-stellar-sdk/pull/1556
[sdkrel]: https://github.com/stellar/js-stellar-sdk/releases
[mercury]: https://mercurydata.app/
[retroshades]: https://docs.mercurydata.app/retroshades/introduction-to-retroshades
[indexers]: https://developers.stellar.org/docs/data/indexers
