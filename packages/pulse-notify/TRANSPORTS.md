# pulse-notify — Transport Backend Contract

`pulse-notify` supports two transports, selected via the `transport` config field (default: `'sse'`).

## SSE (`transport: 'sse'`)

**Endpoint:** `GET {serverUrl}/events/{address}[?token=…]`

- Standard `text/event-stream` response.
- Each `data:` line is a JSON-serialised `NormalizedEvent`.
- The browser `EventSource` API handles reconnection automatically.
- `withCredentials` is forwarded for credentialed CORS requests.

**Heartbeat:** Send a comment line (`: heartbeat`) every 30 s to keep the connection alive through proxies.

## WebSocket (`transport: 'websocket'`)

**Endpoint:** `ws(s)://{host}/events/{address}[?token=…]`  
(`http` → `ws`, `https` → `wss` prefix conversion is applied automatically.)

- Each text frame is a JSON-serialised `NormalizedEvent` — identical shape to the SSE payload.
- `withCredentials` is not supported by the WebSocket API; use the `token` query param for auth.

**Heartbeat:** The server should send a JSON ping frame `{"type":"heartbeat"}` every 30 s. The client ignores unknown event types, so no special handling is required.

**Reconnect:** The client does not auto-reconnect on close/error in this PoC. Wrap with your own retry logic or use the SSE transport for built-in reconnection.

## Event shape (both transports)

```json
{
  "type": "payment.received",
  "to": "GDEST…",
  "from": "GSRC…",
  "amount": "10.0000000",
  "asset": "XLM",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

All fields match the `NormalizedEvent` union from `@orbital-stellar/pulse-core`.
