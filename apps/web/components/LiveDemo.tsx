'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const NETWORK = process.env.NEXT_PUBLIC_NETWORK ?? 'testnet'

interface StellarEvent {
  type: string
  amount?: string
  asset?: string
  timestamp: string
}

interface LimitEnvelope {
  error: 'demo_limit_reached'
  reason: 'per_ip_stream_limit' | 'session_expired' | 'rate_limit'
  message: string
  upgradeUrl: string
}

const DOTS = [
  { color: '#FF5F57' },
  { color: '#FEBC2E' },
  { color: '#28C840' },
]

type Status = 'idle' | 'connecting' | 'live' | 'error' | 'limit'

async function streamEvents(
  address: string,
  signal: AbortSignal,
  onEvent: (e: StellarEvent) => void,
  onLimit: (l: LimitEnvelope) => void
) {
  const res = await fetch(`/api/events/${encodeURIComponent(address)}`, { signal })

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
        onEvent(JSON.parse(data) as StellarEvent)
      } catch {
        /* skip */
      }
    }
  }
}

export default function LiveDemo() {
  const [address, setAddress] = useState('')
  const [events, setEvents] = useState<StellarEvent[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [limit, setLimit] = useState<LimitEnvelope | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function handleWatch() {
    if (!address.trim()) return
    abortRef.current?.abort()
    setEvents([])
    setErrorMsg('')
    setLimit(null)
    setStatus('connecting')

    const ac = new AbortController()
    abortRef.current = ac

    streamEvents(
      address.trim(),
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
          : 'Connection failed. Check the address and try again.'
      )
    })
  }

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  return (
    <section style={{ padding: '120px 32px' }}>

      {/* Network notice */}
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
        ⚠️ This demo streams <strong>Stellar {NETWORK}</strong> events only.
      </div>

      <div
        style={{
          maxWidth: 'var(--max-width)',
          margin: '0 auto',
        }}
        className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-20 items-start"
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
            Watch any address. Live.
          </h2>
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '15px',
              color: 'var(--muted2)',
              lineHeight: 1.6,
            }}
          >
            Connect to a real Stellar address and watch events arrive in real time — straight from the {NETWORK}.
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
              event stream
            </span>
          </div>

          {/* Input row */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleWatch()}
              placeholder="G..."
              style={{
                flex: 1,
                fontFamily: 'var(--font-mono)',
                fontSize: '14px',
                background: 'transparent',
                border: 'none',
                borderBottom: 'none',
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

          {/* Event feed */}
          <div
            style={{
              height: '260px',
              overflowY: 'auto',
              padding: '16px',
            }}
          >
            {status === 'idle' && (
              <p
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '14px',
                  color: 'var(--muted)',
                  textAlign: 'center',
                  marginTop: '80px',
                }}
              >
                Paste a Stellar address to start watching.
              </p>
            )}
            {status === 'connecting' && (
              <p
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '14px',
                  color: 'var(--muted)',
                  textAlign: 'center',
                  marginTop: '80px',
                }}
              >
                Connecting...
              </p>
            )}
            {status === 'live' && events.length === 0 && (
              <p
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '14px',
                  color: 'var(--muted)',
                  textAlign: 'center',
                  marginTop: '80px',
                }}
              >
                Waiting for events on {NETWORK}...
              </p>
            )}
            {status === 'error' && (
              <p
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '14px',
                  color: '#FF5370',
                  textAlign: 'center',
                  marginTop: '80px',
                }}
              >
                {errorMsg}
              </p>
            )}
            {status === 'limit' && limit && (
              <div
                style={{
                  textAlign: 'center',
                  marginTop: '60px',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <p
                  style={{
                    fontSize: '14px',
                    color: '#facc15',
                    marginBottom: '12px',
                  }}
                >
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
            <AnimatePresence initial={false}>
              {events.map((ev, idx) => (
                <motion.div
                  key={`${ev.type}-${ev.timestamp}-${idx}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 0',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px',
                      color: 'var(--accent)',
                      minWidth: '160px',
                    }}
                  >
                    {ev.type}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: '13px',
                      color: '#fff',
                      flex: 1,
                      textAlign: 'center',
                    }}
                  >
                    {ev.amount && ev.asset ? `${ev.amount} ${ev.asset}` : '—'}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      color: 'var(--muted)',
                    }}
                  >
                    {ev.timestamp}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}
