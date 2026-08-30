# `@orbital-stellar/worker-core`

Off-chain workers that submit Soroban invocations when a condition becomes true.

The worker definition model, trigger union, and executor are specified in issue 18.3. This package currently ships first-party backstop SLO evaluation (`evaluateBackstopSlo`) so Orbital is scored with the same engine as every other operator.

See `docs/runbooks/backstop.md` for the three SLO alerts.
