# Contribution Blacklist

This file records contributions rejected for attribution abuse — cases where the
GitHub account that opened a pull request is not the account that authored the
commits inside it.

Orbital participates in the Drips Wave / SCF micro-grant program, which pays out
per merged pull request. Opening a pull request under one account while the
commits inside it are authored by a different account misattributes that payout.
Whether the intent is point farming across multiple accounts or an informal
handoff between contributors, the effect on the reward ledger is the same, so it
is treated as an attribution violation regardless of intent.

## Policy

- Every commit in a pull request must be authored by the account that opened it.
- Co-authored work is welcome, but must be declared with a `Co-authored-by:`
  trailer and the pull request opened by one of the actual authors.
- If your commits show the wrong author, fix your local git identity
  (`git config user.email`) and amend — do not have someone else open the pull
  request for you.
- Confirmed violations are recorded here, the pull request is closed without
  merge, the assignee is removed from the linked issue, and the matter is
  referred to the Drips team for review.

## Recorded violations

### 2026-07-30 — commits authored by `Stephan-Thomas <xevermontes8@gmail.com>` opened under other accounts

A single git identity authored the commits in three pull requests opened by three
different GitHub accounts. Each pull request came from the opener's own fork, so
the accounts were acting in coordination rather than one branch being taken
without permission.

| PR | Opened by | Commit author | Linked issue | Outcome |
|----|-----------|---------------|--------------|---------|
| [#934](https://github.com/determined-001/orbital_stellar/pull/934) | `neyij` | `Stephan-Thomas <xevermontes8@gmail.com>` | [#931](https://github.com/determined-001/orbital_stellar/issues/931) | Closed unmerged. Work was sound and was reapplied to `main` directly; issue closed. |
| [#945](https://github.com/determined-001/orbital_stellar/pull/945) | `probablyABug` | `Stephan-Thomas <xevermontes8@gmail.com>` | [#922](https://github.com/determined-001/orbital_stellar/issues/922) | Closed unmerged. Work did not satisfy the issue; issue remains open. |
| [#946](https://github.com/determined-001/orbital_stellar/pull/946) | `probablyABug` | `Stephan-Thomas <xevermontes8@gmail.com>` | [#918](https://github.com/determined-001/orbital_stellar/issues/918) | Closed unmerged. Work did not satisfy the issue; issue remains open. |

Accounts involved: `neyij`, `probablyABug`, and the commit-author identity
`Stephan-Thomas <xevermontes8@gmail.com>`.

Note on [#939](https://github.com/determined-001/orbital_stellar/pull/939):
opened by `Stephan-Thomas` with commits authored by the same identity.
Authorship is self-consistent there, so it is **not** a violation and was
reviewed on its technical merits like any other pull request.
