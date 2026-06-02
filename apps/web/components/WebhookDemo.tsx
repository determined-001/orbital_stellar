'use client'

import { useState } from 'react'

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

interface SampleResponse {
  event: Record<string, unknown>
  payload: string
  headers: Record<string, string>
  secret?: string
  verify: { node: string; edge: string }
}

interface LimitEnvelope {
  error: 'demo_limit_reached'
  reason: string
  message: string
  upgradeUrl: string
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; data: SampleResponse }
  | { kind: 'limit'; data: LimitEnvelope }
  | { kind: 'error'; message: string }

export default function WebhookDemo() {
  const [stellarAddress, setStellarAddress] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function handleSign() {
    setState({ kind: 'loading' })
    try {
      const res = await fetch('/api/webhook-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: stellarAddress.trim() || undefined,
          secret: signingSecret.trim() || undefined,
        }),
      })

      if (res.status === 429) {
        const body = (await res.json()) as LimitEnvelope
        setState({ kind: 'limit', data: body })
        return
      }
      if (!res.ok) {
        setState({ kind: 'error', message: `HTTP ${res.status}` })
        return
      }
      const data = (await res.json()) as SampleResponse
      setState({ kind: 'ok', data })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Request failed.',
      })
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
            See a signed webhook in one call.
          </h2>
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '15px',
              color: 'var(--muted2)',
              lineHeight: 1.6,
            }}
          >
            Generate an HMAC-SHA256-signed sample payload — exactly what Orbital sends your endpoint. Verify it locally with <code>verifyWebhook</code>.
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
              webhook.sign.ts
            </span>
          </div>

          {/* Inputs */}
          <div>
            <input
              type="text"
              value={stellarAddress}
              onChange={(e) => setStellarAddress(e.target.value)}
              placeholder="G... (Stellar address — optional)"
              style={inputStyle}
            />
            <input
              type="text"
              value={signingSecret}
              onChange={(e) => setSigningSecret(e.target.value)}
              placeholder="whsec_... (your secret — optional, we'll generate one)"
              style={inputStyle}
            />
          </div>

          {/* Button + result */}
          <div style={{ padding: '16px' }}>
            <button
              onClick={handleSign}
              disabled={state.kind === 'loading'}
              style={{
                width: '100%',
                background: 'var(--accent)',
                color: '#000',
                fontFamily: 'var(--font-sans)',
                fontWeight: 700,
                fontSize: '14px',
                padding: '12px',
                border: 'none',
                cursor: state.kind === 'loading' ? 'not-allowed' : 'pointer',
                opacity: state.kind === 'loading' ? 0.6 : 1,
              }}
            >
              {state.kind === 'loading' ? 'Signing...' : 'Generate signed sample'}
            </button>

            {state.kind === 'limit' && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '14px',
                  background: '#2a2a00',
                  border: '1px solid #444400',
                  color: '#facc15',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '13px',
                }}
              >
                <p style={{ marginBottom: '10px' }}>{state.data.message}</p>
                <a
                  href={state.data.upgradeUrl}
                  style={{
                    display: 'inline-block',
                    background: 'var(--accent)',
                    color: '#000',
                    fontWeight: 700,
                    fontSize: '12px',
                    padding: '8px 14px',
                    textDecoration: 'none',
                  }}
                >
                  Upgrade to Orbital Cloud →
                </a>
              </div>
            )}

            {state.kind === 'error' && (
              <p
                style={{
                  marginTop: '16px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  color: '#FF5370',
                }}
              >
                {state.message}
              </p>
            )}

            {state.kind === 'ok' && (
              <div style={{ marginTop: '16px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                <p style={{ color: '#c3e88d', marginBottom: '8px' }}>HTTP 200</p>
                {state.data.secret && (
                  <p style={{ color: 'var(--muted2)', fontSize: '11px', marginBottom: '10px' }}>
                    Generated secret (save this): <code style={{ color: 'var(--accent)' }}>{state.data.secret}</code>
                  </p>
                )}
                <details open>
                  <summary style={{ color: 'var(--muted2)', cursor: 'pointer', marginBottom: '6px' }}>
                    Signed headers
                  </summary>
                  <pre
                    style={{
                      color: 'var(--text)',
                      background: 'var(--surface2)',
                      padding: '10px',
                      margin: 0,
                      overflowX: 'auto',
                      fontSize: '11px',
                    }}
                  >
                    {Object.entries(state.data.headers)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join('\n')}
                  </pre>
                </details>
                <details style={{ marginTop: '10px' }}>
                  <summary style={{ color: 'var(--muted2)', cursor: 'pointer', marginBottom: '6px' }}>
                    Payload
                  </summary>
                  <pre
                    style={{
                      color: 'var(--text)',
                      background: 'var(--surface2)',
                      padding: '10px',
                      margin: 0,
                      overflowX: 'auto',
                      fontSize: '11px',
                    }}
                  >
                    {JSON.stringify(state.data.event, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
