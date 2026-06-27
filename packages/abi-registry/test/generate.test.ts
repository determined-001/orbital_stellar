import { describe, expect, it } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import { generateContractArtifacts } from "../src/generate.js";
import type { ContractSpec } from "../src/types.js";

function createEventEntry(name: string, params: Array<{ name: string; type: xdr.ScSpecTypeDef }>) {
  const entry = xdr.ScSpecEntry.scSpecEntryEventV0(
    new xdr.ScSpecEventV0({
      doc: "",
      lib: "",
      name,
      prefixTopics: [],
      params: params.map(
        ({ name: paramName, type }) =>
          new xdr.ScSpecEventParamV0({
            doc: "",
            name: paramName,
            type,
            location: xdr.ScSpecEventParamLocationV0.scSpecEventParamLocationData(),
          }),
      ),
      dataFormat: xdr.ScSpecEventDataFormat.scSpecEventDataFormatVec(),
    }),
  );

  return Buffer.from(entry.toXDR()).toString("base64");
}

function createTokenSpec(): ContractSpec {
  return {
    contractId: "CABC123",
    entries: [
      createEventEntry("transfer", [
        { name: "from", type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
        { name: "to", type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
        { name: "amount", type: xdr.ScSpecTypeDef.scSpecTypeI128() },
      ]),
      createEventEntry("approve", [
        { name: "spender", type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
        { name: "amount", type: xdr.ScSpecTypeDef.scSpecTypeI128() },
      ]),
      createEventEntry("mint", [
        { name: "to", type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
        { name: "amount", type: xdr.ScSpecTypeDef.scSpecTypeI128() },
      ]),
    ],
  };
}

describe("generateContractArtifacts", () => {
  it("generates typed interfaces and matching zod schemas for token events", () => {
    const spec = createTokenSpec();
    const artifacts = generateContractArtifacts(spec, "token");

    expect(artifacts.declarations).toContain("export interface Transfer");
    expect(artifacts.declarations).toContain("from: string;");
    expect(artifacts.declarations).toContain("amount: string;");
    expect(artifacts.declarations).toContain("export interface Approve");
    expect(artifacts.declarations).toContain("export interface Mint");

    expect(artifacts.schemas).toContain("export const TransferSchema");
    expect(artifacts.schemas).toContain("z.object({");
    expect(artifacts.schemas).toContain("from: z.string()");
    expect(artifacts.schemas).toContain("amount: z.string()");
    expect(artifacts.schemas).toContain("export const ApproveSchema");
    expect(artifacts.schemas).toContain("export const MintSchema");
  });

  it("uses stable identifier mangling with collision suffixes", () => {
    const spec = {
      contractId: "CABC123",
      entries: [
        createEventEntry("transfer_event", [
          { name: "from_address", type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
        ]),
        createEventEntry("transfer_event", [
          { name: "from_address", type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
        ]),
      ],
    } satisfies ContractSpec;

    const artifacts = generateContractArtifacts(spec, "token");

    expect(artifacts.declarations).toContain("export interface TransferEvent");
    expect(artifacts.declarations).toContain("export interface TransferEvent2");
    expect(artifacts.declarations).toContain("fromAddress: string;");
    expect(artifacts.schemas).toContain("export const TransferEventSchema");
    expect(artifacts.schemas).toContain("export const TransferEvent2Schema");
  });
});
