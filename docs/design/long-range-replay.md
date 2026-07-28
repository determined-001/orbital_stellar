# Long-range replay: design doc (issue #920 / "12.6")

**Status: draft, not maintainer-signed-off.** Issue #920's own acceptance
criteria require this doc to be "signed off by a maintainer before
implementation." No maintainer review has happened. This draft exists as a
stand-in so the `HistoricalSource` interface and reference adapter added
alongside it (see below) have *something* concrete to be reviewed against,
per an explicit user decision to proceed this way rather than leave the issue
untouched. Treat every recommendation below as a starting proposal, not a
decision. If maintainer review changes the source choice, reconcile the code
to that decision, not the other way around - the same posture already taken
for the taxonomy placeholder in `packages/abi-registry/src/taxonomy/README.md`
(issue "7.7").

## A note on this issue's own prerequisites

Issue #920 names three dependencies: "6.12" (transport routing), "6.14"
(unified cursor format), and "8.4" (issue #891, an e2e test). As of this
writing:

- **"6.12" and "6.14" do not correspond to any findable GitHub issue** in
  `determined-001/orbital_stellar` (searched by number and title text - no
  match). They may be internal roadmap/tracker numbering that was never filed
  as issues, or issues that were since renumbered or removed.
- **"8.4" (#891) is open and itself labeled `blocked`** - not done.
- The roadmap (`ROADMAP.md`, Wave 2.4) lists this item as **"not yet
  scheduled to a wave."**

None of the three prerequisites this issue says to build on top of actually
exist yet. That's a real risk: implementing `EventEngine` routing changes now,
before "6.12"'s routing design and "6.14"'s cursor format exist, means
guessing at both and likely conflicting with whatever they turn out to be.
This is why the code in this change is deliberately **not wired into
`EventEngine`** - see "Scope of this change" below.

## Problem

Soroban RPC retains roughly seven days of ledger history (see
`OnChainAbiRegistryClient`'s `DEFAULT_LOOKBACK_LEDGERS` comment and
`packages/abi-registry/CHANGELOG.md` for the same constraint surfacing
elsewhere in this codebase). Audit and compliance use cases - the anchor
starter in particular - need replay across months. Today, a cursor pointing
at a ledger the RPC no longer serves fails with whatever raw error the RPC
happens to return; there's no code path that recognizes "this cursor
predates retention" as a distinct, nameable condition.

## Candidate sources

### Option A - Galexie exports (Composable Data Platform)

Galexie is Stellar's ledger-export tool: it consumes `LedgerCloseMeta` from
Captive Core and writes it out as compressed XDR files, partitioned by ledger
range, to an object-storage bucket (GCS/S3-compatible). A long-range replay
source built on this reads those exported files directly and re-derives
contract events from the raw ledger data - no RPC involved for the
beyond-retention range.

**Cost.** Bucket storage + egress bandwidth, borne by whoever operates the
bucket (Orbital, if self-hosted; free if consuming an SDF- or
community-operated public export instead). No compute cost beyond
per-request XDR parsing - there's no always-on service, so idle cost is
near zero.

**Latency.** Higher per-event latency than RPC (fetch + decompress + parse a
whole ledger-range file to extract a handful of events), but replay of a
beyond-retention range is inherently a batch/backfill operation, not a
latency-sensitive one. Acceptable.

**Fit with the roadmap's own framing.** `ROADMAP.md` Wave 2.4 explicitly
names this: "built on top of the Composable Data Platform (Galexie exports)
and CAP-67 retroactive backfill, not as an Orbital-operated ledger store."
Reading directly from an export bucket per-request, with no persistent
Orbital-side ledger database, satisfies "not an Orbital-operated ledger
store" literally - there's nothing to operate, only a store to read.

**Downside.** Nobody on this session's task has verified Galexie's actual
object-key/partitioning scheme against a live bucket - the reference adapter
below makes that scheme a caller-supplied parameter for exactly this reason
(see "Verification gap"). Parsing `LedgerCloseMeta` XDR to re-derive
contract events (walking `TransactionMeta` v3's `sorobanMeta`) is also
untested against real exported data in this session - no Node runtime was
available to run it.

### Option B - RPC with extended retention (`BACKFILL_STELLAR_ASSET_EVENTS`)

Some Soroban RPC operators can run with an extended event-retention window
(the closed issue-6.15 e2e harness already targets an arbitrary RPC via
`BACKFILL_RPC_URL`/`BACKFILL_START_LEDGER`/`BACKFILL_END_LEDGER` env vars -
see `packages/pulse-core/test/integration/backfillReplay.e2e.test.ts`). A
long-range source here is just `EventEngine.replayContracts()` pointed at
such an RPC - no new code needed at all, only an operational dependency on
finding/running an RPC with the extended window.

**Cost.** Whatever the RPC operator charges (or the compute/storage cost of
running one) for the extended retention window - this is not a fixed,
predictable cost the way bucket storage is, and depends entirely on which
operator's RPC is used.

**Latency.** Lowest - it's the same `getEvents` RPC call path already in
production use, no new parsing.

**Downside.** This is **not** what `ROADMAP.md` names as the answer, and
depending on one RPC operator's willingness to serve months of history
is a single point of control Orbital doesn't own. It also doesn't fit "not an
Orbital-operated ledger store" as cleanly if Orbital ends up running that
extended-retention RPC node itself.

## Recommendation

**Galexie export-bucket reads (Option A) as the primary `HistoricalSource`
implementation**, matching the roadmap's explicit wording. Option B remains
useful as a **stopgap for the existing e2e harness** (issue 6.15's test
already exercises it, and that test should keep doing so rather than being
duplicated) but should not become the long-term `HistoricalSource`
reference adapter, since it's the one path the roadmap explicitly says
*not* to build the permanent story on.

This recommendation is not maintainer-approved. It is the basis for the
`GalexieHistoricalSource` reference adapter added alongside this doc.

## Scope of this change

Per an explicit user decision (given the missing "6.12"/"6.14" prerequisites
above), this change adds:

1. `packages/pulse-core/src/HistoricalSource.ts` - a standalone interface
   for a beyond-retention historical source, plus a `RetentionBoundaryError`
   naming the retention boundary and the configured source name (satisfying
   the issue's "out-of-retention errors name the retention boundary and the
   configured historical source" acceptance criterion in isolation).
2. `GalexieHistoricalSource`, one reference adapter implementing that
   interface against Galexie-style exported ledger files.

It deliberately does **not**:

- Wire `HistoricalSource` into `EventEngine` or `CursorStore` - "6.12"'s
  transport-routing design doesn't exist yet to plug into, and the issue
  itself says not to add a second, parallel source-selection path.
- Define a new cursor format - "6.14" doesn't exist yet either. The
  interface's cursor fields are typed as opaque strings, matching every
  other cursor in this codebase (`CursorStore`'s own doc comment: "Cursor
  values are source-local opaque strings"). When "6.14" lands, reconcile to
  its format.
- Extend the issue-6.15 e2e harness. That harness tests the *existing*
  RPC-based `replayContracts()` path (Option B) against a live RPC; this
  change adds no live-network code that harness would exercise, since
  nothing here is wired into `EventEngine` yet. Extending it is future work
  once `HistoricalSource` actually has a caller.

## Verification gap

Nothing in this change has been run against a live Galexie bucket or a real
exported `LedgerCloseMeta` file - there is no Node.js runtime available in
the environment this change was authored in (true throughout this session;
every other PR in this session carries the same caveat). The reference
adapter's XDR-parsing assumptions (`LedgerCloseMeta` v1/v2's
`txProcessing` → `TransactionMeta` v3 → `sorobanMeta().events()` path) match
the public CAP-46/CAP-67 XDR schema as documented, but the exact
`@stellar/stellar-sdk` generated accessor names have not been checked
against the installed SDK version. Treat the adapter as illustrative of the
intended shape, not verified-working code, until it's actually run against
a real export.
