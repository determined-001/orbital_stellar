import { NextResponse } from "next/server";

/**
 * GET /api/v1/registry/openapi.json - OpenAPI 3.0 description of the hosted
 * registry read API (issue #915). Hand-written rather than generated: the
 * four routes it documents are small and stable enough that a generator
 * would add a build step for no real accuracy gain here.
 */
const OPENAPI_DOCUMENT = {
  openapi: "3.0.3",
  info: {
    title: "Orbital Hosted Registry API",
    version: "1.0.0",
    description:
      "Read-only access to Orbital's ABI registry: resolved contract specs, the open event taxonomy, and entity labels.",
  },
  servers: [{ url: "/api/v1/registry" }],
  paths: {
    "/spec/{contractId}": {
      get: {
        summary: "Resolve a contract's spec",
        parameters: [
          {
            name: "contractId",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^C[A-Z2-7]{55}$" },
          },
        ],
        responses: {
          "200": {
            description: "The resolved spec",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SpecEnvelope" },
              },
            },
          },
          "400": { description: "Malformed contractId" },
          "404": { description: "No resolved spec for this contract" },
          "501": { description: "?version= is not yet supported" },
        },
      },
    },
    "/taxonomy": {
      get: {
        summary: "The open event taxonomy",
        parameters: [
          { name: "category", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Taxonomy records",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaxonomyEnvelope" },
              },
            },
          },
        },
      },
    },
    "/labels": {
      get: {
        summary: "The open entity-label dataset",
        parameters: [
          { name: "network", in: "query", required: false, schema: { type: "string" } },
          { name: "tag", in: "query", required: false, schema: { type: "string" } },
          { name: "category", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Label records",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LabelEnvelope" },
              },
            },
          },
        },
      },
    },
    "/health": {
      get: {
        summary: "Service health",
        responses: {
          "200": {
            description: "Healthy",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Health" },
              },
            },
          },
          "503": { description: "Degraded - Soroban RPC unreachable" },
        },
      },
    },
  },
  components: {
    schemas: {
      Envelope: {
        type: "object",
        required: ["data", "servedFrom", "asOfLedger", "stale"],
        properties: {
          servedFrom: { type: "string" },
          asOfLedger: { type: "integer" },
          stale: { type: "boolean" },
        },
      },
      SpecEnvelope: {
        allOf: [
          { $ref: "#/components/schemas/Envelope" },
          {
            type: "object",
            properties: {
              data: {
                type: "object",
                required: ["spec", "specHash"],
                properties: {
                  spec: { type: "object", description: "ContractSpec" },
                  specHash: { type: "string", description: "sha256, hex" },
                },
              },
            },
          },
        ],
      },
      TaxonomyEnvelope: {
        allOf: [
          { $ref: "#/components/schemas/Envelope" },
          { type: "object", properties: { data: { type: "array", items: { type: "object" } } } },
        ],
      },
      LabelEnvelope: {
        allOf: [
          { $ref: "#/components/schemas/Envelope" },
          { type: "object", properties: { data: { type: "array", items: { type: "object" } } } },
        ],
      },
      Health: {
        type: "object",
        required: ["status", "lastSyncLedger", "timestamp"],
        properties: {
          status: { type: "string", enum: ["ok", "degraded"] },
          lastSyncLedger: { type: "integer", nullable: true },
          stale: { type: "boolean" },
          timestamp: { type: "string", format: "date-time" },
        },
      },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(OPENAPI_DOCUMENT);
}
