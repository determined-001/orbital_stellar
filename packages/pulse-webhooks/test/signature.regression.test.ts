import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";

import { verifyWebhookRaw } from "../src/index.js";

/**
 * Pinned fixture for ADR-003 / STABILITY.md "Signing format".
 * Do not change `expectedSignature` without a breaking-change release.
 */
const FIXTURE = {
  payload: '{"type":"ping"}',
  secret: "whsec_test_regression_fixture",
  timestamp: "1717000000000",
  expectedSignature: "9c79798b9fb0e2bf9da3c5f0bb8d36977d013f8ed0fe9837cc8a9d3c1017c6c0",
} as const;

describe("webhook signature format regression (ADR-003)", () => {
  it("pins HMAC-SHA256 over ${timestamp}.${payload}", () => {
    const signature = createHmac("sha256", FIXTURE.secret)
      .update(`${FIXTURE.timestamp}.${FIXTURE.payload}`)
      .digest("hex");

    expect(signature).toBe(FIXTURE.expectedSignature);

    expect(
      verifyWebhookRaw(
        FIXTURE.payload,
        FIXTURE.expectedSignature,
        FIXTURE.secret,
        FIXTURE.timestamp,
        { nowMs: Number(FIXTURE.timestamp) },
      ),
    ).toBe(true);
  });
});
