# Audits

Published external security audit reports land here, one per report, named
`YYYY-MM-DD-<scope>.md` (or the auditor's original PDF/format alongside a
short `.md` index entry if the original isn't Markdown).

**Nothing is published here yet.** The first audit this directory expects is
the vault contract's (`contracts/vault`), tracked by issue #1069 ("22.2 Vault
security audit and property tests") and gated per
[`SECURITY.md`'s "Vault audit gate"](../../SECURITY.md#vault-audit-gate-phase-4-worker-layer)
section - the vault contract itself doesn't exist yet either (issue #1068).

When a report is added here:

- It is published in full, including every finding - not a curated summary.
- Any finding that was accepted rather than fixed carries a written
  accepted-risk rationale in the same report.
- `SECURITY.md`'s audit-gate section is updated with a link to the report and
  its landing commit.
