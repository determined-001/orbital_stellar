export { AbiRegistryClient } from "./AbiRegistryClient.js";
export { scvalToJs, jsToScval } from "./scval.js";
export { RegistryPublisher } from "./RegistryPublisher.js";

export type {
  AbiRegistryClientConfig,
  XdrContractSpec,
  AttestationDocument,
  AttestationValidationResult,
  TriggerClass,
  LatencyTier,
  OperatorTerms,
  OperatorRecord,
  WorkerOfferingRecord,
  OperatorValidationResult,
  WorkerOfferingValidationResult,
} from "./types.js";
export {
  validateAttestationDocument,
  validateOperatorRecord,
  validateWorkerOfferingRecord,
} from "./types.js";

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
export {
  OnChainAbiRegistryClient,
  RegistryEntryArchivedError,
} from "./OnChainAbiRegistryClient.js";
export type { OnChainAbiRegistryClientConfig } from "./OnChainAbiRegistryClient.js";

export { BundledWellKnownClient } from "./BundledWellKnownClient.js";
export { ChainedAbiRegistryClient } from "./ChainedAbiRegistryClient.js";
export type { AbiRegistryReader } from "./ChainedAbiRegistryClient.js";
export { HostedAbiRegistryClient } from "./HostedAbiRegistryClient.js";
export type { HostedAbiRegistryClientConfig } from "./HostedAbiRegistryClient.js";
export { createDefaultAbiRegistryClient } from "./createDefaultAbiRegistryClient.js";
export type { CreateDefaultAbiRegistryClientOptions } from "./createDefaultAbiRegistryClient.js";
export {
  ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
  ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
  ORBITAL_REGISTRY_TESTNET_RPC_URL,
  ORBITAL_REGISTRY_TESTNET_NETWORK_PASSPHRASE,
  ORBITAL_HOSTED_REGISTRY_BASE_URL,
} from "./registryConstants.js";

export { buildWellKnownOfflineBlobs, DEFAULT_POINTER_BASE_URL } from "./offlineBlobs.js";
export { loadBundledWellKnownSpecs } from "./BundledWellKnownClient.js";

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
export { loadCodegenConfig } from "./config.js";

export type { CodegenWatchOptions } from "./watch.js";
export { generateForContract, watchCodegen, writeLockFile } from "./watch.js";

export type { GeneratedContractArtifacts } from "./generate.js";
export {
  generateContractArtifacts,
  generateContractTypes,
  generateContractHooks,
} from "./generate.js";

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

export {
  validateTaxonomyEntry,
  findTaxonomyConflicts,
  TAXONOMY_NAMESPACE_ROOTS,
  RESERVED_TAXONOMY_NAMESPACE_ROOTS,
  TAXONOMY_NAME_RE,
} from "./taxonomy.js";
export type {
  TaxonomyEntry,
  TaxonomyMatch,
  TaxonomyScope,
  TaxonomyProvenance,
  TaxonomyConflict,
  TaxonomyNamespaceRoot,
  TaxonomyNetwork,
  TopicMatcher,
  ParameterMapping,
} from "./taxonomy.js";

export {
  signAttestation,
  verifyAttestation,
  canonicalizeAttestation,
  AttestationSigningError,
} from "./attestation.js";
export type {
  AttestationEnvelope,
  AttestationVerdict,
  VerifyAttestationOptions,
} from "./attestation.js";

export { InMemoryVerdictStore } from "./verdictStore.js";
export type { VerdictStore, VerdictRecord, VerdictStatus } from "./verdictStore.js";

export { InMemorySpecStore } from "./specStore.js";
export type { SpecStore, RegisteredSpec } from "./specStore.js";

export { GitHubIssueReporter, NoopIssueReporter } from "./issueReporter.js";
export type { IssueReporter, MismatchReportParams } from "./issueReporter.js";

export { ConsoleAlertManager, NoopAlertManager } from "./alertManager.js";
export type { AlertManager } from "./alertManager.js";

// Cache primitives, exported so sibling packages (worker-core's registry
// client) reuse them instead of writing a second LRU.
export { LruCache } from "./LruCache.js";
export { TtlLruCache } from "./TtlLruCache.js";

export { runVerificationJob } from "./verificationJob.js";
export type { VerificationJobConfig, JobResult } from "./verificationJob.js";

export { TaxonomyResolver, TaxonomyLoadError, AmbiguousTaxonomyError } from "./taxonomyResolver.js";
export type { ResolvableEvent, ResolvableTopic, TaxonomyResolution } from "./taxonomyResolver.js";
export { SEP41_TAXONOMY } from "./wellKnownTaxonomy.js";
