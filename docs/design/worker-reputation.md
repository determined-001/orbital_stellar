# Worker operator reputation scoring

Implements issue 19.3 (Phase 4, W1: verification and reputation). The code lives
in `packages/worker-core/src/reputation/{window,score}.ts`; the tests live in
`packages/worker-core/test/reputation/score.test.ts`.

The score is a single `0..1000` number per operator, computed from
chain-derived **verdicts** (§C.6). It is objective and tamper-resistant because
it never depends on operator self-reporting: the timestamp (`at`) and the
outcome come from the chain, not from the operator.

This document is the formula-in-prose that ships next to the code. The formula
is a **judgment surface**, not just arithmetic: the windowing, the recency
weighting of a recent miss against an old one, and how a brand-new operator is
represented all change operator behavior. The formula was reviewed before it
shipped, and it is **version-stamped** so a recomputation under a future formula
is distinguishable from a real performance change.

---

## Inputs: the verdict

```ts
interface Verdict {
  id: string;            // stable on-chain id - attribution keys off this
  operatorId: string;
  at: number;            // chain-derived epoch ms - never operator-supplied
  outcome: "success" | "miss";
  latencyMs: number;     // meaningful only when outcome === "success"
}
```

The single source of truth is the array of verdicts. Everything below is
recomputed from it; there is no incremental accumulator that can drift from its
inputs.

---

## Step 1 - windowing (`window.ts`)

Given a sliding window of length `windowMs` ending at `asOf`, keep only the
verdicts for the operator with `windowStart <= at <= asOf`, where
`windowStart = asOf - windowMs`. Verdicts for other operators are ignored.

From that window we compute the raw, unweighted metrics (these satisfy the
"uptime, p50/p95 latency and miss-rate per operator over a configurable window"
requirement):

- `total` = number of verdicts in the window
- `successes`, `misses`
- `uptime = successes / total` (availability, `[0, 1]`)
- `missRate = misses / total` (`[0, 1]`)
- `latencyP50Ms`, `latencyP95Ms` = percentiles of the successful verdicts'
  latencies, using **linear interpolation between closest ranks** (R-7 /
  `PERCENTILE.INC`):

  ```
  idx = p * (n - 1)            // n = number of successful latencies
  lo  = floor(idx);  hi = ceil(idx)
  pct = sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])
  ```

  If there are no successes, both latency percentiles are `null`.

---

## Step 2 - scoring (`score.ts`)

### Recency weighting

Each verdict's age is `age = asOf - at >= 0`. Its weight is

```
w = 0.5 ^ (age / halfLifeMs)
```

A verdict exactly at `asOf` has weight `1`; a verdict one `halfLifeMs` old has
weight `0.5`. This is what makes **a recent miss hurt more than an old one** -
both are counted, but the recent one counts for more.

### Availability and miss-rate (recency-weighted)

```
successWeight = Σ w  over successes
missWeight    = Σ w  over misses
totalWeight   = successWeight + missWeight
availability  = successWeight / totalWeight        // [0, 1]
missRate      = missWeight    / totalWeight        // [0, 1]
```

### Latency quality

```
p95 = latencyP95Ms from Step 1   (null when no successes -> quality 0)
latencyQuality = clamp01( 1 - max(0, p95 - latencyTargetMs) / latencyTargetMs )
```

So latency quality is `1` when p95 is at or below the SLO target, and falls
linearly to `0` as p95 reaches `2x` the target.

### Combined score

With weights `a = availability`, `b = latency` (defaults `a = 0.7`,
`b = 0.3`, need not sum to 1):

```
availScale   = a / (a + b)
latencyScale = b / (a + b)
score = round( 1000 * (availScale * availability + latencyScale * latencyQuality) )
```

The score is clamped to `[0, 1000]` and rounded to an integer.

### New operators: no default score

If `total < minSamples` the result is `insufficient_data` - it carries the
sample count and the threshold, but **no score**. A new operator is never shown
a neutral `500` or a penalty `0`; it is shown "insufficient data" until it has
earned enough verdicts to be judged. This avoids both an unintended endorsement
and an unintended penalty.

### Version stamp

Every score carries `formulaVersion`, which must equal
`SCORE_FORMULA_VERSION` (`"1.0.0"`). `scoreOperator` refuses to run with a
mismatched version, so a stale stamp can never silently masquerade as current.
When the formula changes, bump the constant; new scores are stamped with the new
version and are distinguishable from a real performance change by that stamp.

---

## Step 3 - attribution (`attributableDrop`)

A score change is attributable: every `scored` result lists its `contributors`,
the verdicts that dragged it down:

- each **miss** contributes `-(w / missWeight) * (1000 * availScale * (1 - availability))`
  points - i.e. its recency-weighted share of the availability penalty;
- each **slow** success (latency above `latencyTargetMs`) contributes an even
  share of the latency-quality penalty.

`attributableDrop(before, after)` returns the verdicts present in `after`'s
contributors but not in `before`'s. Because both scores are recomputable from
verdicts, "your score fell because of these verdicts" is just two recomputations
(diffing `asOf` forward) and a set difference. Attribution is a product feature,
not a debug aid.

---

## Worked example (the golden test)

Config: `windowMs = 30d`, `halfLifeMs = 7d`, `minSamples = 20`,
`latencyTargetMs = 2000`, weights `a = 0.7, b = 0.3`.

Window contents (all at `asOf`, so every weight `= 1`):

- 16 successes, each latency `1000ms`
- 4 misses

```
total = 20                                   -> scored (>= minSamples)
successWeight = 16, missWeight = 4, total = 20
availability = 16/20 = 0.8
missRate    = 4/20  = 0.2
p50 = p95 = 1000 (all successes equal)
latencyQuality = clamp01(1 - max(0, 1000 - 2000)/2000) = 1
score = round(1000 * (0.7*0.8 + 0.3*1)) = round(1000 * 0.86) = 860
```

Contributors: the 4 misses, each worth
`-(1/4) * (1000 * 0.7 * (1 - 0.8)) = -(1/4) * 140 = -35` points. No slow
verdicts (1000ms <= 2000ms target). This exact arithmetic is pinned by
`score.test.ts` ("golden worked example"), so a formula change cannot sneak in.

---

## What this is NOT

Per §C.4, the score carries **no staking, slashing, or bonding**. It is
information: a marketplace signal operators can read and a dispute can replay.
The economics of making a score "binding" stay out of this module. Do not add
staking/slashing/bonding here.

Recomputability is the property that makes the score defensible: a disputed
score is reproduced from the stored verdicts alone, under the stamped formula
version, and the `contributors` show exactly which verdicts produced it.
