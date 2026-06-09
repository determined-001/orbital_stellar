# @orbital/abi-registry

**Shared Soroban ABI registry for Orbital.** This package holds the canonical client surface for ABI-aware code, along with schema helpers and publisher abstractions that keep Soroban integration logic consistent across the repo.

```bash
pnpm add @orbital/abi-registry
```

## What it does

`abi-registry` is the package you use when you need to read, decode, publish, or reuse Soroban contract interface metadata without duplicating schema logic in application code.

It is the shared boundary between:

- ABI consumers in `pulse-core`
- any future Soroban event subscriber or decoder
- tooling that publishes or snapshots registry data

If you are looking for the hosted verification / publishing service, that is a separate Cloud product. This package is the open-source schema and client surface.

## Quickstart

```ts
import {
  AbiRegistryClient,
  LocalFilePublisher,
  RegistryPublisher,
  jsToScval,
  scvalToJs,
} from "@orbital/abi-registry";

const client = new AbiRegistryClient({
  baseUrl: "https://abi.example.com",
});

const spec = await client.getSpec("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
const specs = await client.getSpecs([
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
]);

const encoded = jsToScval({ hello: "world" });
const decoded = scvalToJs(encoded);

const publisher: RegistryPublisher = new LocalFilePublisher();

await publisher.publish({
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  entries: [],
});
```

## API

### `AbiRegistryClient`

Creates a cached client that fetches contract ABI specs from the configured registry endpoint. Use `getSpec(contractId)` for a single contract or `getSpecs(contractIds)` for batched lookups.

### `RegistryPublisher`

An interface for publishing registry snapshots or derived ABI artifacts.

### `LocalFilePublisher`

Reference publisher that writes registry output to the local filesystem. Useful for testing, debugging, and snapshots.

### `jsToScval(value)` / `scvalToJs(value)`

Helpers for converting between JavaScript values and Soroban `ScVal` payloads.

## Related documents

- [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) - where the registry sits in the system map
- [`docs/open-source-policy.md`](../../docs/open-source-policy.md) - the public/private boundary for the registry service

## License

MIT
