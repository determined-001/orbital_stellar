# pulse-core Changelog

## Unreleased

### Breaking Changes
- **WatcherNotification API**: The `timestamp` field on `WatcherNotification` (`engine.reconnecting` and `engine.reconnected` events) has been renamed to `emittedAt` to distinguish it from the on-chain `created_at` timestamp used in other events like `payment.received`.
