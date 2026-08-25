# SEP-48 gap analysis

This memo establishes what [SEP-48 Contract Interface Specification][sep48] and
its merged follow-up work already cover, so the Orbital SEP (Wave 2.1) extends
it rather than overlapping it. Every gap claimed below carries a citation to the
SEP text, a merged PR, or a tracked upstream issue.

**Method.** Clause coverage is read from the SEP file at `master`; XDR and
implementation status from merge state and dates on the actual PRs; open gaps
are only claimed where the SEP itself, or an upstream maintainer, says the thing
is out of scope or deferred.

**As of 2026-07-29.** The ecosystem is moving under this document - see
[§6](#6-moving-targets-recheck-before-submitting). Recheck the flagged items
before the draft PR to `stellar/stellar-protocol` goes up.

---

## 1. Status snapshot

| Artifact | State | Evidence |
| --- | --- | --- |
| SEP-48 text | **Active**, v1.1.0 | [`ecosystem/sep-0048.md`][sep48] preamble; `Status: Active` since [stellar-protocol#1704][pr1704] (2025-04-16) |
| Event support in the SEP | **Merged** 2025-07-31 | [stellar-protocol#1766][pr1766] "SEP-48: Add events" |
| Event XDR (`curr`) | **Merged** 2025-05-12 | [stellar-xdr#268][xdr268] "Add events to contract spec (curr)" |
| Rust XDR bindings | **Merged** 2025-05-12 | [rs-stellar-xdr#437][xdr437] |
| `#[contractevent]` in `soroban-sdk` | **Merged** 2025-07-15 | [rs-soroban-sdk#1473][sdk1473] |
| Design discussion | **Closed** | [stellar#1724][disc1724] "[SEP-48] Contract Interface Spec: Events" |

Note for anyone diffing the SEP: the preamble's `Updated` field still reads
`2025-04-16` even though the events change merged 2025-07-31 ([#1766][pr1766]).
The `Version: 1.1.0` and the `v1.1.0: Add support for event specifications.`
changelog entry are the reliable markers that events are in.

---

## 2. Clause-by-clause coverage

Section titles below are SEP-48's own, quoted verbatim.

| SEP-48 clause | What it settles | What it leaves open |
| --- | --- | --- |
| **Wasm Custom Section** | The interface lives in "one `contractspecv0` Wasm custom section of the contract Wasm file." | Contracts with no Wasm at all, and contracts whose Wasm predates the section. No alternate venue is defined. → [G1](#g1-contracts-with-no-embedded-event-spec), [G2](#g2-no-distribution-or-discovery-path-for-out-of-band-specs) |
| **XDR Encoding** | `SCSpecEntry` stream, "appended one after the other without frame, header, or prefix." Versioned discriminants carry forward compatibility. | Nothing material. This is fully settled. |
| **XDR Common Fields** | `doc`, `name`, `lib` on every entry. `doc` is the only human-readable channel. | `doc` is free text - no vocabulary, no machine-readable semantics. → [G4](#g4-no-semantic-layer-above-the-schema) |
| **`SC_SPEC_ENTRY_EVENT_V0`** | The full event shape: `prefixTopics<2>`, `params<50>` each with `location` (`DATA` / `TOPIC_LIST`), and `dataFormat` (`SINGLE_VALUE` / `VEC` / `MAP`). Parsers "should tolerate static topics being of the `SCVal` type `SCV_SYMBOL` or `SCV_STRING` because some contracts have emitted their topics as strings." | Nothing about the format. Orbital must consume this shape as-is and must not restate it. |
| **XDR Spec Types** | 24 type encodings, each with its expected `SCVal` variant. | Nothing material. |
| **Example Usage** | Producers: `soroban-sdk` macros. Consumers: `stellar contract info interface`. | Only two named. Cross-SDK consumption is a separate, still-open discussion. → [§4](#4-implementation-status) |
| **Limitations - "No Claims to SEP Implementations"** | Explicitly out of scope: "This proposal does not support a contract claiming to implement any specific interface." Defers to [SEP-47][sep47]. | The entire "what does this event *mean*" layer. → [G4](#g4-no-semantic-layer-above-the-schema) |
| **Security Concerns** | Names the trust hole outright: "Contracts may contain spec entries that do not align with the actual functions exported by the contract. A contract may include spec entries for funtions that do not exist. Or a contract may omit spec entries for functions that do exist." | It states the problem and stops. No verification procedure, no attestation, no registry. → [G3](#g3-the-spec-is-self-asserted-with-no-verification-procedure) |
| **Design Rationale** | Why custom sections, why XDR, why stream encoding. | Informative only. |

**The load-bearing point.** SEP-48 is a *format plus one storage venue*. It is
not a distribution mechanism, not a verification mechanism, and explicitly not a
semantics mechanism. All four gaps below sit in space the SEP itself declines to
occupy.

---

## 3. Merged XDR changes

The event types were merged into `curr` before the SEP text landed, so the wire
format has been stable since 2025-05-12.

| PR | Merged | Contents |
| --- | --- | --- |
| [stellar-xdr#268][xdr268] | 2025-05-12 | `SCSpecEventV0`, `SCSpecEventParamV0`, `SCSpecEventParamLocationV0`, `SCSpecEventDataFormat`, and the `SC_SPEC_ENTRY_EVENT_V0` arm of `SCSpecEntry` |
| [rs-stellar-xdr#437][xdr437] | 2025-05-12 | Rust bindings for the above |
| [stellar-protocol#1691][pr1691] | 2025-04-03 | Initial SEP-48 |
| [stellar-protocol#1704][pr1704] | 2025-04-16 | Status → Active |
| [stellar-protocol#1766][pr1766] | 2025-07-31 | Events added to the SEP text (v1.1.0) |

Shapes, as specified:

```xdr
struct SCSpecEventV0 {
    string doc<SC_SPEC_DOC_LIMIT>;
    string lib<80>;
    SCSymbol name;
    SCSymbol prefixTopics<2>;
    SCSpecEventParamV0 params<50>;
    SCSpecEventDataFormat dataFormat;
};
```

Two consumer-facing details the XDR alone does not tell you, both settled in
[#1724][disc1724]: `MAP` is the intended default data format, and `prefixTopics`
was introduced (capped at 2) specifically so consumers could match contracts
that emit non-conforming topics rather than excluding them.

One interop detail worth knowing before writing fixtures: XDR-JSON renders these
fields in snake_case (`prefix_topics`, `data_format`, `type_`), not the
camelCase used in the SEP's XDR listings. Confirmed against
[`stellar/stellar-asset-contract-spec`][sacspec]'s published JSON.

---

## 4. Implementation status

| Component | Status | Evidence |
| --- | --- | --- |
| `soroban-sdk` producer | **Shipped.** `#[contractevent]` merged 2025-07-15; first release published after that merge was `v23.0.0-rc.2.2` (2025-07-16), first stable `v23.0.0` (2025-09-03) | [rs-soroban-sdk#1473][sdk1473] |
| SAC / token event types | **Shipped** 2025-07-16 | [rs-soroban-sdk#1489][sdk1489] |
| `stellar-cli` consumer | **Shipped.** Tracking issue closed as completed 2026-02-11 | [stellar-cli#2086][cli2086], closed by [stellar-cli#2380][cli2380] (merged 2026-02-10) |
| Laboratory contract explorer | **Shipped.** Closed as completed 2026-01-21 | [laboratory#1512][lab1512] |
| JS SDK event bindings | **Just landed, still settling** | [js-stellar-sdk#1556][js1556] (2026-07-24), follow-up fixes [#1565][js1565] and [#1570][js1570] (both 2026-07-28) |
| Python / Go / other SDK bindings | **Open** | [stellar#1765][disc1765] "SDKs Binding Generation Events" is still open; JS and the CLI are the only implementations it lists as done |
| OpenZeppelin Monitor | **Shipped** 2025-10-16 | [openzeppelin-monitor#318][ozm318] |

The producer side is a year old and stable. The consumer side is roughly six
months old for the CLI and *days* old for the JS SDK, and remains unimplemented
for the non-JS SDKs. `soroban-sdk` is also still changing event behavior:
[#1680][sdk1680] (2026-01-16) fixed `VEC` field ordering, [#1794][sdk1794]
(2026-03-26) added a compiler error for `SINGLE_VALUE` with multiple data
entries, and [#1917][sdk1917] (2026-07-24) added unit-struct events.

---

## 5. Gaps the Orbital SEP targets

### G1: contracts with no embedded event spec

**Claim.** A contract only carries event spec entries if it was built with a
toolchain that emits them. `#[contractevent]` merged 2025-07-15
([#1473][sdk1473]); anything deployed before that, or built since with an older
SDK, has no `SC_SPEC_ENTRY_EVENT_V0` entries even if it has a `contractspecv0`
section for its functions. SEP-48 defines exactly one venue for the spec - "one
`contractspecv0` Wasm custom section of the contract Wasm file" - and no
mechanism for supplying one after the fact.

**Not closed upstream.** Nothing in SEP-48, and nothing in the merged follow-ups
in [§3](#3-merged-xdr-changes), addresses already-deployed Wasm. A contract's
Wasm is immutable; the only upstream answer is to redeploy with a newer SDK.

**Orbital's target.** Retroactive schema attestation for pre-SEP-48 contracts
(Wave 2.1(b)). This repo already implements the envelope
(`packages/abi-registry/src/attestation.ts`) and the reader precedence
(`ChainedAbiRegistryClient`).

### G2: no distribution or discovery path for out-of-band specs

**Claim.** Some contracts cannot carry an embedded spec at all - the Stellar
Asset Contract is a built-in with no Wasm to embed one in. The ecosystem's
current answer is [`stellar/stellar-asset-contract-spec`][sacspec], a repository
holding "a pre-generated copy of the SEP-48 Contract Interface Specification for
the Stellar Asset Contract" as `.xdr` and `.json` files. That is a real,
maintained artifact - 24 entries, 16 functions and 8 events (`Transfer`,
`TransferMuxed`, `Mint`, `Burn`, `Clawback`, `Approve`, `SetAdmin`,
`SetAuthorized`) - and it is also a bare git repo with no discovery protocol, no
integrity binding to any on-chain identifier, and no freshness guarantee.

**Not closed upstream.** SEP-48 specifies a Wasm custom section and nothing else;
there is no clause covering where a spec lives when there is no Wasm, how a
consumer finds it, or how it is verified once found.

**Why it bites.** That repository was last pushed 2026-02-05, while
[stellar-protocol#1947][pr1947] (SEP-41 map event bodies) merged 2026-07-27. A
distribution channel with no freshness signal cannot tell a consumer whether the
copy it just fetched predates a standards change. See
[§6](#6-moving-targets-recheck-before-submitting).

**Orbital's target.** The off-chain registry with an on-chain `spec_hash`
pointer, so any resolver can re-hash what it fetched and check it against the
chain (Wave 2.1(a)).

### G3: the spec is self-asserted, with no verification procedure

**Claim.** SEP-48's **Security Concerns** section states the hole in its own
words: "Contracts may contain spec entries that do not align with the actual
functions exported by the contract." It names the failure and specifies no
remedy - no verification procedure, no attestation format, no signature
envelope, no registry.

**Not closed by adjacent upstream work.** Two SEPs occupy nearby ground and
neither closes this one:

- [SEP-55 Contract Build Verification][sep55] (Draft, updated 2025-03-12) -
  "a toolkit for the verification of the contract WASM build", via GitHub
  artifact attestations, matching an output binary hash against deployed Wasm.
- [SEP-58 Contract Build Reproducibility for Verification][sep58] (Draft,
  updated 2026-07-15) - a vocabulary for build-environment fields so two
  verifiers can independently rebuild and reach the same conclusion.

Both answer *"did this Wasm come from that source?"*. Neither answers *"does
this spec describe the events this contract actually emits?"*. The distinction
is load-bearing for [G1](#g1-contracts-with-no-embedded-event-spec): a perfectly
reproducible build of a contract whose source predates `#[contractevent]` still
yields Wasm with no event spec in it. SEP-58 does explicitly anticipate
"the creation of verification registries" in its Abstract - Orbital's registry
should read as complementary to that sentence, not competing with it.

**Orbital's target.** The verification pipeline cross-checking a submitted
schema against the on-chain `contractspec` (`packages/abi-registry/src/verifySchema.ts`),
plus the signed attestation envelope for the cases where there is nothing on
chain to check against.

### G4: no semantic layer above the schema

**Claim.** SEP-48's **Limitations** section rules this out explicitly: "This
proposal does not support a contract claiming to implement any specific
interface", deferring to [SEP-47 Contract Interface Discovery][sep47]. The same
call was made in the design discussion - protocol naming in event specs was
raised and deferred to SEP-47 ([#1724][disc1724]). The only human-readable
channel SEP-48 offers is the free-text `doc` field on each entry, which carries
no vocabulary and nothing machine-comparable across contracts.

**Partially addressed, and stalled.** SEP-47 is **Draft**, v0.1.0, and its file
has not been substantively changed since a rename on 2025-04-16
([stellar-protocol#1703][pr1703]) - roughly fifteen months. What it specifies is
also narrow by design: a `sep` meta entry holding "a comma-separated list of SEP
identifiers", e.g. `41,40`. That answers "which SEP does this contract claim to
implement". It does not provide an event taxonomy (`swap.executed`,
`loan.liquidated`), entity attribution, or any label vocabulary.

The broader idea was tried and rejected: [stellar#1596][disc1596] proposed an
`AppProtocolCatalog` on `ContractCodeEntry` so downstream apps could discover
supported protocols and events, and was closed in favour of the existing
`contractspecv0` / `contractmetav0` custom sections plus SEP-47.

**Orbital's target.** The semantic taxonomy and entity-label format on top of
raw event schemas (Wave 2.1(c), Wave 2.3), published as open data.

---

## 6. Moving targets: recheck before submitting

Three items are live enough to invalidate wording written today.

1. **[stellar-protocol#1947][pr1947] - "SEP-41: Add map event bodies", merged
   2026-07-27** (two days before this memo). It applies the `MAP` data format to
   all SEP-41 events, and its description sets a consumer rule directly relevant
   to Orbital: "Any event may be extended with further keys by other token SEPs
   or implementations. Consumers must tolerate unknown keys on event data." Any
   Orbital clause that assumes a closed set of keys on token event data
   contradicts this. SEP-41 itself remains **Draft** (v0.5.0), so it can move
   again.

2. **JS SDK event bindings, [#1556][js1556] merged 2026-07-24** with corrective
   follow-ups four days later ([#1565][js1565], [#1570][js1570], both
   2026-07-28).
   Any claim about what SDK-generated event parsing looks like should be
   re-read against `main` rather than against this memo.

3. **[SEP-58][sep58], updated 2026-07-15, v0.6.0, Draft.** Actively iterating,
   and the SEP whose scope sits closest to Orbital's verification story. Its
   Limitations section is the boundary to cite: it "defines a vocabulary, and a
   mechanism, not a complete implementation", and captures "the build
   environment and source identity, not whether the source itself is
   trustworthy".

Lower-risk but worth a glance: `soroban-sdk` event behavior is still being
amended ([#1917][sdk1917], 2026-07-24), and [SEP-47][sep47] is dormant rather
than dead - if it revives, [G4](#g4-no-semantic-layer-above-the-schema)'s
boundary moves.

---

## 7. Consequences for the Orbital SEP draft

1. **Consume SEP-48's event format verbatim; never restate it.** The compatibility
   clause already on the roadmap (embedded spec is canonical, registry
   attestation only fills gaps) is the right shape, and is what
   `ChainedAbiRegistryClient`'s precedence tests pin down. The SEP text should
   cite `SC_SPEC_ENTRY_EVENT_V0` rather than redefine any part of it.

2. **Scope the draft against Security Concerns, not against the format.** SEP-48
   names the spec-vs-reality hole and declines to fix it. Quoting that clause is
   the cleanest possible justification for Orbital's verification and attestation
   sections, and it keeps the two SEPs visibly non-overlapping.

3. **Position explicitly against SEP-55 and SEP-58, in the text.** All three
   touch "verification". Orbital's should say in its own Dependencies or Design
   Rationale that SEP-55/58 verify *build provenance* while Orbital verifies
   *interface accuracy*, and that a contract can carry both. Reviewers who know
   SEP-58 will ask; answering pre-emptively is cheaper than a review round.

4. **Reuse [SEP-53 Sign and Verify Messages][sep53] for the attestation
   envelope.** SEP-53 went **Final** (v1.0.0, updated 2026-06-18) and is the
   canonical off-chain ed25519 message-signing procedure: prefix
   `"Stellar Signed Message:\n"`, concatenate, `SHA-256`, sign the hash, produce
   a 64-byte signature. This repo's `signAttestation` currently signs
   `canonicalizeAttestation(document)` bytes directly with no prefix
   (`packages/abi-registry/src/attestation.ts`), which is a bespoke scheme where
   a Final SEP already exists. Adopting SEP-53's payload construction costs
   little now, removes an obvious review objection, and lets any SEP-53-aware
   wallet or library verify an Orbital attestation without custom code. Tracked
   as a follow-up to 7.4, not resolved by this memo.

5. **Do not build on SEP-47.** It is Draft, dormant since 2025-04-16, and even
   fully realized only conveys "which SEPs do I claim to implement". Orbital's
   taxonomy should stand alone and interoperate with SEP-47 if it revives.

---

## References

[sep48]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0048.md
[sep47]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0047.md
[sep53]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md
[sep55]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0055.md
[sep58]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0058.md
[pr1691]: https://github.com/stellar/stellar-protocol/pull/1691
[pr1703]: https://github.com/stellar/stellar-protocol/pull/1703
[pr1704]: https://github.com/stellar/stellar-protocol/pull/1704
[pr1766]: https://github.com/stellar/stellar-protocol/pull/1766
[pr1947]: https://github.com/stellar/stellar-protocol/pull/1947
[xdr268]: https://github.com/stellar/stellar-xdr/pull/268
[xdr437]: https://github.com/stellar/rs-stellar-xdr/pull/437
[sdk1473]: https://github.com/stellar/rs-soroban-sdk/pull/1473
[sdk1489]: https://github.com/stellar/rs-soroban-sdk/pull/1489
[sdk1680]: https://github.com/stellar/rs-soroban-sdk/pull/1680
[sdk1794]: https://github.com/stellar/rs-soroban-sdk/pull/1794
[sdk1917]: https://github.com/stellar/rs-soroban-sdk/pull/1917
[cli2086]: https://github.com/stellar/stellar-cli/issues/2086
[cli2380]: https://github.com/stellar/stellar-cli/pull/2380
[lab1512]: https://github.com/stellar/laboratory/issues/1512
[js1556]: https://github.com/stellar/js-stellar-sdk/pull/1556
[js1565]: https://github.com/stellar/js-stellar-sdk/pull/1565
[js1570]: https://github.com/stellar/js-stellar-sdk/pull/1570
[ozm318]: https://github.com/OpenZeppelin/openzeppelin-monitor/issues/318
[disc1596]: https://github.com/orgs/stellar/discussions/1596
[disc1724]: https://github.com/orgs/stellar/discussions/1724
[disc1765]: https://github.com/orgs/stellar/discussions/1765
[sacspec]: https://github.com/stellar/stellar-asset-contract-spec

- [`docs/sep/prior-art.md`](./prior-art.md) - retroactive attestation prior art (Sourcify, Etherscan, 4byte, Anchor IDL)
- [`packages/abi-registry/README.md`](../../packages/abi-registry/README.md) - SEP-48 precedence order as implemented
- [`ROADMAP.md`](../../ROADMAP.md) - Wave 2.1, the SEP draft this memo scopes
