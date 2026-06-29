import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../src/spec.js';
import type { ContractSpec } from '../src/spec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the canonical JSON Schema to make structural assertions about its shape.
const specSchema = JSON.parse(
  readFileSync(join(__dirname, '../schema/spec.schema.json'), 'utf-8'),
) as Record<string, unknown>;

// ── Representative ABI spec (SAC-style fungible token) ────────────────────────

const sampleSpec: ContractSpec = {
  version: '1.0.0',
  name: 'Simple Token',
  description: 'A minimal SEP-41 fungible token.',
  contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
  network: 'testnet',
  functions: [
    {
      name: 'initialize',
      doc: 'Set up the token with admin, decimals, name, and symbol.',
      params: [
        { name: 'admin', type: 'address', doc: 'Initial admin address.' },
        { name: 'decimal', type: 'u32' },
        { name: 'name', type: 'string' },
        { name: 'symbol', type: 'string' },
      ],
      returns: 'void',
    },
    {
      name: 'transfer',
      doc: 'Transfer tokens from one address to another.',
      params: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'i128' },
      ],
      returns: 'void',
    },
    {
      name: 'balance',
      doc: 'Return the token balance of an address.',
      params: [{ name: 'id', type: 'address' }],
      returns: 'i128',
    },
    {
      name: 'allowance',
      params: [
        { name: 'from', type: 'address' },
        { name: 'spender', type: 'address' },
      ],
      returns: { type: 'named', name: 'AllowanceValue' },
    },
    {
      name: 'get_metadata',
      params: [],
      returns: { type: 'named', name: 'TokenMetadata' },
    },
    {
      name: 'find_holders',
      doc: 'Return all addresses holding more than threshold.',
      params: [{ name: 'threshold', type: 'i128' }],
      returns: { type: 'vec', item: 'address' },
    },
    {
      name: 'get_balances',
      doc: 'Return a map of address to balance.',
      params: [],
      returns: { type: 'map', key: 'address', value: 'i128' },
    },
    {
      name: 'get_version',
      params: [],
      returns: { type: 'tuple', elements: ['u32', 'u32', 'u32'] },
    },
    {
      name: 'get_admin_hash',
      doc: 'Return the admin hash as a fixed 32-byte value.',
      params: [],
      returns: { type: 'bytes_n', size: 32 },
    },
    {
      name: 'try_transfer',
      doc: 'Transfer with a Result return type.',
      params: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'i128' },
      ],
      returns: { type: 'result', ok: 'void', err: { type: 'named', name: 'TokenError' } },
    },
    {
      name: 'get_optional_spender',
      params: [{ name: 'id', type: 'address' }],
      returns: { type: 'option', inner: 'address' },
    },
  ],
  events: [
    {
      name: 'transfer',
      doc: 'Emitted on every successful token transfer.',
      topics: [
        { name: 'event_name', type: 'symbol' },
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
      ],
      data: [{ name: 'amount', type: 'i128' }],
    },
    {
      name: 'mint',
      topics: [
        { name: 'event_name', type: 'symbol' },
        { name: 'admin', type: 'address' },
        { name: 'to', type: 'address' },
      ],
      data: [{ name: 'amount', type: 'i128' }],
    },
    {
      name: 'approve',
      topics: [
        { name: 'event_name', type: 'symbol' },
        { name: 'from', type: 'address' },
        { name: 'spender', type: 'address' },
      ],
      data: [
        { name: 'amount', type: 'i128' },
        { name: 'expiration_ledger', type: 'u32' },
      ],
    },
  ],
  types: {
    AllowanceValue: {
      kind: 'struct',
      name: 'AllowanceValue',
      doc: 'Approved allowance entry.',
      fields: [
        { name: 'amount', type: 'i128' },
        { name: 'expiration_ledger', type: 'u32' },
      ],
    },
    TokenMetadata: {
      kind: 'struct',
      name: 'TokenMetadata',
      fields: [
        { name: 'decimal', type: 'u32' },
        { name: 'name', type: 'string' },
        { name: 'symbol', type: 'string' },
      ],
    },
    TokenError: {
      kind: 'enum',
      name: 'TokenError',
      doc: 'Error codes returned by the token contract.',
      variants: [
        { name: 'NotAuthorized', discriminant: 1 },
        { name: 'InsufficientBalance', discriminant: 2 },
        { name: 'InsufficientAllowance', discriminant: 3 },
        { name: 'Overflow', discriminant: 4 },
      ],
    },
    TransferKind: {
      kind: 'union',
      name: 'TransferKind',
      doc: 'Discriminated union for transfer variants.',
      cases: [
        {
          name: 'Standard',
          fields: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'i128' },
          ],
        },
        {
          name: 'Burn',
          fields: [
            { name: 'from', type: 'address' },
            { name: 'amount', type: 'i128' },
          ],
        },
      ],
    },
  },
  xdrEntries: [],
};

