import { xdr, scValToNative, nativeToScVal, Address, StrKey } from "@stellar/stellar-sdk";

/**
 * Converts a Soroban ScVal to its standard JavaScript/TypeScript native representation.
 * Handles edge cases like system/contract errors, contract instances, ledger keys, and large integers.
 *
 * @param scval The XDR ScVal to convert.
 * @returns The converted JS/TS native representation.
 */
export function scvalToJs(scval: xdr.ScVal): any {
  const switchName = scval.switch().name;

  if (switchName === "scvError") {
    const scError = scval.value() as xdr.ScError;
    const errorType = scError.switch().name; // e.g. "sceContract", "sceWasmVm", etc.
    const native = scValToNative(scval);
    if (native && typeof native === "object") {
      return {
        ...native,
        errorType, // Preserve the exact XDR union arm for perfect round-tripping!
      };
    }
  }

  if (switchName === "scvLedgerKeyContractInstance") {
    return { type: "ledgerKeyContractInstance" };
  }

  if (switchName === "scvLedgerKeyNonce") {
    const nonceVal = scval.value() as any;
    return {
      type: "ledgerKeyNonce",
      nonce: BigInt(nonceVal._attributes.nonce.toString()),
    };
  }

  if (switchName === "scvContractInstance") {
    const instance = scval.value() as xdr.ScContractInstance;
    const executable = instance.executable();
    const executableType = executable.switch().name;

    return {
      type: "contractInstance",
      executable: executableType,
      wasmHash:
        executableType === "contractExecutableWasm"
          ? (executable.value() as any).toString("hex")
          : undefined,
      storage: instance.storage() ? scvalToJs(xdr.ScVal.scvMap(instance.storage()!)) : null,
    };
  }

  return scValToNative(scval);
}

/**
 * Converts a JS/TS native value back to a Soroban ScVal.
 * An optional spec can be provided to resolve type ambiguity (e.g. string addresses, symbol vs string, vec/map elements).
 *
 * @param value The JavaScript/TypeScript value to convert.
 * @param spec The specification describing the expected Soroban type (string, object, or ScSpecTypeDef).
 * @returns The constructed XDR ScVal.
 */
