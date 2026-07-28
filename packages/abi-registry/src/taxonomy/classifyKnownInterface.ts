import { SEP41_SAC_INTERFACE_ID } from "./wellKnownTaxonomy.js";

const SEP41_SAC_REQUIRED_EVENT_NAMES: readonly string[] = ["transfer", "mint", "burn", "clawback"];

/**
 * Lightweight structural heuristic: classifies a spec as `SEP41_SAC_INTERFACE_ID`
 * when it exposes at least all four canonical SEP-41/SAC events - `transfer`,
 * `mint`, `burn`, `clawback` - by name (verified against this package's own
 * `specs/well-known/sac-interface.json` / `aqua.json`).
 *
 * This checks event *names* only, not topic/data shapes - a contract with
 * same-named-but-differently-shaped events would still classify here. A full
 * structural match (field-by-field, the way `verifySchema.ts` compares specs)
 * would be more precise but is meaningfully more work; this is deliberately
 * the simple version, good enough to make the bundled `wellKnownTaxonomy`'s
 * `interfaceId`-scoped entries resolve for real SAC-conforming contracts
 * out of the box. Tightening it is reasonable follow-up work.
 */
export function classifyKnownInterface(spec: { events: ReadonlyArray<{ name: string }> }): string | undefined {
  const names = new Set(spec.events.map((e) => e.name));
  for (const required of SEP41_SAC_REQUIRED_EVENT_NAMES) {
    if (!names.has(required)) return undefined;
  }
  return SEP41_SAC_INTERFACE_ID;
}