// ── spec.schema.json structural assertions ────────────────────────────────────

describe('spec.schema.json', () => {
  it('has a valid $schema and $id', () => {
    expect(specSchema['$schema']).toContain('json-schema.org');
    expect(typeof specSchema['$id']).toBe('string');
  });

  it('requires version, name, functions, events, types', () => {
    const required = specSchema['required'] as string[];
    expect(required).toContain('version');
    expect(required).toContain('name');
    expect(required).toContain('functions');
    expect(required).toContain('events');
    expect(required).toContain('types');
  });

  it('enumerates all 14 Soroban primitive types in PrimitiveType', () => {
    const defs = specSchema['$defs'] as Record<string, unknown>;
    const primitive = defs['PrimitiveType'] as Record<string, unknown>;
    const enumValues = primitive['enum'] as string[];
    const expected: string[] = [
      'bool', 'u32', 'i32', 'u64', 'i64', 'u128', 'i128',
      'u256', 'i256', 'bytes', 'string', 'symbol', 'address', 'void',
    ];
    expect(enumValues).toHaveLength(expected.length);
    expected.forEach((p) => expect(enumValues).toContain(p));
  });

  it('defines all 8 composite TypeSpec variants', () => {
    const defs = specSchema['$defs'] as Record<string, unknown>;
    const expected = [
      'BytesNType', 'OptionType', 'ResultType', 'VecType',
      'MapType', 'TupleType', 'NamedType', 'TypeSpec',
    ];
    expected.forEach((key) => expect(defs).toHaveProperty(key));
  });

  it('TypeSpec uses oneOf over all 8 variants', () => {
    const defs = specSchema['$defs'] as Record<string, unknown>;
    const typeSpec = defs['TypeSpec'] as Record<string, unknown>;
    const oneOf = typeSpec['oneOf'] as unknown[];
    expect(oneOf).toHaveLength(8);
  });

  it('FunctionSpec requires name, params, returns', () => {
    const defs = specSchema['$defs'] as Record<string, unknown>;
    const fn = defs['FunctionSpec'] as Record<string, unknown>;
    expect(fn['required']).toContain('name');
    expect(fn['required']).toContain('params');
    expect(fn['required']).toContain('returns');
  });

  it('EventSpec requires name, topics, data', () => {
    const defs = specSchema['$defs'] as Record<string, unknown>;
    const ev = defs['EventSpec'] as Record<string, unknown>;
    expect(ev['required']).toContain('name');
    expect(ev['required']).toContain('topics');
    expect(ev['required']).toContain('data');
  });

  it('defines StructTypeSpec, EnumTypeSpec, UnionTypeSpec and UserDefinedType', () => {
    const defs = specSchema['$defs'] as Record<string, unknown>;
    ['StructTypeSpec', 'EnumTypeSpec', 'UnionTypeSpec', 'UserDefinedType'].forEach((key) =>
      expect(defs).toHaveProperty(key),
    );
  });

  it('TupleType enforces minItems: 2', () => {
    const defs = specSchema['$defs'] as Record<string, unknown>;
    const tupleType = defs['TupleType'] as Record<string, unknown>;
    const props = tupleType['properties'] as Record<string, unknown>;
    const elements = props['elements'] as Record<string, unknown>;
    expect(elements['minItems']).toBe(2);
  });
});

