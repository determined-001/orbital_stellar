import { defineOrbitalConfig } from '@orbital-stellar/abi-registry';

export default defineOrbitalConfig({
  contracts: [
    { name: 'demo-emitter', network: 'testnet', id: 'CC...DEMO' },
    { name: 'well-known', network: 'mainnet', id: 'CC...MAIN' }
  ],
  outDir: './src/generated'
});
