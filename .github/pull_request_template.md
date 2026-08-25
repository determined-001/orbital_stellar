## Linked issue

Closes #

## What changed and why

<!-- One paragraph. What does this PR do, and why is the change needed? -->

## Test plan

<!-- How did you verify this works? Check everything that applies. -->

- [ ] Existing tests pass (`pnpm test`)
- [ ] New tests added for new behaviour
- [ ] Typechecks pass (`pnpm -r typecheck`)
- [ ] Manually tested against testnet / mainnet (describe what you tested)

## Breaking changes

<!-- Does this change any public API? If yes, describe the migration path. -->

None / Yes (describe below)

## Notes for reviewers

<!-- Anything the reviewer should pay special attention to, or context that isn't obvious from the diff. -->

---

### Reviewer checklist (semantic-data PRs only)

*This section applies when the PR touches `data/` or `packages/abi-registry/schemas/`.
Delete it if the PR does not modify taxonomy or label data.*

- [ ] **Source verification** — Each source URL in the submission has been checked:
  - [ ] URLs resolve and point to a legitimate project page, explorer entry, or attestation
  - [ ] The linked source actually references the claimed contract/entity
  - [ ] No source is a self-hosted or anonymous pastebin
- [ ] **Schema conformance** — The submission validates against the relevant schema (`label.schema.json` or taxonomy schema)
- [ ] **Deduplication** — The submission does not duplicate an existing record in `data/labels/` or the taxonomy index
- [ ] **No self-labeling** — The `submittedBy` field does not match the entity being labelled (conflict-of-interest check)
- [ ] **Confidence matches evidence** — The claimed confidence level is justified by the sources provided
- [ ] **Auto-labels applied** — The PR carries the `area:semantic-data` label (applied automatically by CI)
