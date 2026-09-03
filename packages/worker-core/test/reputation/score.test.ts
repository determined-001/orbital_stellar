import { describe, it, expect } from "vitest";
import {
  type Verdict,
  type VerdictOutcome,
  computeWindowMetrics,
  percentile,
  selectWindow,
} from "../../src/reputation/window.js";
import {
  DEFAULT_WEIGHTS,
  SCORE_FORMULA_VERSION,
  attributableDrop,
  scoreOperator,
  type ScoreConfig,
} from "../../src/reputation/score.js";

const OP = "op_aether";

function verdict(id: string, at: number, outcome: VerdictOutcome, latencyMs = 0): Verdict {
  return { id, operatorId: OP, at, outcome, latencyMs };
}

const DAY = 86_400_000;

const baseConfig: ScoreConfig = {
  formulaVersion: SCORE_FORMULA_VERSION,
  windowMs: 30 * DAY,
  halfLifeMs: 7 * DAY,
  minSamples: 20,
  latencyTargetMs: 2000,
};

const ASOF = 1_000_000_000_000;

describe("window.percentile (R-7 linear interpolation)", () => {
  it("returns the median of an odd-count array", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it("interpolates for non-rank percentiles", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBeCloseTo(4.8, 6);
  });

  it("returns the single value for length 1", () => {
    expect(percentile([42], 0.95)).toBe(42);
  });

  it("throws on empty input", () => {
    expect(() => percentile([], 0.5)).toThrow();
  });
});

describe("window.selectWindow / computeWindowMetrics", () => {
  it("includes only in-window verdicts for the operator, sorted by time", () => {
    const others = [
      verdict("old", ASOF - 100 * DAY, "success", 500),
      verdict("in", ASOF - 5 * DAY, "success", 700),
      {
        id: "other-op",
        operatorId: "someone-else",
        at: ASOF - DAY,
        outcome: "success",
        latencyMs: 9,
      },
    ];
    const sel = selectWindow(others, OP, baseConfig.windowMs, ASOF);
    expect(sel.verdicts.map((v) => v.id)).toEqual(["in"]);
    const m = computeWindowMetrics(sel);
    expect(m.total).toBe(1);
    expect(m.successes).toBe(1);
    expect(m.latencyP50Ms).toBe(700);
    expect(m.latencyP95Ms).toBe(700);
    expect(m.uptime).toBe(1);
    expect(m.missRate).toBe(0);
  });

  it("drops verdicts older than the window", () => {
    const vs = [
      verdict("in", ASOF - 1_000, "success", 100),
      verdict("out", ASOF - baseConfig.windowMs - 1, "success", 100),
    ];
    const m = computeWindowMetrics(selectWindow(vs, OP, baseConfig.windowMs, ASOF));
    expect(m.total).toBe(1);
  });
});

describe("score.scoreOperator - insufficient_data", () => {
  it("reports insufficient_data instead of a default score for a new operator", () => {
    const vs = Array.from({ length: 5 }, (_, i) => verdict(`s${i}`, ASOF, "success", 1000));
    const r = scoreOperator(vs, OP, baseConfig, ASOF);
    expect(r.status).toBe("insufficient_data");
    if (r.status === "insufficient_data") {
      expect(r.samples).toBe(5);
      expect(r.minSamples).toBe(20);
      expect("score" in r).toBe(false);
    }
  });
});

describe("score.scoreOperator - golden worked example", () => {
  // 16 successes @1000ms + 4 misses, all at ASOF (age 0 => weight 1).
  const vs: Verdict[] = [
    ...Array.from({ length: 16 }, (_, i) => verdict(`s${i}`, ASOF, "success", 1000)),
    ...Array.from({ length: 4 }, (_, i) => verdict(`m${i}`, ASOF, "miss")),
  ];

  it("computes the documented score, availability and latency quality", () => {
    const r = scoreOperator(vs, OP, baseConfig, ASOF);
    expect(r.status).toBe("scored");
    if (r.status !== "scored") return;
    // availability = 16/20 = 0.8; latency quality = 1 (p95 1000 <= target 2000)
    // score = round(1000 * (0.7*0.8 + 0.3*1)) = round(860) = 860
    expect(r.score).toBe(860);
    expect(r.components.availability).toBeCloseTo(0.8, 9);
    expect(r.components.missRate).toBeCloseTo(0.2, 9);
    expect(r.components.latencyP50Ms).toBe(1000);
    expect(r.components.latencyP95Ms).toBe(1000);
    expect(r.components.latencyQuality).toBe(1);
    expect(r.formulaVersion).toBe(SCORE_FORMULA_VERSION);
  });

  it("attributes the score to the four misses, each worth -35 points", () => {
    const r = scoreOperator(vs, OP, baseConfig, ASOF);
    expect(r.status).toBe("scored");
    if (r.status !== "scored") return;
    expect(r.contributors).toHaveLength(4);
    for (const c of r.contributors) {
      expect(c.reason).toBe("miss");
      expect(c.impact).toBeCloseTo(-35, 9);
    }
  });
});

