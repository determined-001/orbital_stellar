# Prior art: retroactive contract-interface attestation

This survey feeds the attestation design in SEP §7.3 (`docs/sep/...` attestation JSON schema, tracked as issue 7.3). The question in all four systems below is the same one SEP-48 attestation has to answer: once a contract is already deployed, how does anyone downstream learn - and trust - what its interface actually is?

Three of the four are Ethereum-ecosystem tools, since EVM chains have the longest history of solving this problem in public, with visible successes and visible rot. The fourth, Solana's Anchor IDL, is included because it takes a structurally different approach (authority-based self-publishing) and its failure modes are the ones closest to what an attestation-based design risks reproducing.

---

## Sourcify

**What it is.** An open-source contract-verification service and dataset for EVM chains. A submitter provides source code and compiler settings for a deployed `(chainId, address)` pair; Sourcify recompiles and compares the result to the deployed bytecode. A **full match** requires the recompiled bytecode and embedded metadata hash to be identical to what's on-chain; a **partial match** accepts a bytecode match where only compiler-settings metadata differs.

**Trust model.** Cryptographic, not identity-based. Verification is a compilation proof: anyone can submit source for any address, not just the deployer, because the claim being checked isn't "I deployed this" but "this source compiles to that bytecode." Trust rests on reproducible builds, not on who hit submit.

**Spam/squatting handling.** Not applicable in the usual sense. The namespace being claimed is `(chainId, address)`, which the deployer already exclusively owns by virtue of having deployed there. Submitting correct source is idempotent - redundant submissions change nothing. Submitting incorrect source is simply rejected at the recompilation step; there is nothing to squat.

**Incentive to register.** Entirely non-monetary: better tooling. Block explorers, wallets, and security scanners consume Sourcify's dataset, so a verified contract gets readable source, decoded call data, and general trust signals for free. Adoption is driven by transparency culture, not payment or reward.

**Failure modes.**
- Proves *code identity*, not *deployer intent* - matching source doesn't mean the deployer endorses any particular human-readable description of behavior, only that the bytecode came from that source.
- Brittle to exact compiler version/settings reproduction; older or misconfigured build environments routinely fail to reproduce a match even for genuine source.
- "Decentralized" branding overstates permanence - source hosting has historically depended on Sourcify's own infrastructure plus best-effort IPFS pinning, not a guaranteed-durable store.
- Proxy patterns need extra handling, since the meaningful logic lives in an implementation contract behind a separate address.

---

## Etherscan "Verify and Publish"

**What it is.** The dominant centralized verification feature on Etherscan and its sister explorers (BscScan, PolygonScan, etc.). Functionally the same recompilation check as Sourcify - submitted source plus compiler settings must reproduce the deployed bytecode - but built, hosted, and arbitrated entirely by one company.

**Trust model.** Same deterministic recompilation core as Sourcify. No login or stake required to submit; anyone can verify any address. The difference from Sourcify is entirely about who runs the pipeline and who controls the result, not how the check itself works.

**Spam/squatting handling.** Same non-issue as Sourcify for the same reason (namespace already owned by the deployed address). Etherscan additionally surfaces a "Similar Match" suggestion for unverified contracts that resemble already-verified ones (common for proxies and clone factories); this has caused real user confusion, since a "similar" match is easy to misread as verification of the exact contract being viewed.

**Incentive to register.** Visibility and trust signal (the green checkmark) plus practical necessity - wallet software commonly decodes transactions using Etherscan-sourced ABIs, so an unverified contract looks more suspicious by default to end users regardless of its actual code.

**Failure modes.**
- Single private company controls the entire pipeline and can apply labels (e.g. phishing tags) or withhold verification at its own discretion - real content-moderation power sitting outside any protocol.
- "Verified" status lives only in Etherscan's database, with no on-chain attestation - it can change or disappear at the operator's discretion, and is not portable to a context Etherscan doesn't control.
- Bulk/automated access to verification data is increasingly rate-limited and paywalled through Etherscan's commercial API tiers.

---

## 4byte.directory (Ethereum function signature database)

