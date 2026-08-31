import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const runbookPath = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../docs/runbooks/backstop.md",
);

describe("docs/runbooks/backstop.md", () => {
  it("documents missed intervention, XLM float, and monitoring lag", () => {
    const text = readFileSync(runbookPath, "utf8");
    expect(text).toMatch(/missed intervention/i);
    expect(text).toMatch(/XLM float/i);
    expect(text).toMatch(/monitoring lag/i);
  });
});
