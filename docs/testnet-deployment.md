# Testnet Deployment Guide

This document describes the manual process to deploy the Orbital ABI Registry
and Demo Emitter contracts to Stellar testnet.

> **Note:** Contract deployment is a manual, one-time act. It is deliberately
> not wired into CI because contracts are immutable once deployed.

## Prerequisites

1. **stellar-cli** installed on your machine:
   ```bash
   stellar --version
   ```
   Install from: https://developers.stellar.org/docs/tools/cli/install-cli

2. **Rust with wasm32v1-none target** (for building contracts):
   ```bash
   rustup target add wasm32v1-none
   ```

3. **A funded testnet identity** — create one if you don't have one:
   ```bash
   stellar keys generate orbital-deployer --network testnet --fund
   ```

## Step-by-Step Deployment

### 1. Build contracts

From the repository root:
```bash
cd contracts
cargo build --release --target wasm32v1-none
```

### 2. Deploy contracts

Run the deployment script:
```bash
cd contracts/deploy
DEPLOYER_IDENTITY=orbital-deployer NETWORK=testnet ./deploy_testnet.sh
```

This will:
- Deploy the `orbital_abi_registry` contract to testnet
- Deploy the `orbital_demo_emitter` contract to testnet
- Write the contract IDs to `contracts/deployed.testnet.json`

### 3. Update constants with deployed IDs

After deployment, update `packages/abi-registry/src/registryConstants.ts` with
the deployed contract IDs from `contracts/deployed.testnet.json`:

```typescript
export const ORBITAL_REGISTRY_TESTNET_CONTRACT_ID = "CCY...";  // From deployed.testnet.json

export const ORBITAL_REGISTRY_PUBLISHER_ADDRESS = "G...";  // Deployer public key
```

### 4. Verify deployment

Check the contract on Stellar Expert:
```
https://stellar.expert/explorer/testnet/contract/CCY...
```

Or query via stellar-cli:
```bash
stellar contract id --wasm-hash <hash> --network testnet
```

### 5. Seed well-known specs (post-deployment)

Once the registry is deployed, the bundled well-known ABI specs need to be
published under the deployer's address. There is no seeding script in the
repository yet — it is tracked by
[issue #890](https://github.com/determined-001/orbital_stellar/issues/890)
(*8.3 Seed the registry with the four bundled well-known specs*). Until it
lands, `createDefaultAbiRegistryClient` resolves those specs from the bundled
copies, so nothing depends on the registry being seeded.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `stellar: command not found` | Install stellar-cli from the link above |
| `identity not found` | Run `stellar keys generate orbital-deployer --network testnet --fund` |
| `insufficient funds` | Get testnet XLM from the friendbot: https://friendbot.stellar.org |
| Build fails (wasm target) | Run `rustup target add wasm32v1-none` |

## CI Integration (Future)

Once contracts are deployed and verified, consider:
- Adding the contract IDs as GitHub Actions secrets
- Automating the well-known spec seeding in CI
- Adding upgrade auth checks
