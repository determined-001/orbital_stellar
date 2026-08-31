import { xdr } from "@stellar/stellar-sdk";
import type { XdrContractSpec } from "./types.js";
import type { ContractSpec, EventSpec, FunctionSpec, TypeSpec, UserDefinedType } from "./spec.js";

export type GeneratedContractArtifacts = {
  declarations: string;
  schemas: string;
  guards?: string;
  testDts?: string;
  hooks?: string;
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

function isXdrContractSpec(spec: XdrContractSpec | ContractSpec): spec is XdrContractSpec {
  return Array.isArray((spec as XdrContractSpec).entries);
}

function generateFromXdrContractSpec(spec: XdrContractSpec): GeneratedContractArtifacts {
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

  const guards: string[] = [];
  const testDts: string[] = [];
  const eventTypes: string[] = [];

  declarations.unshift('import type { ContractEmittedEvent } from "@orbital-stellar/pulse-core";');

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

    guards.push(
      `export function is${interfaceName}(event: ContractEmittedEvent): event is ContractEmittedEvent & { decodedData: ${interfaceName} } {`,
    );
    guards.push(
      `  return event.topics[0] === "${eventName}" && ${schemaName}.safeParse(event.decodedData).success;`,
    );
    guards.push(`}`);
    guards.push("");

    eventTypes.push(
      `ContractEmittedEvent & { topics: ["${eventName}", ...string[]]; decodedData: ${interfaceName} }`,
    );
  }

  guards.push(
    `export type ContractEventUnion = ${eventTypes.length > 0 ? eventTypes.join(" | ") : "never"};`,
  );
  guards.push("");

  guards.push(`export function assertExhaustiveContractEvent(event: ContractEventUnion): string {`);
  guards.push(`  switch (event.topics[0]) {`);
  for (const event of entries) {
    guards.push(`    case "${String((event as any).name())}":`);
    guards.push(`      return event.topics[0];`);
  }
  if (entries.length > 0) {
    guards.push(`    default: {`);
    guards.push(`      const _exhaustive: never = event;`);
    guards.push(`      return _exhaustive;`);
    guards.push(`    }`);
  }
  guards.push(`  }`);
  guards.push(`}`);
  guards.push("");

  testDts.push(`import type { ContractEventUnion } from "./generated.js";`);
  testDts.push("");
  testDts.push(`export function assertExhaustive(event: ContractEventUnion): string {`);
  testDts.push(`  switch (event.topics[0]) {`);
  for (const event of entries) {
    testDts.push(`    case "${String((event as any).name())}":`);
    testDts.push(`      return event.topics[0];`);
  }
  if (entries.length > 0) {
    testDts.push(`    default: {`);
    testDts.push(`      const _exhaustive: never = event;`);
    testDts.push(`      return _exhaustive;`);
    testDts.push(`    }`);
  }
  testDts.push(`  }`);
  testDts.push(`}`);
  testDts.push("");

  return {
    declarations: declarations.join("\n"),
    schemas: schemas.join("\n"),
    guards: guards.join("\n"),
    testDts: testDts.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Canonical ContractSpec → TS declarations + Zod schemas.
//
// Unlike the XDR path above (events only, no function signatures - that's
// all the raw XDR entries alone conveniently give you), a ContractSpec is
// already fully structured, so this path also emits typed function
// parameter/return declarations and named UDT interfaces, per maintainer.md
// stage 5's `orbital typegen` requirement.
// ---------------------------------------------------------------------------

function mapContractSpecTypeToTs(type: TypeSpec): string {
  if (typeof type === "string") {
    switch (type) {
      case "bool":
        return "boolean";
      case "u32":
      case "i32":
        return "number";
      case "void":
        return "void";
      case "u64":
      case "i64":
      case "u128":
      case "i128":
      case "u256":
      case "i256":
      case "bytes":
      case "string":
      case "symbol":
      case "address":
        return "string";
      case "error":
        return "unknown";
    }
  }
  switch (type.type) {
    case "bytes_n":
      return "string";
    case "option":
      return `${mapContractSpecTypeToTs(type.inner)} | null`;
    case "result":
      // Callers get the Ok shape; a rejected/error result is a thrown exception, not a TS union member.
      return mapContractSpecTypeToTs(type.ok);
    case "vec":
      return `Array<${mapContractSpecTypeToTs(type.item)}>`;
    case "map":
      return `Array<{ key: ${mapContractSpecTypeToTs(type.key)}; value: ${mapContractSpecTypeToTs(type.value)} }>`;
    case "tuple":
      return `[${type.elements.map(mapContractSpecTypeToTs).join(", ")}]`;
    case "named":
      return toPascalCase(type.name);
  }
}

function mapContractSpecTypeToZod(type: TypeSpec): string {
  if (typeof type === "string") {
    switch (type) {
      case "bool":
        return "z.boolean()";
      case "u32":
      case "i32":
        return "z.number()";
      case "void":
        return "z.void()";
      case "u64":
      case "i64":
      case "u128":
      case "i128":
      case "u256":
      case "i256":
      case "bytes":
      case "string":
      case "symbol":
      case "address":
        return "z.string()";
      case "error":
        return "z.unknown()";
    }
  }
  switch (type.type) {
    case "bytes_n":
      return "z.string()";
    case "option":
      return `${mapContractSpecTypeToZod(type.inner)}.nullable()`;
    case "result":
      return mapContractSpecTypeToZod(type.ok);
    case "vec":
      return `z.array(${mapContractSpecTypeToZod(type.item)})`;
    case "map":
      return `z.array(z.object({ key: ${mapContractSpecTypeToZod(type.key)}, value: ${mapContractSpecTypeToZod(type.value)} }))`;
    case "tuple":
      return `z.tuple([${type.elements.map(mapContractSpecTypeToZod).join(", ")}])`;
    case "named":
      return `${toPascalCase(type.name)}Schema`;
  }
}

function generateUdtDeclarations(types: Readonly<Record<string, UserDefinedType>>): {
  declarations: string[];
  schemas: string[];
} {
  const declarations: string[] = [];
  const schemas: string[] = [];

  for (const udt of Object.values(types)) {
    const name = toPascalCase(udt.name);

    if (udt.kind === "struct") {
      declarations.push(`export interface ${name} {`);
      declarations.push(
        ...udt.fields.map((f) => `  ${toCamelCase(f.name)}: ${mapContractSpecTypeToTs(f.type)};`),
      );
      declarations.push("}");
      declarations.push("");

      schemas.push(`export const ${name}Schema = z.object({`);
      schemas.push(
        ...udt.fields.map((f) => `  ${toCamelCase(f.name)}: ${mapContractSpecTypeToZod(f.type)},`),
      );
      schemas.push("});");
      schemas.push("");
    } else if (udt.kind === "enum") {
      const variantNames = udt.variants.map((v) => `"${v.name}"`);
      declarations.push(`export type ${name} = ${variantNames.join(" | ") || "never"};`);
      declarations.push("");

      schemas.push(`export const ${name}Schema = z.enum([${variantNames.join(", ")}]);`);
      schemas.push("");
    } else {
      // union: a Rust enum-with-data, cases are either unit (void) or carry positional fields.
      const caseTypes = udt.cases.map((c) => {
        if (c.fields.length === 0) return `{ case: "${c.name}" }`;
        const valueTypes = c.fields.map((f) => mapContractSpecTypeToTs(f.type));
        return `{ case: "${c.name}", values: [${valueTypes.join(", ")}] }`;
      });
      declarations.push(`export type ${name} = ${caseTypes.join(" | ") || "never"};`);
      declarations.push("");

      schemas.push(`export const ${name}Schema = z.discriminatedUnion("case", [`);
      schemas.push(
        ...udt.cases.map((c) => {
          if (c.fields.length === 0) return `z.object({ case: z.literal("${c.name}") })`;
          const valueTypes = c.fields.map((f) => mapContractSpecTypeToZod(f.type));
          return `z.object({ case: z.literal("${c.name}"), values: z.tuple([${valueTypes.join(", ")}]) })`;
        }),
      );
      schemas.push("]);");
      schemas.push("");
    }
  }

  return { declarations, schemas };
}SpecTypeToTs(f.type)).join(", ");
        return `{ case: "${c.name}"; values: [${valueTypes}] }`;
      });
      declarations.push(`export type ${name} = ${caseTypes.join(" | ") || "never"};`);
      declarations.push("");

      const caseSchemas = udt.cases.map((c) => {
        if (c.fields.length === 0) return `z.object({ case: z.literal("${c.name}") })`;
        const valueSchemas = c.fields.map((f) => mapContractSpecTypeToZod(f.type)).join(", ");
        return `z.object({ case: z.literal("${c.name}"), values: z.tuple([${valueSchemas}]) })`;
      });
      schemas.push(
        `export const ${name}Schema = ${caseSchemas.length > 1 ? `z.union([${caseSchemas.join(", ")}])` : (caseSchemas[0] ?? "z.never()")};`,
      );
      schemas.push("");
    }
  }

  return { declarations, schemas };
}

