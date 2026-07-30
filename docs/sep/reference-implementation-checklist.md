# Reference Implementation Checklist

This checklist maps every normative clause in `orbital-registry-sep.md` to its implementation in the `determined-001/orbital_stellar` repository.

| Clause | Implementation Status | File Paths |
|--------|----------------------|------------|
| SEP-48 Compatibility (Registry adds attestation/semantics, never competes) | Implemented | `packages/abi-registry/src/discovery/Sep48EmbeddedClient.ts`, `packages/abi-registry/src/ChainedAbiRegistryClient.ts` |
| On-chain registry stores hash and pointer (not full spec) | Implemented | `contracts/registry/src/lib.rs` |
| Off-chain registry provides a verification pipeline cross-checking against on-chain `contractspec` | Implemented | `packages/abi-registry/src/verifySchema.ts` |
| Retroactive schema attestation for pre-SEP-48 contracts | Implemented | `packages/abi-registry/src/OnChainRegistryPublisher.ts`, `contracts/registry/src/lib.rs` |
| Attestation signature envelope verification | Implemented | `packages/abi-registry/src/verifySchema.ts` |
| Semantic taxonomy on top of raw event schemas | Unimplemented | N/A |
| Entity-label format for verified deployer attribution | Unimplemented | N/A |
