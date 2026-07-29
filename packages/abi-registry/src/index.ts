export { AbiRegistryClient } from "./AbiRegistryClient.js";
export { scvalToJs, jsToScval } from "./scval.js";
export { RegistryPublisher } from "./RegistryPublisher.js";

export type { AbiRegistryClientConfig, XdrContractSpec } from "./types.js";

export type {
  ContractSpec,
  FunctionSpec,
  EventSpec,
  FieldSpec,
  TypeSpec,
  PrimitiveType,
  BytesNType,
  OptionType,
  ResultType,
  VecType,
  MapType,
  TupleType,
  NamedType,
  StructTypeSpec,
  StructFieldSpec,
  EnumTypeSpec,
  EnumVariantSpec,
  UnionTypeSpec,
  UnionCaseSpec,
  UserDefinedType,
  ValidationResult,
} from "./spec.js";
export { validateSpec, canonicalizeSpec } from "./spec.js";

export type { PublishResult } from "./RegistryPublisher.js";

export { LocalFilePublisher } from "./RegistryPublisher.js";

export { decodeContractEvent } from "./decode.js";
export type { DecodedEvent, DecodedValue, DecodeError, DecodeResult } from "./decode.js";
export { LocalAbiRegistryClient } from "./LocalAbiRegistryClient.js";
export { wellKnownToContractSpec } from "./wellKnown.js";
export type { WellKnownSpecRaw } from "./wellKnown.js";

export { OnChainRegistryPublisher } from "./OnChainRegistryPublisher.js";
export type { OnChainRegistryPublisherConfig } from "./OnChainRegistryPublisher.js";
export { OnChainAbiRegistryClient } from "./OnChainAbiRegistryClient.js";
export type { OnChainAbiRegistryClientConfig } from "./OnChainAbiRegistryClient.js";

export { BundledWellKnownClient } from "./BundledWellKnownClient.js";
export { ChainedAbiRegistryClient } from "./ChainedAbiRegistryClient.js";
export type { AbiRegistryReader } from "./ChainedAbiRegistryClient.js";
export { createDefaultAbiRegistryClient } from "./createDefaultAbiRegistryClient.js";
export {
  ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
  ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
  ORBITAL_REGISTRY_TESTNET_RPC_URL,
} from "./registryConstants.js";

export { discoverContractSpec, NoEmbeddedSpecError } from "./discovery/discoverContract.js";
export type { DiscoverContractSpecOptions, ParsedWasmSpec } from "./discovery/discoverContract.js";
export { fetchContractWasm } from "./discovery/fetchContractCode.js";
export { parseWasmSpec } from "./discovery/parseContractSpec.js";
export { UnsupportedSpecTypeError } from "./discovery/xdrToSpec.js";

export type {
  OrbitalCodegenConfig,
  CodegenContract,
  OrbitalLockFile,
  OrbitalLockEntry,
} from "./config.js";
export { loadCodegenConfig, loadLockFile } from "./config.js";

export type { CodegenWatchOptions } from "./watch.js";
export { generateForContract, watchCodegen, writeLockFile } from "./watch.js";

export { verifySchema } from "./verifySchema.js";
export type {
  SchemaVerdict,
  SchemaMatch,
  SchemaMismatch,
  SchemaUnverifiable,
  SchemaFieldDiff,
  VerifySchemaOptions,
} from "./verifySchema.js";

// Configuration and codegen exports
export { defineConfig, validateConfig, ConfigValidationError } from "./config.js";
export type { OrbitalConfig, ContractConfig, LockFile, LockFileContract } from "./config.js";
export { loadConfig, configExists, getConfigDirectory, ConfigLoadError } from "./configLoader.js";
export {
  loadLockFile,
  saveLockFile,
  createLockFile,
  generateSpecHash,
  detectDrift,
  getLockFilePath,
  formatDriftReport,
  LockFileError,
} from "./lockFile.js";
export { generateBatchTypes, checkForDrift, BatchGenerationError } from "./batchGeneration.js";
export type { BatchGenerationResult } from "./batchGeneration.js";
export { LabelResolver } from "./LabelResolver.js";
export type {
  LabelRecord,
  LabelResolverConfig,
  ResolvedLabel,
  EntityType,
} from "./LabelResolver.js";
