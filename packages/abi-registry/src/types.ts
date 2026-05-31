/** A parsed Soroban contract ABI spec entry. */
export type ContractSpec = {
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
