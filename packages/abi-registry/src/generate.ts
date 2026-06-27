import { xdr } from "@stellar/stellar-sdk";
import type { ContractSpec } from "./types.js";

export type GeneratedContractArtifacts = {
  declarations: string;
  schemas: string;
};

function toPascalCase(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+(.)/g, "_$1")
    .replace(/(^|_)([a-zA-Z0-9])/g, (_, __, letter: string) => letter.toUpperCase())
    .replace(/[^a-zA-Z0-9]+/g, "")
    .replace(/^[0-9]+/, "");
}

function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  return pascal ? pascal.charAt(0).toLowerCase() + pascal.slice(1) : value;
}

function toIdentifierName(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9]+/g, "_");
  const parts = normalized.split("_").filter(Boolean);
  if (parts.length === 0) {
    return "value";
  }
  return parts
    .map((part, index) => {
      const cleaned = part.replace(/^[0-9]+/, "");
      if (!cleaned) {
        return index === 0 ? "value" : "value";
      }
      return index === 0
        ? cleaned.toLowerCase()
        : cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
    })
    .join("");
}

function ensureUniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  let suffix = 2;
  while (used.has(`${base}${suffix}`)) {
    suffix += 1;
  }
  const unique = `${base}${suffix}`;
  used.add(unique);
  return unique;
}

function typeDiscriminant(type: xdr.ScSpecTypeDef | undefined): string {
  if (!type) {
    return "unknown";
  }

  const discriminant = type.switch();

  if (typeof discriminant === "string") {
    return discriminant;
  }

  if (discriminant && typeof discriminant === "object" && "name" in discriminant) {
    return String((discriminant as { name: unknown }).name);
  }

  return String(discriminant);
}

function mapTypeToTs(type: xdr.ScSpecTypeDef | undefined): string {
  switch (typeDiscriminant(type)) {
    case "scSpecTypeAddress":
    case "scSpecTypeBytes":
    case "scSpecTypeString":
    case "scSpecTypeSymbol":
    case "scSpecTypeI64":
    case "scSpecTypeU64":
    case "scSpecTypeI128":
    case "scSpecTypeU128":
    case "scSpecTypeI256":
    case "scSpecTypeU256":
      return "string";
    case "scSpecTypeBool":
      return "boolean";
    case "scSpecTypeI32":
    case "scSpecTypeU32":
      return "number";
    case "scSpecTypeOption":
      return "string | null";
    case "scSpecTypeVec":
      return "Array<unknown>";
    case "scSpecTypeMap":
      return "Array<{ key: unknown; value: unknown }>";
    case "scSpecTypeTuple":
      return "Array<unknown>";
    case "scSpecTypeUdt":
      return "unknown";
    default:
      return "unknown";
  }
}

function mapTypeToZod(type: xdr.ScSpecTypeDef | undefined): string {
  switch (typeDiscriminant(type)) {
    case "scSpecTypeAddress":
    case "scSpecTypeBytes":
    case "scSpecTypeString":
    case "scSpecTypeSymbol":
    case "scSpecTypeI64":
    case "scSpecTypeU64":
    case "scSpecTypeI128":
    case "scSpecTypeU128":
    case "scSpecTypeI256":
    case "scSpecTypeU256":
      return "z.string()";
    case "scSpecTypeBool":
      return "z.boolean()";
    case "scSpecTypeI32":
    case "scSpecTypeU32":
      return "z.number()";
    case "scSpecTypeOption":
      return "z.string().nullable()";
    case "scSpecTypeVec":
      return "z.array(z.unknown())";
    case "scSpecTypeMap":
      return "z.array(z.object({ key: z.unknown(), value: z.unknown() }))";
    case "scSpecTypeTuple":
      return "z.array(z.unknown())";
    case "scSpecTypeUdt":
      return "z.unknown()";
    default:
      return "z.unknown()";
  }
}

export function generateContractArtifacts(
  spec: ContractSpec,
  contractName: string,
): GeneratedContractArtifacts {
  const entries = spec.entries
    .map((entry) => {
      try {
        return xdr.ScSpecEntry.fromXDR(Buffer.from(entry, "base64"));
      } catch {
        return null;
      }
    })
    .filter((entry): entry is xdr.ScSpecEntry => entry !== null)
    .map((entry) => entry.value())
    .filter(
      (entry): entry is xdr.ScSpecEventV0 =>
        entry && typeof entry === "object" && typeof (entry as any).name === "function",
    );

  const usedNames = new Set<string>();
  const declarations: string[] = [];
  const schemas: string[] = [];

  declarations.push('import { z } from "zod";');
  declarations.push("");

  for (const event of entries) {
    const eventName = String((event as any).name());
    const baseName = toPascalCase(eventName);
    const interfaceName = ensureUniqueName(baseName, usedNames);
    const schemaName = `${interfaceName}Schema`;
    const params = Array.isArray((event as any).params?.()) ? (event as any).params() : [];
    const propertyLines = (params as unknown[]).map((param) => {
      const rawParam = param as { name?: () => unknown; type?: () => xdr.ScSpecTypeDef };
      const propertyName = toCamelCase(String(rawParam.name?.() ?? "value"));
      return `  ${propertyName}: ${mapTypeToTs(rawParam.type?.())};`;
    });

    declarations.push(`export interface ${interfaceName} {`);
    declarations.push(...propertyLines);
    declarations.push("}");
    declarations.push("");

    schemas.push(`export const ${schemaName} = z.object({`);
    schemas.push(
      ...(params as unknown[]).map((param) => {
        const rawParam = param as { name?: () => unknown; type?: () => xdr.ScSpecTypeDef };
        const propertyName = toCamelCase(String(rawParam.name?.() ?? "value"));
        return `  ${propertyName}: ${mapTypeToZod(rawParam.type?.())},`;
      }),
    );
    schemas.push("});");
    schemas.push("");
  }

  return {
    declarations: declarations.join("\n"),
    schemas: schemas.join("\n"),
  };
}

export function generateContractTypes(spec: ContractSpec, outputPath: string): string {
  const artifacts = generateContractArtifacts(spec, outputPath);
  return [artifacts.declarations, artifacts.schemas].filter(Boolean).join("\n\n");
}
