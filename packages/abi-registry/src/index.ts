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
export { OnChainAbiRegistryClient, DEFAULT_LOOKBACK_LEDGERS } from "./OnChainAbiRegistryClient.js";
export type {
  OnChainAbiRegistryClientConfig,
  RegisteredContractSummary,
  ListRegisteredContractsOptions,
  SpecRecord,
} from "./OnChainAbiRegistryClient.js";

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

export { verifySchema } from "./verifySchema.js";
export type {
  SchemaVerdict,
  SchemaMatch,
  SchemaMismatch,
  SchemaUnverifiable,
  SchemaFieldDiff,
  VerifySchemaOptions,
} from "./verifySchema.js";

export type {
  TaxonomyScope,
  TaxonomyMapping,
  TaxonomyRecord,
  TaxonomyTier,
  TaxonomyResolveInput,
  TaxonomyValidationResult,
} from "./taxonomy/index.js";
export {
  TAXONOMY_TIER_ORDER,
  tierOf,
  scopeKeyOf,
  TaxonomyConflictError,
  InvalidTaxonomyRecordError,
  validateTaxonomyRecord,
  parseTaxonomyRecord,
  TaxonomyResolver,
  loadTaxonomyResolver,
  wellKnownTaxonomy,
  wellKnownTaxonomyMappings,
  SEP41_SAC_INTERFACE_ID,
  SOROBAN_AMM_V1_INTERFACE_ID,
  classifyKnownInterface,
} from "./taxonomy/index.js";
