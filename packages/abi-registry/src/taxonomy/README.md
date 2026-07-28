# Semantic taxonomy resolver

Implements issue **11.1** ("Semantic taxonomy resolver"): given a raw Soroban
event's `(contractId, eventTopic, specHash?, interfaceId?)`, deterministically
resolves a canonical semantic name (e.g. `swap.executed`, `loan.liquidated`)
per a fixed precedence, or leaves it unmapped - never guessed.

## ⚠️ Standing in for issue 7.7

Issue 11.1 explicitly depends on a separate issue, "7.7", described as owning
the taxonomy record format (`taxonomy.schema.json`), its naming rules, and its
collision policy - 11.1 is only supposed to implement a resolution *engine*
against that already-agreed format, not invent it.

**At the time this was implemented, issue 7.7 could not be found anywhere**:
no matching GitHub issue (open or closed, by title or by content search), no
`taxonomy.schema.json` on `main`, and no roadmap entry numbered "7.7" in
`ROADMAP.md`. Rather than block indefinitely, the schema
(`schema/taxonomy.schema.json`), its naming rule (dot-separated lowercase
segments, e.g. `swap.executed`), and its collision policy (same-tier,
same-scope-and-topic mappings that disagree are a load-time
`TaxonomyConflictError`) were designed here, as a placeholder.

**If/when issue 7.7 actually lands with a different record shape or collision
policy, that's the one that wins.** This module's schema and error semantics
should be reconciled to match it, not the other way around - per 11.1's own
instructions ("if 7.7's collision policy turns out to be unimplementable as
written, fix it in 7.7 rather than diverging here"), the intent was always
that 7.7 is authoritative once it exists.

## Design

- **Precedence** (`TaxonomyResolver.resolve`): exact `contractId` > `specHash`
  (a WASM/spec-hash family - many deployments sharing the same contract code)
  > `interfaceId` (a structural SEP-interface match, e.g. "this looks like a
  SEP-41 token") > unmapped.
- **Conflicts** are load-time, not resolve-time: `TaxonomyResolver.load()`
  throws `TaxonomyConflictError` the moment two mappings at the *same* tier
  target the same scope + `eventTopic` with *different* semantic names.
  Registering the identical mapping twice (same semantic) is a harmless
  no-op, not a conflict.
- **`eventTopic`** is the event's decoded first topic symbol (e.g.
  `"transfer"`), matching `DecodedEvent.functionName` from `../decode.ts` -
  not the raw topics array.
- Validation (`validateTaxonomyRecord`) is hand-written TypeScript mirroring
  `taxonomy.schema.json`'s constraints, matching this package's existing
  convention (see `../spec.ts`'s `validateSpec`) of not pulling `ajv` into the
  runtime bundle - `ajv` stays a devDependency for `validate.js`.

## Bundled data

`wellKnownTaxonomy` covers the SEP-41 / SAC event set (`transfer`, `mint`,
`burn`, `clawback` - verified against this package's own
`specs/well-known/sac-interface.json` / `aqua.json`) at the `interfaceId`
tier, plus one illustrative mainnet AMM `swap` -> `swap.executed` entry. The
AMM entry is a starting point, not a verified on-chain fact - see the comment
in `wellKnownTaxonomy.ts`. A real integration should add `contractId`- or
`specHash`-scoped entries for the specific AMMs it indexes; those take
precedence over the generic interface-tier fallback automatically.

## Usage

```ts
import { loadTaxonomyResolver, wellKnownTaxonomy } from "@orbital-stellar/abi-registry";

const resolver = loadTaxonomyResolver([wellKnownTaxonomy]);

resolver.resolve({ contractId: "C...", eventTopic: "transfer", interfaceId: "sep41-sac" });
// -> "token.transferred"

resolver.resolve({ contractId: "C...", eventTopic: "unknown_event" });
// -> undefined (never guessed)
```
