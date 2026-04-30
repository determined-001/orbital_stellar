---
title: Quick Start
description: Get real-time Stellar events in under 5 minutes.
---

## 1. Start the server

```bash
cd apps/server && npm run dev
# Server running on http://localhost:3000 (testnet)
```

## 2. Register a webhook

Send a `POST` to `/webhooks/register` with the address you want to watch, your endpoint URL, and a signing secret:

```bash
curl -X POST http://localhost:3000/webhooks/register \
  -H "Content-Type: application/json" \
  -d '{
    "address": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "url": "https://your-app.com/webhook",
    "secret": "my-signing-secret"
  }'
```

Your endpoint will now receive signed `POST` requests for every payment on that address.

## 3. Verify incoming webhooks

```typescript
import { verifyWebhook } from '@orbital/pulse-webhooks'

app.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const signature = req.headers['x-orbital-signature'] as string
  const timestamp = req.headers['x-orbital-timestamp'] as string
  const payload = req.body.toString('utf8')
  const event = verifyWebhook(payload, signature, 'my-signing-secret', timestamp)

  if (!event) return res.status(401).send('Invalid signature')

  console.log('Received event:', event)

  res.sendStatus(200)
})
```

## 4. Use React hooks

In your frontend, subscribe to live events with a single hook:

```tsx
import { useStellarPayment } from '@orbital/pulse-notify'

export function PaymentFeed({ address }: { address: string }) {
  const { event, connected } = useStellarPayment(
    process.env.NEXT_PUBLIC_SERVER_URL!,
    address
  )

  return (
    <div>
      <span>{connected ? '● Live' : '○ Connecting...'}</span>
      {event && (
        <p>
          {event.type === 'payment.received' ? 'Received' : 'Sent'}{' '}
          {event.amount} {event.asset}
        </p>
      )}
    </div>
  )
}
```

## 5. Watch events via SSE (without React)

```typescript
const source = new EventSource(
  `http://localhost:3000/events/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN`
)

source.onmessage = (e) => {
  const event = JSON.parse(e.data)
  console.log(event.type, event.amount, event.asset)
}
```

That's it. You're now streaming real-time Stellar events.
