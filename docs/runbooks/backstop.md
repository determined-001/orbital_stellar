# Backstop SLO alerts

Orbital's first-party backstop is scored from the same chain-derived window
verdicts as every other operator. These alerts fire when that score, or the
readiness conditions underneath it, leave the bounds the subscriber was sold
(issue 21.3 / 21.4).

Each section is one `AlertManager` transition. Confirm on the ledger before
acting; the score is information, not a slash.

## Missed intervention

**Fires when** an evaluated Orbital backstop window has status `missed`: the
primary did not fire inside the latency bound and the first-party fallback
also did not fire inside the grace period.

**Confirm**

1. Take the window's ledger range from the verdict store.
2. Check whether the target contract was invoked in that range (stellar.expert
   or `stellar contract` history). A late primary that landed inside grace is
   `late`, not `missed`.
3. Check 18.6's claim: a double-fire against a primary that arrived inside
   grace is a watcher bug (21.1), not an SLO miss.

**Act**

- If the fallback never submitted: inspect `BackstopWatcher` logs for the
  window id, then submit only if the claim slot is still open.
- If the fallback submitted and the chain shows it, the verdict engine (19.1)
  is wrong — do not fire again.
- Notify the subscriber only after the intervention row is recorded.

## XLM float below threshold

**Fires when** the operator account's XLM balance in stroops is below
`xlmFloatMinStroops` on the subscribed tier.

**Confirm**

1. Read the native balance of the backstop operator account from Horizon/RPC.
2. Compare to the machine-readable floor on the current subscription version.
   Do not use a dashboard estimate.

**Act**

- Top up the operator account above the floor before the next window.
- Pause new backstop subscriptions if the float cannot be restored inside one
  grace period.
- Do not move funds from subscriber accounts to cover the float.

## Monitoring lag exceeding the grace period

**Fires when** `chainHeadLedger - lastProcessedLedger` is greater than
`monitoringLagGraceLedgers`. Lag is the leading indicator: by the time an
intervention is missed, the subscriber is already affected.

**Confirm**

1. Compare the worker's cursor / last processed ledger to the network head.
2. Check EventEngine status (`engine.reconnecting`, `engine.rate_limited`).
   A stalled cursor with a live process is still a lag breach.

**Act**

- Restore ingestion (RPC / Horizon) until lag is ≤ the grace bound.
- Do not mark windows `missed` while lag is above grace — they are
  `unverifiable` until the cursor catches up, then recompute from the chain.
- If lag stays above grace for more than one window, page the on-call and
  stop selling new time-insensitive coverage.
