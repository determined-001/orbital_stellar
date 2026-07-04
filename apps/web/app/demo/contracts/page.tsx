'use client'

import { useState, useEffect, useRef } from 'react'

const NETWORK = process.env.NEXT_PUBLIC_NETWORK ?? 'testnet'

type ContractEvent = {
  type: 'contract.emitted' | 'contract.invoked'
  contractId: string
  topics?: string[]
  data?: unknown
  decodedData?: unknown
  function?: string
  args?: unknown[]
  ledger?: number
  txHash?: string
  timestamp: string
}

interface LimitEnvelope {
  error: 'demo_limit_reached'
  reason: 'per_ip_stream_limit' | 'session_expired' | 'rate_limit'
  message: string
  upgradeUrl: string
}

type Status = 'idle' | 'connecting' | 'live' | 'error' | 'limit'

async function streamEvents(
  contractId: string,
  signal: AbortSignal,
  onEvent: (e: ContractEvent) => void,
  onLimit: (l: LimitEnvelope) => void
) {
  const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}`, { signal })

  if (res.status === 429 || res.status === 400) {
    const body = (await res.json().catch(() => null)) as LimitEnvelope | null
    if (body?.error === 'demo_limit_reached') onLimit(body)
    else throw new Error(`HTTP ${res.status}`)
    return
  }
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    buf += decoder.decode(value, { stream: true })

    const chunks = buf.split('\n\n')
    buf = chunks.pop() ?? ''

    for (const chunk of chunks) {
      const lines = chunk.split('\n')
      const eventLine = lines.find((l) => l.startsWith('event: '))
      const dataLine = lines.find((l) => l.startsWith('data: '))
      if (!dataLine) continue

      const data = dataLine.slice(6)
      if (eventLine === 'event: session_expired') {
        try {
          onLimit(JSON.parse(data) as LimitEnvelope)
        } catch {
          /* malformed */
        }
        return
      }
      try {
        onEvent(JSON.parse(data) as ContractEvent)
      } catch {
        /* skip */
      }
    }
  }
}

function matchesTopic(ev: ContractEvent, topic: string): boolean {
  if (!topic) return true
  const needle = topic.toLowerCase()
  if (ev.function?.toLowerCase().includes(needle)) return true
  return (ev.topics ?? []).some((t) => t.toLowerCase().includes(needle))
}

export default function ContractEventsPlayground() {
  const [contractId, setContractId] = useState('')
  const [topic, setTopic] = useState('')
  const [events, setEvents] = useState<ContractEvent[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [limit, setLimit] = useState<LimitEnvelope | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function handleWatch() {
    if (!contractId.trim()) return
    abortRef.current?.abort()
    setEvents([])
    setErrorMsg('')
    setLimit(null)
    setStatus('connecting')

    const ac = new AbortController()
    abortRef.current = ac

    streamEvents(
      contractId.trim(),
      ac.signal,
      (ev) => {
        setStatus('live')
        setEvents((prev) => [ev, ...prev].slice(0, 50))
      },
      (l) => {
        setLimit(l)
        setStatus('limit')
      }
    ).catch((err: unknown) => {
      if (ac.signal.aborted) return
      setStatus('error')
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Connection failed. Check the contract ID and try again.'
      )
    })
  }

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const visibleEvents = events.filter((ev) => matchesTopic(ev, topic))

  return (
    <section style={{ padding: '120px 32px' }}>
      <div
        style={{
          maxWidth: 'var(--max-width)',
          margin: '0 auto 24px auto',
          padding: '12px 16px',
          background: '#2a2a00',
          border: '1px solid #444400',
          color: '#facc15',
          fontSize: '13px',
          fontFamily: 'var(--font-sans)',
        }}
      >
        ⚠️ This demo streams <strong>Soroban {NETWORK}</strong> contract events only.
      </div>

      <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto' }}>
        <h1
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 'clamp(1.75rem, 3vw, 2.5rem)',
            color: '#fff',
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
            marginBottom: '16px',
          }}
        >
          Soroban Contract Events Playground
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '15px',
            color: 'var(--muted2)',
            lineHeight: 1.6,
            marginBottom: '32px',
            maxWidth: '640px',
          }}
        >
          Paste a deployed Soroban contract ID and watch its <code>contract.emitted</code> and{' '}
          <code>contract.invoked</code> events stream in live from {NETWORK}.
        </p>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
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
              {['#FF5F57', '#FEBC2E', '#28C840'].map((color) => (
                <span
                  key={color}
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: color,
                    display: 'inline-block',
                  }}
                />
              ))}
            </div>
            <span
              style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--muted)' }}
            >
              contract event stream
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex' }}>
              <input
                type="text"
                value={contractId}
                onChange={(e) => setContractId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleWatch()}
                placeholder="C... (Soroban contract ID)"
                style={{
                  flex: 1,
                  fontFamily: 'var(--font-mono)',
                  fontSize: '14px',
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  padding: '12px 16px',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleWatch}
                style={{
                  background: 'var(--accent)',
                  color: '#000',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 700,
                  fontSize: '13px',
                  padding: '12px 20px',
                  border: 'none',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                Watch
              </button>
            </div>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic / function filter (optional)"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                background: 'transparent',
                border: 'none',
                borderTop: '1px solid var(--border)',
                color: 'var(--muted2)',
                padding: '10px 16px',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ minHeight: '260px', maxHeight: '520px', overflowY: 'auto', padding: '16px' }}>
            {status === 'idle' && (
              <p style={emptyStateStyle}>Paste a contract ID to start watching.</p>
            )}
            {status === 'connecting' && <p style={emptyStateStyle}>Connecting...</p>}
            {status === 'live' && visibleEvents.length === 0 && (
              <p style={emptyStateStyle}>Waiting for events on {NETWORK}...</p>
            )}
            {status === 'error' && <p style={{ ...emptyStateStyle, color: '#FF5370' }}>{errorMsg}</p>}
            {status === 'limit' && limit && (
              <div style={{ textAlign: 'center', marginTop: '60px', fontFamily: 'var(--font-sans)' }}>
                <p style={{ fontSize: '14px', color: '#facc15', marginBottom: '12px' }}>
                  {limit.message}
                </p>
                <a
                  href={limit.upgradeUrl}
                  style={{
                    display: 'inline-block',
                    background: 'var(--accent)',
                    color: '#000',
                    fontWeight: 700,
                    fontSize: '13px',
                    padding: '10px 18px',
                    textDecoration: 'none',
                  }}
                >
                  Upgrade to Orbital Cloud →
                </a>
              </div>
            )}
            {visibleEvents.map((ev, idx) => (
              <div
                key={`${ev.type}-${ev.txHash ?? ev.timestamp}-${idx}`}
                style={{
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent)' }}>
                  <span>{ev.type}</span>
                  <span style={{ color: 'var(--muted)' }}>{ev.timestamp}</span>
                </div>
                <pre
                  style={{
                    marginTop: '6px',
                    color: '#fff',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {JSON.stringify(
                    {
                      contractId: ev.contractId,
                      topics: ev.topics,
                      function: ev.function,
                      args: ev.args,
                      data: ev.decodedData ?? ev.data,
                      ledger: ev.ledger,
                      txHash: ev.txHash,
                    },
                    null,
                    2
                  )}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

const emptyStateStyle: import('react').CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: '14px',
  color: 'var(--muted)',
  textAlign: 'center',
  marginTop: '80px',
}
