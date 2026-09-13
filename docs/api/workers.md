## Worker Verification & Operator APIs

### Get Verdicts
`GET /api/workers/verdicts`

Public, read-only audit trail for chain-derived verification verdicts (see
`docs/design/worker-verification-verdicts.md`). A subscriber can check
whether their worker fired without asking the operator or running an
indexer.

**Query Parameters:**
* `worker` (required): Subject address (account or contract) the verdicts were computed for.
* `start_ledger` (optional): Only verdicts whose window ends at or after this ledger.
* `end_ledger` (optional): Only verdicts whose window starts at or before this ledger.

**Responses:**
`{ meta: { schemaVersion }, data: Verdict[] }`. Rate limiting, caching and ETags come from the same read policy as `/api/registry-data/*` (#915/#918) - see `apps/web/lib/registryReadPolicy.ts`.

### Get Operator Score
`GET /api/workers/operators`

Public, read-only reputation score for one operator - the same data the
`/workers/[operator]` scorecard page renders.

**Query Parameters:**
* `operator` (required): The operator's id.

**Responses:**
`{ meta: { formulaVersion }, data: { score, metrics } }`, subject to the same read policy as above.

Both endpoints are read-only: there is no route through which an operator (or
anyone else) can write a verdict or a score. Verdicts are chain-derived and
scores are folds over them (see `packages/worker-core/src/reputation/score.ts`).
