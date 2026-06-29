/**
 * Minimal XDR-backed contract spec — carries the raw on-chain entries.
 * For the rich ABI surface (functions, events, type descriptors) use
 * {@link ContractSpec} from `./spec.js`.
 */
export type XdrContractSpec = {
  contractId: string;
  /** Raw XDR entries as base64 strings. */
  entries: string[];
};

export type AbiRegistryClientTransport = (
  input: RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

export type AbiRegistryClientConfig = {
  /** Base URL of the hosted ABI registry, e.g. "https://abi.stellar.org". */
  baseUrl: string;
  /** Maximum number of specs to keep in the LRU cache. Defaults to 512. */
  maxCacheSize?: number;
  /** Time-to-live for cached specs in milliseconds. Defaults to 5 minutes. */
  cacheTtlMs?: number;
  /** Optional transport for HTTP requests; falls back to the global fetch implementation. */
  transport?: AbiRegistryClientTransport;
};