function generateFunctionDeclarations(functions: ReadonlyArray<FunctionSpec>): string[] {
  const usedNames = new Set<string>();
  const declarations: string[] = [];

  for (const fn of functions) {
    const baseName = toPascalCase(fn.name);
    const paramsName = ensureUniqueName(`${baseName}Params`, usedNames);
    const returnsName = ensureUniqueName(`${baseName}Returns`, usedNames);

    if (fn.params.length === 0) {
      declarations.push(`export type ${paramsName} = Record<string, never>;`);
    } else {
      declarations.push(`export interface ${paramsName} {`);
      declarations.push(
        ...fn.params.map((p) => `  ${toCamelCase(p.name)}: ${mapContractSpecTypeToTs(p.type)};`),
      );
      declarations.push("}");
    }
    declarations.push(`export type ${returnsName} = ${mapContractSpecTypeToTs(fn.returns)};`);
    declarations.push("");
  }

  return declarations;
}

function generateEventDeclarations(events: ReadonlyArray<EventSpec>): {
  declarations: string[];
  schemas: string[];
  guards: string[];
  testDts: string[];
} {
  const usedNames = new Set<string>();
  const declarations: string[] = [];
  const schemas: string[] = [];
  const guards: string[] = [];
  const testDts: string[] = [];
  const eventTypes: string[] = [];

  for (const event of events) {
    const baseName = toPascalCase(event.name);
    const interfaceName = ensureUniqueName(`${baseName}Event`, usedNames);
    const schemaName = `${interfaceName}Schema`;

    declarations.push(`export interface ${interfaceName} {`);
    declarations.push(
      ...event.data.map((f) => `  ${toCamelCase(f.name)}: ${mapContractSpecTypeToTs(f.type)};`),
    );
    declarations.push("}");
    declarations.push("");

    schemas.push(`export const ${schemaName} = z.object({`);
    schemas.push(
      ...event.data.map((f) => `  ${toCamelCase(f.name)}: ${mapContractSpecTypeToZod(f.type)},`),
    );
    schemas.push("});");
    schemas.push("");

    guards.push(
      `export function is${interfaceName}(event: ContractEmittedEvent): event is ContractEmittedEvent & { decodedData: ${interfaceName} } {`,
    );
    guards.push(
      `  return event.topics[0] === "${event.name}" && ${schemaName}.safeParse(event.decodedData).success;`,
    );
    guards.push(`}`);
    guards.push("");

    eventTypes.push(
      `ContractEmittedEvent & { topics: ["${event.name}", ...string[]]; decodedData: ${interfaceName} }`,
    );
  }

  guards.push(
    `export type ContractEventUnion = ${eventTypes.length > 0 ? eventTypes.join(" | ") : "never"};`,
  );
  guards.push("");

  guards.push(`export function assertExhaustiveContractEvent(event: ContractEventUnion): string {`);
  guards.push(`  switch (event.topics[0]) {`);
  for (const event of events) {
    guards.push(`    case "${event.name}":`);
    guards.push(`      return event.topics[0];`);
  }
  if (events.length > 0) {
    guards.push(`    default: {`);
    guards.push(`      const _exhaustive: never = event;`);
    guards.push(`      return _exhaustive;`);
    guards.push(`    }`);
  }
  guards.push(`  }`);
  guards.push(`}`);
  guards.push("");

  testDts.push(`import type { ContractEventUnion } from "./generated.js";`);
  testDts.push("");
  testDts.push(`export function assertExhaustive(event: ContractEventUnion): string {`);
  testDts.push(`  switch (event.topics[0]) {`);
  for (const event of events) {
    testDts.push(`    case "${event.name}":`);
    testDts.push(`      return event.topics[0];`);
  }
  if (events.length > 0) {
    testDts.push(`    default: {`);
    testDts.push(`      const _exhaustive: never = event;`);
    testDts.push(`      return _exhaustive;`);
    testDts.push(`    }`);
  }
  testDts.push(`  }`);
  testDts.push(`}`);
  testDts.push("");

  return { declarations, schemas, guards, testDts };
}

