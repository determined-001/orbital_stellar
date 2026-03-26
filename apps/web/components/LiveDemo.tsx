'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3000'

interface StellarEvent {
  type: string
  amount?: string
  asset?: string
  timestamp: string
}

const DOTS = [
  { color: '#FF5F57' },
  { color: '#FEBC2E' },
  { color: '#28C840' },
]

export default function LiveDemo() {
  const [address, setAddress] = useState('')
  const [events, setEvents] = useState<StellarEvent[]>([])
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const esRef = useRef<EventSource | null>(null)

  function handleWatch() {
    if (!address.trim()) return
    esRef.current?.close()
    setEvents([])
    setErrorMsg('')
    setStatus('connecting')

    const es = new EventSource(`${SERVER}/events/${encodeURIComponent(address.trim())}`)
    esRef.current = es
    es.onopen = () => setStatus('live')
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as StellarEvent
        setEvents((prev) => [data, ...prev].slice(0, 50))
      } catch { /* skip malformed */ }
    }
    es.onerror = () => {
      setStatus('error')
      setErrorMsg('Connection failed or lost. Check the address and try again.')
      es.close()
    }
  }

  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
    }
  }, [])

  return (
    <section style={{ padding: '120px 32px' }}>

      {/* ✅ TESTNET NOTICE */}
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
        ⚠️ This demo streams <strong>Stellar testnet</strong> events only. Mainnet
        addresses will not produce any events.
      </div>

      <div
        style={{
          maxWidth: 'var(--max-width)',
          margin: '0 auto',
        }}
        className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-20 items-start"
      >
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
            Connect to a real Stellar address and watch events arrive in real time — straight from the testnet.
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
            {(status === 'idle' || (status === 'live' && events.length === 0)) && (
              <p
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '14px',
                  color: 'var(--muted)',
                  textAlign: 'center',
                  marginTop: '80px',
                }}
              >
                Waiting for events on testnet...
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
            <AnimatePresence initial={false}>
              {events.map((ev) => (
                <motion.div
                  key={`${ev.type}-${ev.timestamp}`}
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
