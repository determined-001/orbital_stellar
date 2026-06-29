# Add config-based Soroban contract subscription API

## Summary
Adds a public config-based API for subscribing to Soroban contract events through the event engine.

## What changed
- Introduces `ContractFilter` and `ContractSubscriptionConfig` types for RPC-style contract event subscriptions.
- Adds `engine.subscribeContract(config)` as a public entry point.
- Validates subscription config at construction time:
  - rejects more than 5 filters
  - rejects any filter with more than 5 contract IDs
- Deduplicates repeated subscriptions by a stable key so equal configs return the same watcher instance.

## Why
This enables callers to subscribe to Soroban contract events using a structured filter configuration rather than relying on legacy subscription patterns.

## Testing
- Added focused coverage for:
  - successful config-based subscriptions
  - deduplication behavior
  - validation errors for invalid filter shapes

## PR note
The branch currently has no unique commits compared with the target branch, so the comparison shows no changes. Switching the base branch in GitHub will make the PR diff visible.