// ── validateSpec — representative spec ───────────────────────────────────────

describe('validateSpec — representative spec validates', () => {
  it('accepts the full representative SEP-41 token spec', () => {
    const result = validateSpec(sampleSpec);
    if (!result.valid) {
      throw new Error(`Expected valid spec but got errors: ${result.errors.join(', ')}`);
    }
    expect(result.valid).toBe(true);
  });
});

// ── validateSpec — valid inputs ───────────────────────────────────────────────

describe('validateSpec — valid inputs', () => {
  it('accepts a minimal spec', () => {
    const minimal: ContractSpec = {
      version: '0.1.0',
      name: 'Minimal',
      functions: [{ name: 'noop', params: [], returns: 'void' }],
      events: [],
      types: {},
    };
    expect(validateSpec(minimal).valid).toBe(true);
  });

  it('accepts all 14 Soroban primitive return types', () => {
    const primitives = [
      'bool', 'u32', 'i32', 'u64', 'i64', 'u128', 'i128',
      'u256', 'i256', 'bytes', 'string', 'symbol', 'address', 'void',
    ] as const;
    for (const prim of primitives) {
      const spec: ContractSpec = {
        version: '1.0.0',
        name: 'Prim',
        functions: [{ name: 'f', params: [], returns: prim }],
        events: [],
        types: {},
      };
      const result = validateSpec(spec);
      expect(result.valid, `primitive "${prim}" should be valid`).toBe(true);
    }
  });

  it('accepts option<vec<address>> nested composite type', () => {
    const spec: ContractSpec = {
      version: '1.0.0',
      name: 'Nested',
      functions: [
        {
          name: 'get_owners',
          params: [],
          returns: { type: 'option', inner: { type: 'vec', item: 'address' } },
        },
      ],
      events: [],
      types: {},
    };
    expect(validateSpec(spec).valid).toBe(true);
  });

  it('accepts result<u128, bytes_n<32>>', () => {
    const spec: ContractSpec = {
      version: '1.0.0',
      name: 'ResultContract',
      functions: [
        {
          name: 'compute',
          params: [],
          returns: { type: 'result', ok: 'u128', err: { type: 'bytes_n', size: 32 } },
        },
      ],
      events: [],
      types: {},
    };
    expect(validateSpec(spec).valid).toBe(true);
  });

  it('accepts map<address, i128> as a param type', () => {
    const spec: ContractSpec = {
      version: '1.0.0',
      name: 'MapContract',
      functions: [
        {
          name: 'set_balances',
          params: [{ name: 'balances', type: { type: 'map', key: 'address', value: 'i128' } }],
          returns: 'void',
        },
      ],
      events: [],
      types: {},
    };
    expect(validateSpec(spec).valid).toBe(true);
  });

  it('accepts all three user-defined type kinds', () => {
    const spec: ContractSpec = {
      version: '1.0.0',
      name: 'UserTypes',
      functions: [],
      events: [],
      types: {
        MyStruct: {
          kind: 'struct',
          name: 'MyStruct',
          fields: [{ name: 'value', type: 'u64' }],
        },
        MyEnum: {
          kind: 'enum',
          name: 'MyEnum',
          variants: [
            { name: 'A', discriminant: 0 },
            { name: 'B', discriminant: 1 },
          ],
        },
        MyUnion: {
          kind: 'union',
          name: 'MyUnion',
          cases: [
            { name: 'SomeValue', fields: [{ name: 'x', type: 'u32' }] },
            { name: 'None', fields: [] },
          ],
        },
      },
    };
    expect(validateSpec(spec).valid).toBe(true);
  });

  it('accepts optional contractId and network', () => {
    const spec: ContractSpec = {
      version: '1.0.0',
      name: 'WithNetwork',
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
      network: 'mainnet',
      functions: [],
      events: [],
      types: {},
    };
    expect(validateSpec(spec).valid).toBe(true);
  });
});