**What it is.** A crowd-sourced lookup table mapping 4-byte function selectors and event topic hashes to human-readable signature strings (e.g. `0xa9059cbb` → `transfer(address,uint256)`). Anyone can submit a candidate signature; it's accepted whenever its Keccak-256 hash prefix matches the claimed selector. Crucially, there is **no check against any deployed contract's actual bytecode** - the database describes hashes in the abstract, not any specific contract's real behavior.

**Trust model.** Effectively none. A public, wiki-style, best-effort community database with no verification step beyond "the hash matches."

**Spam/squatting handling.** Poor, and structurally so. A 4-byte selector is only 32 bits, so distinct plaintext function signatures collide on the same selector far more often than intuition suggests, and the database stores every submitted candidate rather than resolving to one canonical answer - a lookup can return multiple, semantically unrelated signatures for the same selector. This ambiguity has been actively weaponized: attackers have crafted malicious function names chosen specifically to collide with a selector that also maps to a benign, commonly-displayed name, so a wallet's decoded preview shows an innocuous label while a different function actually executes. This is a documented phishing technique, not a theoretical concern.

**Incentive to register.** Purely altruistic community contribution; a large share of entries were auto-submitted by tooling encountering unknown selectors in the wild rather than manually curated, which is part of why signal quality is inconsistent.

**Failure modes.**
- Selector collisions are structural (too small a namespace for uniqueness at this scale), not a fixable bug.
- Zero cryptographic or economic cost to submitting a misleading entry.
- Limited de-duplication and no staleness handling.
- This is precisely the "confident but wrong" failure mode that an attested, contract-scoped schema (rather than a global hash-keyed guess table) is designed to avoid.

---

## Solana: Anchor IDL

**What it is.** Anchor, the dominant Solana smart-contract framework, generates an IDL (Interface Description Language, JSON) describing a program's instructions, accounts, and types at build time. It has been published two ways: off-chain, uploaded to a hosted registry so client tooling could fetch it by program ID (the original `anchor.so` registry, now largely superseded); and on-chain, written into a PDA ("canonical IDL account") derived from the program's own address, updatable only by whoever holds the program's **upgrade authority**.

**Trust model.** Authority-based, not proof-based - this is the structural difference from the three EVM tools above. The on-chain IDL account is only as trustworthy as whoever currently controls the program's upgrade authority. Nothing requires the published IDL to actually match the deployed program's real interface; there is no recompilation-equivalent check, so an IDL can silently drift from reality. If upgrade authority is later burned (a common "this program is now immutable" signal), the IDL is frozen too - including any errors in it, permanently.

**Spam/squatting handling.** Not applicable for the on-chain path, for the same reason as Sourcify/Etherscan: the PDA is namespaced by the program's own address, already owned by its authority. The now-largely-abandoned off-chain hosted registry was different - it initially allowed any keypair to submit an IDL under any program ID, so unverified and incorrect IDLs could coexist with correct ones with no way for client tooling to prefer one.

**Incentive to register.** Purely tooling-driven: client SDKs, simulated-transaction previews in wallets, and Anchor's own `anchor idl fetch` workflow all depend on a published IDL existing. Without one, callers must hand-encode instruction data.

**Failure modes.**
- Authority-not-code trust model means a malicious or merely careless upgrade authority can publish (or fail to update) a misleading IDL with no way for anyone to detect the mismatch against actual behavior.
- Adoption is patchy - a large fraction of deployed Anchor programs never published an IDL at all, particularly older ones predating the on-chain PDA convention.
- No expiry or versioning discipline: a stale IDL can silently survive many program upgrades unless its authority proactively republishes.

---

## Comparison table

| | Sourcify | Etherscan verify | 4byte.directory | Anchor IDL |
|---|---|---|---|---|
| **Trust model** | Cryptographic (recompilation match) | Cryptographic (recompilation match), centrally operated | None (unverified crowd submission) | Authority-based (upgrade-authority self-publish) |
| **Checked against actual bytecode?** | Yes | Yes | No | No |
| **Spam/squatting risk** | None (namespace = address, mismatches rejected) | None (same) | High (selector collisions, weaponizable) | None on-chain; existed on the old off-chain registry |
| **Incentive to register** | Tooling/UX, non-monetary | Visibility, near-mandatory for mainstream trust | Altruistic / auto-submitted by tooling | Required for client tooling to function at all |
| **Primary failure mode** | Proves code, not intent; brittle reproducibility | Single-company control of a de facto trust signal | Ambiguous/adversarial selector collisions | Silent drift between IDL and real behavior |

