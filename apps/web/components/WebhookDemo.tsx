'use client'

import { useState } from 'react'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3000'

const DOTS = [
  { color: '#FF5F57' },
  { color: '#FEBC2E' },
  { color: '#28C840' },
]

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: 'var(--font-mono)',
  fontSize: '14px',
  background: 'var(--surface2)',
  border: 'none',
  borderBottom: '1px solid var(--border)',
  color: '#fff',
  padding: '12px 16px',
  outline: 'none',
  boxSizing: 'border-box',
}

export default function WebhookDemo() {
  const [stellarAddress, setStellarAddress] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [response, setResponse] = useState<{ ok: boolean; status?: number; body: string } | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleRegister() {
    if (!stellarAddress.trim() || !webhookUrl.trim()) {
      setResponse({
        ok: false,
        body: 'Address and webhook URL are required',
      })
      return
    }

    if (!signingSecret.trim()) {
      setResponse({
        ok: false,
        body: 'Signing secret is required',
      })
      return
    }

    setLoading(true)
    setResponse(null)

    try {
      const res = await fetch(`${SERVER}/webhooks/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },

        // ✅ MUST match server contract (apps/server/src/routes.ts)
        body: JSON.stringify({
          address: stellarAddress.trim(),
          url: webhookUrl.trim(),
          secret: signingSecret.trim(),
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setResponse({
          ok: false,
          status: res.status,
          body: data?.error || 'Webhook registration failed',
        })
        return
      }

      setResponse({
        ok: true,
        status: res.status,
        body: JSON.stringify(data, null, 2),
      })
    } catch (err) {
      setResponse({
        ok: false,
        body: err instanceof Error ? err.message : 'Request failed.',
      })
    } finally {
      setLoading(false)
    }
  }
  return (
    <section style={{ padding: '120px 32px' }}>
      <div
        style={{
          maxWidth: 'var(--max-width)',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '80px',
          alignItems: 'start',
        }}
      >
        {/* Left — text */}
        <div>
          <h2
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(1.75rem, 3vw, 2.5rem)',
              color: '#fff',
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
              marginBottom: '16px',
            }}
          >
            Register a webhook in one call.
          </h2>
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '15px',
              color: 'var(--muted2)',
              lineHeight: 1.6,
            }}
          >
            Point Orbit Stellar at your endpoint — we handle delivery, retries, and HMAC signing.
          </p>
        </div>

        {/* Right — panel */}
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          {/* Panel header */}
          <div
            style={{
              height: '48px',
              background: 'var(--surface2)',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 16px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px' }}>
              {DOTS.map((dot) => (
                <span
                  key={dot.color}
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: dot.color,
                    display: 'inline-block',
                  }}
                />
              ))}
            </div>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--muted)',
              }}
            >
              webhook.register.ts
            </span>
          </div>

          {/* Inputs */}
          <div>
            <input
              type="text"
              value={stellarAddress}
              onChange={(e) => setStellarAddress(e.target.value)}
              placeholder="G... (Stellar address)"
              style={inputStyle}
            />
            <input
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://myapp.com/hooks/stellar"
              style={inputStyle}
            />
            <input
              type="text"
              value={signingSecret}
              onChange={(e) => setSigningSecret(e.target.value)}
              placeholder="whsec_..."
              style={inputStyle}
            />
          </div>

          {/* Button */}
          <div style={{ padding: '16px' }}>
            <button
              onClick={handleRegister}
              disabled={loading}
              style={{
                width: '100%',
                background: 'var(--accent)',
                color: '#000',
                fontFamily: 'var(--font-sans)',
                fontWeight: 700,
                fontSize: '14px',
                padding: '12px',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Registering...' : 'Register webhook'}
            </button>

            {/* Response */}
            {response && (
              <div style={{ marginTop: '16px' }}>
                {response.status && (
                  <p
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px',
                      color: response.ok ? '#c3e88d' : '#FF5370',
                      marginBottom: '8px',
                    }}
                  >
                    HTTP {response.status}
                  </p>
                )}
                <pre
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    color: response.ok ? 'var(--text)' : '#FF5370',
                    background: 'var(--surface2)',
                    padding: '12px',
                    overflowX: 'auto',
                    margin: 0,
                  }}
                >
                  {response.body}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