// ── validateSpec — invalid inputs ─────────────────────────────────────────────

describe('validateSpec — invalid inputs', () => {
  it('rejects null, strings, numbers, and arrays', () => {
    expect(validateSpec(null).valid).toBe(false);
    expect(validateSpec('spec').valid).toBe(false);
    expect(validateSpec(42).valid).toBe(false);
    expect(validateSpec([]).valid).toBe(false);
  });

  it('rejects missing version', () => {
    const { version: _v, ...noVersion } = sampleSpec;
    const result = validateSpec(noVersion);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes('version'))).toBe(true);
    }
  });

  it('rejects non-semver version strings', () => {
    expect(validateSpec({ ...sampleSpec, version: 'v1.0' }).valid).toBe(false);
    expect(validateSpec({ ...sampleSpec, version: '1.0' }).valid).toBe(false);
    expect(validateSpec({ ...sampleSpec, version: '1' }).valid).toBe(false);
  });

  it('rejects empty name', () => {
    expect(validateSpec({ ...sampleSpec, name: '' }).valid).toBe(false);
  });

  it('rejects invalid network value', () => {
    expect(validateSpec({ ...sampleSpec, network: 'localnet' }).valid).toBe(false);
    expect(validateSpec({ ...sampleSpec, network: 'devnet' }).valid).toBe(false);
  });

  it('rejects contractId not starting with C', () => {
    expect(
      validateSpec({
        ...sampleSpec,
        contractId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
      }).valid,
    ).toBe(false);
  });

  it('rejects functions that is not an array', () => {
    expect(validateSpec({ ...sampleSpec, functions: {} }).valid).toBe(false);
    expect(validateSpec({ ...sampleSpec, functions: null }).valid).toBe(false);
  });

  it('rejects a function param with an unknown type string', () => {
    const result = validateSpec({
      ...sampleSpec,
      functions: [{ name: 'bad', params: [{ name: 'x', type: 'uint256' }], returns: 'void' }],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a tuple with only one element', () => {
    const result = validateSpec({
      ...sampleSpec,
      functions: [
        { name: 'bad_tuple', params: [], returns: { type: 'tuple', elements: ['u32'] } },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects bytes_n with size 0', () => {
    const result = validateSpec({
      ...sampleSpec,
      functions: [
        {
          name: 'bad_bytes',
          params: [{ name: 'h', type: { type: 'bytes_n', size: 0 } }],
          returns: 'void',
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects an event missing the topics field', () => {
    const result = validateSpec({
      ...sampleSpec,
      events: [{ name: 'bad', data: [] }],
    });
    expect(result.valid).toBe(false);
  });

  it('returns errors as a non-empty array on failure', () => {
    const result = validateSpec({ name: 'X', functions: null, events: null, types: null });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

// ── TypeSpec coverage ─────────────────────────────────────────────────────────

describe('TypeSpec — all Soroban composite tags are distinct', () => {
  it('no duplicate composite type discriminants', () => {
    const tags = ['bytes_n', 'option', 'result', 'vec', 'map', 'tuple', 'named'];
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('NamedType can reference structs, enums, and unions', () => {
    const spec: ContractSpec = {
      version: '1.0.0',
      name: 'NamedRefs',
      functions: [
        { name: 'get_s', params: [], returns: { type: 'named', name: 'S' } },
        { name: 'get_e', params: [], returns: { type: 'named', name: 'E' } },
        { name: 'get_u', params: [], returns: { type: 'named', name: 'U' } },
      ],
      events: [],
      types: {
        S: { kind: 'struct', name: 'S', fields: [{ name: 'x', type: 'u32' }] },
        E: { kind: 'enum', name: 'E', variants: [{ name: 'A', discriminant: 0 }] },
        U: { kind: 'union', name: 'U', cases: [{ name: 'C', fields: [] }] },
      },
    };
    expect(validateSpec(spec).valid).toBe(true);
  });
});
