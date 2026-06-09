# Integration Tests

This directory contains integration tests that run against the live Stellar Horizon testnet endpoint.

## Purpose

These integration tests verify that the EventEngine works correctly against real Horizon behavior, including:
- Rate limiting
- Stream backpressure  
- Real payload variants
- Connection handling and reconnection logic

## Running Tests

Integration tests are gated behind the `INTEGRATION_TESTS` environment variable to prevent accidental execution against external services.

### Locally

```bash
# Run integration tests
INTEGRATION_TESTS=true pnpm test:integration

# Or run from root directory
INTEGRATION_TESTS=true pnpm test:integration
```

### In CI

Integration tests run automatically on a scheduled basis (daily at 2:00 AM UTC) via GitHub Actions. They can also be triggered manually.

## Test Account

The tests use a known testnet account (`GBBDQF3HQ4I7KZ7A5LJ4SXGWH4U7KRN2WA4YOJXKXEBVNBKWO6BMGQRF`) that receives periodic faucet payments to assert event delivery end-to-end.

## Test Coverage

- **Connection Test**: Verifies the engine can connect to live Horizon and stream payments
- **Error Handling Test**: Tests graceful handling of connection errors and reconnection
- **Asset Normalization Test**: Validates proper normalization of different asset types (XLM, custom assets)
- **Registry Management Test**: Ensures watcher registry is maintained during reconnection events

## Timeout

Tests have extended timeouts (30-65 seconds) to account for network latency and the time needed to receive real payment events from the testnet.

## Troubleshooting

If tests fail due to no events received:
1. Check that the testnet account is active and receiving payments
2. Verify network connectivity to horizon-testnet.stellar.org
3. Check for any Horizon service disruptions
4. Consider running tests manually with `workflow_dispatch` in GitHub Actions