function generateReactHooks(events: ReadonlyArray<EventSpec>): string[] {
  if (events.length === 0) return [];
  const hooks: string[] = [];
  const usedNames = new Set<string>();

  hooks.push("// ─── React hooks generated from contract event schema ─────────────");
  hooks.push("//");
  hooks.push("// These hooks wrap useContractEvent with the correct Zod-validated");
  hooks.push("// types so consumers get fully typed events without manual narrowing.");
  hooks.push("//");
  hooks.push("// @ts-expect-error - useContractEvent is resolved at the consumer side");
  hooks.push('import { useContractEvent } from "@orbital-stellar/pulse-notify";');
  hooks.push("");

  for (const event of events) {
    const baseName = toPascalCase(event.name);
    const interfaceName = ensureUniqueName(`${baseName}Event`, usedNames);
    const schemaName = `${interfaceName}Schema`;
    const hookName = `use${baseName}`;

    hooks.push("/**");
    hooks.push(` * React hook that subscribes to \`${event.name}\` events.`);
    hooks.push(` * The returned event is validated against \`${schemaName}\` at runtime.`);
    hooks.push(" */");
    hooks.push(`export function ${hookName}(`);
    hooks.push("  config: {");
    hooks.push("    serverUrl: string;");
    hooks.push("    contractId: string;");
    hooks.push("    token?: string;");
    hooks.push("    tokenProvider?: () => Promise<string>;");
    hooks.push("    filter?: (event: unknown) => boolean;");
    hooks.push("    withCredentials?: boolean;");
    hooks.push("    hideAfterMs?: number;");
    hooks.push("  },");
    hooks.push(
      `): { event: ${interfaceName} | null; connected: boolean; error: string | null; lastEventAt: string | null } {`,
    );
    hooks.push("  const result = useContractEvent({");
    hooks.push("    ...config,");
    hooks.push("    topics: [],");
    hooks.push("  });");
    hooks.push("");
    hooks.push("  // Validate the event payload against the generated schema");
    hooks.push("  if (result.event && result.event.type === 'contract.emitted') {");
    hooks.push(`    const parsed = ${schemaName}.safeParse(result.event.data);`);
    hooks.push("    if (parsed.success) {");
    hooks.push(`      return { ...result, event: parsed.data as unknown as ${interfaceName} };`);
    hooks.push("    }");
    hooks.push("  }");
    hooks.push(`  return { ...result, event: null as unknown as ${interfaceName} };`);
    hooks.push("}");
    hooks.push("");
  }

  return hooks;
}