export function jsToScval(value: any, spec?: any): xdr.ScVal {
  // If the value is already an ScVal, return it as-is
  if (value instanceof xdr.ScVal) {
    return value;
  }

  const { type: specType, specObj } = resolveSpec(spec);

  // 1. Explicit spec-based conversions
  switch (specType) {
    case "bool":
      return xdr.ScVal.scvBool(!!value);

    case "void":
      return xdr.ScVal.scvVoid();

    case "u32":
      return xdr.ScVal.scvU32(Number(value));

    case "i32":
      return xdr.ScVal.scvI32(Number(value));

    case "u64":
      return xdr.ScVal.scvU64(new xdr.Uint64(BigInt(value)));

    case "i64":
      return xdr.ScVal.scvI64(new xdr.Int64(BigInt(value)));

    case "timepoint":
      return xdr.ScVal.scvTimepoint(new xdr.Uint64(BigInt(value)));

    case "duration":
      return xdr.ScVal.scvDuration(new xdr.Uint64(BigInt(value)));

    case "u128":
      return toU128(BigInt(value));

    case "i128":
      return toI128(BigInt(value));

    case "u256":
      return toU256(BigInt(value));

    case "i256":
      return toI256(BigInt(value));

    case "bytes": {
      if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        return xdr.ScVal.scvBytes(Buffer.from(value));
      }
      if (typeof value === "string") {
        if (/^[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0) {
          return xdr.ScVal.scvBytes(Buffer.from(value, "hex"));
        }
        return xdr.ScVal.scvBytes(Buffer.from(value, "utf-8"));
      }
      if (Array.isArray(value)) {
        return xdr.ScVal.scvBytes(Buffer.from(value));
      }
      throw new Error(`Unsupported bytes value: ${value}`);
    }

    case "string":
      return xdr.ScVal.scvString(String(value));

    case "symbol":
      return xdr.ScVal.scvSymbol(String(value));

    case "address": {
      if (value instanceof xdr.ScAddress) {
        return xdr.ScVal.scvAddress(value);
      }
      if (value instanceof Address) {
        return xdr.ScVal.scvAddress(value.toScAddress());
      }
      if (typeof value === "string") {
        return Address.fromString(value).toScVal();
      }
      throw new Error(`Unsupported address value: ${value}`);
    }

    case "error": {
      if (value && typeof value === "object") {
        const errorType =
          value.errorType || (value.type === "contract" ? "sceContract" : "sceWasmVm");
        const code = value.code;
        const errorCode =
          typeof code === "number" ? code : ((xdr.ScErrorCode as any)[value.value]?.().value ?? 0);

        let innerValue: any;
        if (errorType === "sceContract") {
          innerValue = Number(errorCode);
        } else {
          innerValue =
            (xdr.ScErrorCode as any)._byValue[errorCode] ||
            (xdr.ScErrorCode as any).scecArithDomain();
        }

        const scError = (xdr.ScError as any)[errorType](innerValue);
        return xdr.ScVal.scvError(scError);
      }
      throw new Error(`Unsupported error value: ${value}`);
    }

    case "ledgerkeycontractinstance":
      return xdr.ScVal.scvLedgerKeyContractInstance();

    case "ledgerkeynonce": {
      const nonceVal = value && typeof value === "object" ? value.nonce : value;
      return xdr.ScVal.scvLedgerKeyNonce(
        new xdr.ScNonceKey({ nonce: new xdr.Int64(BigInt(nonceVal)) }),
      );
    }

    case "contractinstance": {
      if (value && typeof value === "object") {
        let exec: xdr.ContractExecutable;
        if (value.executable === "contractExecutableWasm") {
          exec = xdr.ContractExecutable.contractExecutableWasm(Buffer.from(value.wasmHash, "hex"));
        } else {
          exec = xdr.ContractExecutable.contractExecutableStellarAsset();
        }
        let storage: any = null;
        if (value.storage) {
          const scMap = jsToScval(value.storage, "map");
          storage = scMap.value();
        }
        return xdr.ScVal.scvContractInstance(
          new xdr.ScContractInstance({
            executable: exec,
            storage,
          }),
        );
      }
      throw new Error(`Unsupported contract instance value: ${value}`);
    }

    case "vec": {
      if (!Array.isArray(value)) {
        throw new Error("Value must be an array for vec type");
      }
      const elementSpec = specObj?.element;
      const elements = value.map((v) => jsToScval(v, elementSpec));
      return xdr.ScVal.scvVec(elements);
    }

    case "map": {
      let entries: Array<[any, any]> = [];
      if (value instanceof Map) {
        entries = Array.from(value.entries());
      } else if (Array.isArray(value)) {
        if (value.every((v) => Array.isArray(v) && v.length === 2)) {
          entries = value as Array<[any, any]>;
        } else if (value.every((v) => v && typeof v === "object" && "key" in v && "val" in v)) {
          entries = value.map((v) => [v.key, v.val]);
        } else {
          throw new Error("Invalid array format for map type");
        }
      } else if (value && typeof value === "object") {
        entries = Object.entries(value);
      } else {
        throw new Error("Value must be a Map, Object, or Array of entries for map type");
      }

      const keySpec = specObj?.key;
      const valueSpec = specObj?.value;

      const scMapEntries = entries.map(([k, v]) => {
        const scKey = jsToScval(k, keySpec);
        const scVal = jsToScval(v, valueSpec);
        return new xdr.ScMapEntry({ key: scKey, val: scVal });
      });

      return xdr.ScVal.scvMap(scMapEntries);
    }

    case "tuple": {
      if (!Array.isArray(value)) {
        throw new Error("Value must be an array for tuple type");
      }
      const elementSpecs = specObj?.values || [];
      const elements = value.map((v, i) => jsToScval(v, elementSpecs[i]));
      return xdr.ScVal.scvVec(elements);
    }

    case "option": {
      if (value === null || value === undefined) {
        return xdr.ScVal.scvVoid();
      }
      return jsToScval(value, specObj?.typeDef);
    }

    case "result": {
      // In Soroban, a result type is not a top-level ScVal, but we can treat it as void/val/error
      if (
        value instanceof Error ||
        (value && typeof value === "object" && value.type === "error")
      ) {
        return jsToScval(value, "error");
      }
      return jsToScval(value, specObj?.ok);
    }
  }

  // 2. Fallback to smart inference (when spec is 'any', missing, or unresolved)
  if (value === null || value === undefined) {
    return xdr.ScVal.scvVoid();
  }

  if (typeof value === "boolean") {
    return xdr.ScVal.scvBool(value);
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return xdr.ScVal.scvI32(value);
    }
    return xdr.ScVal.scvI32(Math.floor(value));
  }

  if (typeof value === "bigint") {
    return nativeToScVal(value);
  }

  if (typeof value === "string") {
    // If it is a valid Stellar public key or contract address, infer Address
    if ((value.startsWith("G") || value.startsWith("C")) && value.length === 56) {
      if (StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value)) {
        return Address.fromString(value).toScVal();
      }
    }
    return xdr.ScVal.scvString(value);
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return xdr.ScVal.scvBytes(Buffer.from(value));
  }

  if (Array.isArray(value)) {
    return xdr.ScVal.scvVec(value.map((v) => jsToScval(v)));
  }

  if (value instanceof Map) {
    return jsToScval(value, "map");
  }

  if (typeof value === "object") {
    // Check if it is a preserved error
    if (
      "type" in value &&
      "code" in value &&
      (value.type === "contract" || value.type === "system")
    ) {
      return jsToScval(value, "error");
    }
    if (value.type === "ledgerKeyContractInstance") {
      return jsToScval(value, "ledgerkeycontractinstance");
    }
    if (value.type === "ledgerKeyNonce") {
      return jsToScval(value, "ledgerkeynonce");
    }
    if (value.type === "contractInstance") {
      return jsToScval(value, "contractinstance");
    }

    // Default to a Map of entries
    return jsToScval(value, "map");
  }

  throw new Error(`Unable to infer ScVal for value: ${value}`);
}

