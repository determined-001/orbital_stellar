import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface PublishResult {
  contractId: string;
  version: string;
  etag: string;
}

export interface RegistryPublisher {
  publish(spec: unknown): Promise<PublishResult>;
}

// ---------------------------------------------------------------------------
// Minimal JSON-Schema validator (subset: type, required, pattern, enum,
// minLength, maxLength, minItems, additionalProperties, items, properties).
// Avoids adding a runtime dependency for this validation-only path.
// ---------------------------------------------------------------------------

type SchemaNode = Record<string, unknown>;

function validate(value: unknown, schema: SchemaNode, path: string): string[] {
  const errors: string[] = [];

  // type check
  if (schema.type) {
    const expected = schema.type as string;
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    if (actual !== expected) {
      errors.push(`${path}: expected ${expected}, got ${actual}`);
      return errors; // no point checking further constraints
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path}: length ${value.length} is less than minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`${path}: length ${value.length} exceeds maxLength ${schema.maxLength}`);
    }
    if (schema.pattern) {
      const re = new RegExp(schema.pattern as string);
      if (!re.test(value)) {
        errors.push(`${path}: value does not match pattern ${schema.pattern}`);
      }
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      errors.push(
        `${path}: value "${value}" is not one of [${(schema.enum as string[]).join(", ")}]`,
      );
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path}: array has ${value.length} items, minimum is ${schema.minItems}`);
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        errors.push(...validate(value[i], schema.items as SchemaNode, `${path}[${i}]`));
      }
    }
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!(key in obj)) {
          errors.push(`${path}: missing required property "${key}"`);
        }
      }
    }

    if (schema.additionalProperties === false && schema.properties) {
      const allowed = Object.keys(schema.properties as object);
      for (const key of Object.keys(obj)) {
        if (!allowed.includes(key)) {
          errors.push(`${path}: additional property "${key}" is not allowed`);
        }
      }
    }

    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(
        schema.properties as Record<string, SchemaNode>,
      )) {
        if (key in obj) {
          errors.push(...validate(obj[key], subSchema, `${path}.${key}`));
        }
      }
    }
  }

  return errors;
}

// Lazy-loaded schema so tests that don't touch the file-system still work.
let _schema: SchemaNode | null = null;
function loadSchema(): SchemaNode {
  if (!_schema) {
    const schemaPath = resolve(
      new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      "../specs/well-known/schema.json",
    );
    _schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as SchemaNode;
  }
  return _schema;
}

export class LocalFilePublisher implements RegistryPublisher {
  async publish(spec: unknown): Promise<PublishResult> {
    // Validate against spec.schema.json before writing.
    const schema = loadSchema();
    const errors = validate(spec, schema, "#");
    if (errors.length > 0) {
      throw new Error(`Spec validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    }

    const obj = spec as Record<string, unknown>;
    const contractId = String(obj.contract_id ?? "unknown");

    return {
      contractId,
      version: "local",
      etag: `local-${Date.now()}`,
    };
  }
}
