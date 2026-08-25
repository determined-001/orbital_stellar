/**
 * CoreConfig.ingestion config flag (issue 6.11).
 *
 * Config surface only, per the issue: the flag exists, validates, and is
 * exposed in status(). Routing behavior itself (what a given mode actually
 * changes about event delivery) is separate, forthcoming work.
 */
import { describe, it, expect } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import { InvalidIngestionModeError } from "../src/errors.js";
import type { IngestionMode } from "../src/index.js";

describe("CoreConfig.ingestion", () => {
  it("defaults to horizon when omitted", () => {
    const engine = new EventEngine({ network: "testnet" });
    expect(engine.status().ingestion).toBe("horizon");
  });

  it.each<IngestionMode>(["unified", "horizon", "auto"])(
    "accepts and reports the explicit value %s",
    (mode) => {
      const engine = new EventEngine({ network: "testnet", ingestion: mode });
      expect(engine.status().ingestion).toBe(mode);
    },
  );

  it("throws InvalidIngestionModeError for an unknown value", () => {
    expect(
      () => new EventEngine({ network: "testnet", ingestion: "sometimes" as IngestionMode }),
    ).toThrow(InvalidIngestionModeError);
  });

  it("throws InvalidIngestionModeError with a message naming the bad value", () => {
    expect(
      () => new EventEngine({ network: "testnet", ingestion: "bogus" as IngestionMode }),
    ).toThrow(/bogus/);
  });

  it("propagates the configured mode to multi-network sub-engines", () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
      ingestion: "unified",
    });
    expect(engine.status().ingestion).toBe("unified");
  });

  it("defaults to horizon for multi-network engines too", () => {
    const engine = new EventEngine({
      network: [{ network: "testnet" }, { network: "mainnet" }],
    });
    expect(engine.status().ingestion).toBe("horizon");
  });

  it("rejects an invalid mode for a multi-network engine", () => {
    expect(
      () =>
        new EventEngine({
          network: [{ network: "testnet" }],
          ingestion: "sometimes" as IngestionMode,
        }),
    ).toThrow(InvalidIngestionModeError);
  });
});