/**
 * Resolves a high-level spec parameter (string, object, or ScSpecTypeDef) to a standard lowercase type string and optional metadata.
 */
function resolveSpec(spec: any): { type: string; specObj?: any } {
  if (!spec) {
    return { type: "any" };
  }

  if (typeof spec === "string") {
    const clean = spec.trim();
    const cleanLower = clean.toLowerCase();

    if (cleanLower.startsWith("vec<") && clean.endsWith(">")) {
      const element = clean.slice(4, -1);
      return { type: "vec", specObj: { element } };
    }

    if (cleanLower.startsWith("map<") && clean.endsWith(">")) {
      const parts = clean.slice(4, -1).split(",");
      const key = parts[0]?.trim() || "";
      const value = parts.slice(1).join(",").trim();
      return { type: "map", specObj: { key, value } };
    }

    return { type: cleanLower };
  }

  if (typeof spec === "object") {
    if (spec instanceof xdr.ScSpecTypeDef) {
      const switchName = spec.switch().name;
      switch (switchName) {
        case "scSpecTypeVal":
          return { type: "any" };
        case "scSpecTypeBool":
          return { type: "bool" };
        case "scSpecTypeVoid":
          return { type: "void" };
        case "scSpecTypeError":
          return { type: "error" };
        case "scSpecTypeU32":
          return { type: "u32" };
        case "scSpecTypeI32":
          return { type: "i32" };
        case "scSpecTypeU64":
          return { type: "u64" };
        case "scSpecTypeI64":
          return { type: "i64" };
        case "scSpecTypeTimepoint":
          return { type: "timepoint" };
        case "scSpecTypeDuration":
          return { type: "duration" };
        case "scSpecTypeU128":
          return { type: "u128" };
        case "scSpecTypeI128":
          return { type: "i128" };
        case "scSpecTypeU256":
          return { type: "u256" };
        case "scSpecTypeI256":
          return { type: "i256" };
        case "scSpecTypeBytes":
          return { type: "bytes" };
        case "scSpecTypeString":
          return { type: "string" };
        case "scSpecTypeSymbol":
          return { type: "symbol" };
        case "scSpecTypeAddress":
        case "scSpecTypeMuxedAddress":
          return { type: "address" };
        case "scSpecTypeOption": {
          const typeDef = (spec.value() as any)._attributes.typeDef;
          return { type: "option", specObj: { typeDef } };
        }
        case "scSpecTypeResult": {
          const ok = (spec.value() as any)._attributes.ok;
          const error = (spec.value() as any)._attributes.error;
          return { type: "result", specObj: { ok, error } };
        }
        case "scSpecTypeVec": {
          const element = (spec.value() as any)._attributes.element;
          return { type: "vec", specObj: { element } };
        }
        case "scSpecTypeMap": {
          const key = (spec.value() as any)._attributes.key;
          const value = (spec.value() as any)._attributes.value;
          return { type: "map", specObj: { key, value } };
        }
        case "scSpecTypeTuple": {
          const values = (spec.value() as any)._attributes.values;
          return { type: "tuple", specObj: { values } };
        }
        case "scSpecTypeBytesN": {
          return { type: "bytes", specObj: { n: (spec.value() as any)._attributes.n } };
        }
        case "scSpecTypeUdt": {
          return { type: "udt", specObj: { name: (spec.value() as any)._attributes.name } };
        }
      }
    }

    if (typeof spec.type === "string") {
      return { type: spec.type.toLowerCase(), specObj: spec };
    }
  }

  return { type: "any" };
}

