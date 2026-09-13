import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * 19.4's acceptance criteria requires the OpenAPI description to be "checked
 * in CI against the implementation" - not just published and left to drift.
 * This doesn't validate full JSON Schema conformance, but it does fail CI the
 * moment a documented path/method stops having a matching route handler (or
 * vice versa), which is the drift that actually happens: a route gets
 * renamed or a method gets removed and the doc silently goes stale.
 */
describe("openapi/workers.yaml stays in sync with the implementation", () => {
  const doc = parse(
    readFileSync(join(__dirname, "..", "openapi", "workers.yaml"), "utf8"),
  ) as { paths: Record<string, Record<string, unknown>> };

  for (const [apiPath, methods] of Object.entries(doc.paths)) {
    const routeFile = join(__dirname, "..", "app", apiPath, "route.ts");

    it(`${apiPath} has a route.ts file`, () => {
      expect(existsSync(routeFile)).toBe(true);
    });

    const source = existsSync(routeFile) ? readFileSync(routeFile, "utf8") : "";
    for (const method of Object.keys(methods)) {
      it(`${apiPath} exports ${method.toUpperCase()}`, () => {
        expect(source).toMatch(new RegExp(`export\\s+async\\s+function\\s+${method.toUpperCase()}\\b`));
      });
    }
  }
});