function generateFromContractSpec(spec: ContractSpec): GeneratedContractArtifacts {
  const declarations: string[] = [
    'import type { ContractEmittedEvent } from "@orbital-stellar/pulse-core";',
    'import { z } from "zod";',
    "",
  ];
  const schemas: string[] = [];

  const udts = generateUdtDeclarations(spec.types);
  declarations.push(...udts.declarations);
  schemas.push(...udts.schemas);

  declarations.push(...generateFunctionDeclarations(spec.functions));

  const events = generateEventDeclarations(spec.events);
  declarations.push(...events.declarations);
  schemas.push(...events.schemas);

  const hooks = generateReactHooks(spec.events);

  return {
    declarations: declarations.join("\n"),
    schemas: schemas.join("\n"),
    guards: events.guards.join("\n"),
    testDts: events.testDts.join("\n"),
    hooks: hooks.length > 0 ? hooks.join("\n") : undefined,
  };
}

export function generateContractArtifacts(
  spec: XdrContractSpec | ContractSpec,
): GeneratedContractArtifacts {
  return isXdrContractSpec(spec)
    ? generateFromXdrContractSpec(spec)
    : generateFromContractSpec(spec);
}

export function generateContractTypes(spec: XdrContractSpec | ContractSpec): string {
  const artifacts = generateContractArtifacts(spec);
  return [artifacts.declarations, artifacts.schemas, artifacts.guards].filter(Boolean).join("\n\n");
}

/**
 * Generates React hook wrappers (e.g. `useSwapExecuted()`) for every event
 * in the contract spec. Returns an empty string if the spec has no events
 * or is an XDR contract spec (which lacks structured event specs).
 */
export function generateContractHooks(spec: XdrContractSpec | ContractSpec): string {
  if (isXdrContractSpec(spec)) return "";
  const hooks = generateReactHooks(spec.events);
  return hooks.join("\n");
}
