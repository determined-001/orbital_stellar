/**
 * Raw registry entry returned by the ABI registry HTTP API.
 * Contains the contract ID and raw XDR entries as base64 strings.
 * For the rich typed ABI spec shape, see ContractSpec in spec.ts.
 */
export type RawContractEntry = {
  contractId: string;
  /** Raw XDR entries as base64 strings. */
  entries: string[];
};

export type AbiRegistryClientConfig = {
  /** Base URL of the hosted ABI registry, e.g. "https://abi.stellar.org". */
  baseUrl: string;
  /** Maximum number of specs to keep in the LRU cache. Defaults to 512. */
  maxCacheSize?: number;
};
