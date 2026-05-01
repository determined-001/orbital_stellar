# Changelog

## Unreleased

- `@orbital/pulse-core`: self-payments where `from === to` now emit a single
  `payment.self` event instead of separate `payment.received` and
  `payment.sent` events. Consumers that subscribe only to `payment.received` or
  `payment.sent` should also subscribe to `payment.self` if they need
  self-payment activity.