describe("score.scoreOperator - recency weighting", () => {
  it("penalizes a recent miss more than an equally-old miss", () => {
    const recent: Verdict[] = [
      ...Array.from({ length: 19 }, (_, i) => verdict(`s${i}`, ASOF, "success", 1000)),
      verdict("m_recent", ASOF, "miss"),
    ];
    const old: Verdict[] = [
      ...Array.from({ length: 19 }, (_, i) => verdict(`s${i}`, ASOF, "success", 1000)),
      verdict("m_old", ASOF - baseConfig.windowMs, "miss"),
    ];
    const recentScore = scoreOperator(recent, OP, baseConfig, ASOF);
    const oldScore = scoreOperator(old, OP, baseConfig, ASOF);
    expect(recentScore.status).toBe("scored");
    expect(oldScore.status).toBe("scored");
    if (recentScore.status !== "scored" || oldScore.status !== "scored") return;
    // recent miss (weight 1) hurts more than an aged miss (weight ~0.051)
    expect(recentScore.score).toBeLessThan(oldScore.score);
  });
});

describe("score.scoreOperator - formula version enforcement", () => {
  it("throws when config.formulaVersion does not match the stamped version", () => {
    const vs = Array.from({ length: 20 }, (_, i) => verdict(`s${i}`, ASOF, "success", 1000));
    expect(() => scoreOperator(vs, OP, { ...baseConfig, formulaVersion: "9.9.9" }, ASOF)).toThrow(
      /formulaVersion/,
    );
  });
});

describe("score.scoreOperator - recomputability", () => {
  it("is order-independent and reproducible from the same verdicts", () => {
    const vs: Verdict[] = [
      ...Array.from({ length: 16 }, (_, i) =>
        verdict(`s${i}`, ASOF - (i % 3) * DAY, "success", 800 + i * 10),
      ),
      ...Array.from({ length: 4 }, (_, i) => verdict(`m${i}`, ASOF - i * DAY, "miss")),
    ];
    const a = scoreOperator(vs, OP, baseConfig, ASOF);
    const shuffled = [...vs].sort(() => 0.5 - Math.random());
    const b = scoreOperator(shuffled, OP, baseConfig, ASOF);
    expect(a).toEqual(b);
  });

  it("stays within [0, 1000] even for an all-miss window", () => {
    const vs = Array.from({ length: 20 }, (_, i) => verdict(`m${i}`, ASOF, "miss"));
    const r = scoreOperator(vs, OP, baseConfig, ASOF);
    expect(r.status).toBe("scored");
    if (r.status === "scored") {
      expect(r.score).toBe(0);
      expect(r.components.latencyQuality).toBe(0);
    }
  });
});

describe("score.attributableDrop", () => {
  it("links a score drop to the newly-arrived verdicts", () => {
    const before: Verdict[] = Array.from({ length: 20 }, (_, i) =>
      verdict(`s${i}`, ASOF, "success", 1000),
    );
    const after: Verdict[] = [...before, verdict("m_new", ASOF, "miss")];
    const beforeScore = scoreOperator(before, OP, baseConfig, ASOF);
    const afterScore = scoreOperator(after, OP, baseConfig, ASOF);
    const dropped = attributableDrop(beforeScore, afterScore);
    expect(dropped.map((v) => v.id)).toEqual(["m_new"]);
  });

  it("returns [] if either side is not scored", () => {
    const few = Array.from({ length: 5 }, (_, i) => verdict(`s${i}`, ASOF, "success", 1000));
    const many = Array.from({ length: 20 }, (_, i) => verdict(`s${i}`, ASOF, "success", 1000));
    const insufficient = scoreOperator(few, OP, baseConfig, ASOF);
    const scored = scoreOperator(many, OP, baseConfig, ASOF);
    expect(attributableDrop(insufficient, scored)).toEqual([]);
    expect(attributableDrop(scored, insufficient)).toEqual([]);
  });
});

describe("score defaults", () => {
  it("exposes sensible default weights", () => {
    expect(DEFAULT_WEIGHTS).toEqual({ availability: 0.7, latency: 0.3 });
  });
});