// Helper methods for explicit 128-bit and 256-bit conversions
function toU128(val: bigint): xdr.ScVal {
  if (val < 0n) {
    throw new Error("Cannot represent negative value as u128");
  }
  const lo = val & 0xffffffffffffffffn;
  const hi = val >> 64n;
  const parts = new xdr.UInt128Parts({
    hi: new xdr.Uint64(hi),
    lo: new xdr.Uint64(lo),
  });
  return xdr.ScVal.scvU128(parts);
}

function toI128(val: bigint): xdr.ScVal {
  const lo = val & 0xffffffffffffffffn;
  const hi = val >> 64n;
  const parts = new xdr.Int128Parts({
    hi: new xdr.Int64(hi),
    lo: new xdr.Uint64(lo),
  });
  return xdr.ScVal.scvI128(parts);
}

function toU256(val: bigint): xdr.ScVal {
  if (val < 0n) {
    throw new Error("Cannot represent negative value as u256");
  }
  const loLo = val & 0xffffffffffffffffn;
  const loHi = (val >> 64n) & 0xffffffffffffffffn;
  const hiLo = (val >> 128n) & 0xffffffffffffffffn;
  const hiHi = val >> 192n;
  const parts = new xdr.UInt256Parts({
    hiHi: new xdr.Uint64(hiHi),
    hiLo: new xdr.Uint64(hiLo),
    loHi: new xdr.Uint64(loHi),
    loLo: new xdr.Uint64(loLo),
  });
  return xdr.ScVal.scvU256(parts);
}

function toI256(val: bigint): xdr.ScVal {
  const loLo = val & 0xffffffffffffffffn;
  const loHi = (val >> 64n) & 0xffffffffffffffffn;
  const hiLo = (val >> 128n) & 0xffffffffffffffffn;
  const hiHi = val >> 192n;
  const parts = new xdr.Int256Parts({
    hiHi: new xdr.Int64(hiHi),
    hiLo: new xdr.Uint64(hiLo),
    loHi: new xdr.Uint64(loHi),
    loLo: new xdr.Uint64(loLo),
  });
  return xdr.ScVal.scvI256(parts);
}