---

## Implications for Stellar

1. **Soroban already has the Sourcify-equivalent, natively.** CAP-67's embedded `contractspecv0` WASM section (surfaced in this codebase via `discoverContractSpec`) gives every current-generation contract the same guarantee Sourcify's full-match tier does - the interface is derived from the deployed code itself, not asserted by any party. SEP-48 attestation (§7.3/7.4) is specifically the fallback for contracts that predate this, i.e. it targets exactly the gap the embedded spec doesn't cover. Given that, the embedded spec should stay the strongly preferred, zero-friction default and attestation the explicit exception path - which is exactly the precedence #26's tests pin down (embedded always wins; a registry attestation only fills gaps). Anchor's adoption story is the cautionary example here: when the durable, code-derived option is treated as merely optional rather than default, a large fraction of programs simply never get one, and tooling coverage stays permanently patchy.

2. **Attestation is structurally closer to Anchor's authority model than to Sourcify's proof model, and that has to be named, not hidden.** For a pre-CAP-67 contract there is no bytecode-level check an attestation can be verified against - nothing plays the role recompilation plays for Sourcify/Etherscan. This puts attestation in the same trust category as Anchor's IDL: a claim from a party, not a proof. #21's signature envelope is the right response to that reality (a named ed25519 key, not an anonymous submission, and bound to a specific WASM hash so it can't silently apply to the wrong build) - but the SEP should be explicit in its own text that attestation is a *weaker* guarantee than an embedded spec, not a drop-in equivalent, so consumers don't over-trust it.

3. **4byte's core failure doesn't transfer directly, and that's worth preserving deliberately.** Soroban functions and events are addressed by their full names in the contract spec, not folded into a short hash the way EVM 4-byte selectors are, so the specific "different meaning, same short hash" collision-based phishing vector 4byte suffers from has no direct analogue here. This is a reason to be wary of ever introducing a shortened/hashed addressing scheme for attestation lookups (e.g. keying by a truncated function-signature hash instead of the full contract ID) purely for compactness - it would reintroduce exactly the ambiguity this ecosystem got for free by not doing that.

4. **Namespace squatting isn't a risk for the same reason it isn't for Sourcify/Etherscan/Anchor - but attestation reintroduces a different problem those systems don't have.** An attestation is keyed to a contract's own address, which the deployer already exclusively owns, so there's no name-squatting vector. But unlike Sourcify/Etherscan, an incorrect attestation can't be rejected at submission time (there's nothing to recompile against), so multiple attesters can publish conflicting claims for the same contract with none of them being cryptographically wrong. #26 resolves this for the one case where an embedded spec exists (it wins, unconditionally). The harder case - two conflicting registry attestations for a contract with *no* embedded spec - still needs an explicit precedence rule from 7.3/7.4 (attester reputation, most-recent-wins, explicit supersession chains, or some combination), since none of the four systems surveyed here had to solve it: Sourcify/Etherscan can't have conflicting *correct* submissions, and Anchor only ever has one authority per program.

5. **Etherscan's centralization is the cautionary tale for how the registry itself should be shaped, independent of the attestation format.** Etherscan won on adoption despite (and to a real extent, because of) being a single controlled point of truth, but that also means a single company can moderate, gate, or simply stop hosting the data. The existing `OnChainAbiRegistryClient`/`OnChainRegistryPublisher` design in this repo - an on-chain `spec_hash` plus an off-chain pointer, so any resolver can independently re-hash whatever it fetches and verify it against the chain - already avoids this failure mode structurally. The SEP should keep that property as a hard requirement: the protocol must stay usable against any compliant registry implementation, not just Orbital's, the way Sourcify's open approach (versus Etherscan's closed one) proved to be the more resilient long-term design even though it didn't win the popularity contest.
