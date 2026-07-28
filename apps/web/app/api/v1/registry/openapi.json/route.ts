export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const META_PROPERTIES = {
  servedFrom: {
    type: "string",
    enum: ["cache", "live"],
    description: "Whether this response came from the read-through cache or a live upstream call.",
  },
  stale: {
    type: "boolean",
    description:
      "True if this is a cached value past its TTL, served during its stale-while-revalidate window while a background refresh runs. Never silently omitted.",
  },
  asOfLedger: {
    type: ["integer", "null"],
    description: "Chain height this response reflects. Null only if the RPC was unreachable and nothing has ever been cached.",
  },
} as const;

const OPENAPI_DOCUMENT = {
  openapi: "3.0.3",
  info: {
    title: "Orbital hosted registry read API",
    version: "1.0.0",
    description:
      "Read-only API for schemas, taxonomy, and labels from Orbital's on-chain ABI registry (issue #915 / \"12.1\"). " +
      "Versioned from day one at /v1 - the client in issue 12.2 pins to this path. " +
      "Entity labels (issue 11.2 / #910) are not implemented yet; that endpoint always returns an honestly empty list.",
  },
  servers: [{ url: "/api/v1/registry" }],
  paths: {
    "/spec/{contractId}": {
      get: {
        summary: "Resolve a contract's published ABI spec",
        parameters: [
          {
            name: "contractId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "A Soroban contract address (C...).",
          },
          {
            name: "version",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "An exact published version. Omit to resolve the latest.",
          },
        ],
        responses: {
          "200": {
            description: "Spec resolved.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    contractId: { type: "string" },
                    version: { type: "string" },
                    specHash: { type: "string", description: "sha256 hex digest of the canonicalized spec." },
                    spec: { type: "object", description: "The canonical ContractSpec." },
                    ...META_PROPERTIES,
                  },
                },
              },
            },
          },
          "400": { description: "Invalid contract ID." },
          "404": { description: "No spec published for this contract (or this version)." },
          "503": { description: "Registry not configured (not yet deployed/seeded - see issue 8.3)." },
        },
      },
    },
    "/taxonomy": {
      get: {
        summary: "Fetch the bundled semantic taxonomy record",
        responses: {
          "200": {
            description: "Taxonomy record.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    taxonomy: { type: "object", description: "TaxonomyRecord - see @orbital-stellar/abi-registry." },
                    taxonomyHash: { type: "string", description: "sha256 hex digest of the JSON-serialized record." },
                    ...META_PROPERTIES,
                  },
                },
              },
            },
          },
        },
      },
    },
    "/labels": {
      get: {
        summary: "Fetch entity labels (not yet implemented - issue 11.2 / #910)",
        responses: {
          "200": {
            description: "Always an empty list today - see notImplemented.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    labels: { type: "array", items: {}, maxItems: 0 },
                    notImplemented: { type: "boolean", enum: [true] },
                    message: { type: "string" },
                    ...META_PROPERTIES,
                  },
                },
              },
            },
          },
        },
      },
    },
    "/health": {
      get: {
        summary: "Registry API health and last-sync ledger",
        responses: {
          "200": {
            description: "Healthy, or not-yet-configured (an expected pre-launch state).",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    configured: { type: "boolean" },
                    rpcReachable: { type: "boolean" },
                    lastSyncLedger: { type: ["integer", "null"] },
                    registryContractId: { type: ["string", "null"] },
                    publisher: { type: ["string", "null"] },
                    checkedAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "503": { description: "Configured but the RPC is currently unreachable." },
        },
      },
    },
  },
} as const;

export async function GET() {
  return Response.json(OPENAPI_DOCUMENT);
}
