'use client'

import Link from 'next/link'

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--muted)',
  marginBottom: '16px',
  display: 'block',
}

const linkStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: '14px',
  color: 'var(--muted2)',
  textDecoration: 'none',
  display: 'block',
  marginTop: '12px',
  transition: 'color 0.15s',
}

export default function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--border)', padding: '80px 52px 0' }}>
      <div>
        {/* 4-column grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '48px',
            paddingBottom: '64px',
          }}
        >
          {/* Brand */}
          <div>
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 700,
                fontSize: '16px',
                color: '#fff',
                marginBottom: '12px',
              }}
            >
              Orbit Stellar
            </p>
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '14px',
                color: 'var(--muted2)',
                lineHeight: 1.6,
                marginBottom: '24px',
              }}
            >
              Real-time event infrastructure for Stellar developers.
            </p>
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '12px',
                color: 'var(--muted)',
                marginBottom: '8px',
              }}
            >
              MIT License
            </p>
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '12px',
                color: 'var(--muted2)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span style={{ color: 'var(--accent)' }}>●</span>
              All systems operational
            </p>
          </div>

          {/* Product */}
          <div>
            <span style={labelStyle}>Product</span>
            {['Docs', 'SDKs', 'How it works', 'Changelog', 'Status'].map((item) => (
              <Link
                key={item}
                href="#"
                style={linkStyle}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted2)')}
              >
                {item}
              </Link>
            ))}
          </div>

          {/* Packages */}
          <div>
            <span style={labelStyle}>Packages</span>
            {[
              'npm i @orbital-stellar/pulse-webhooks',
              'npm i @orbital-stellar/pulse-notify',
            ].map((cmd) => (
              <p
                key={cmd}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  color: 'var(--muted2)',
                  display: 'block',
                  marginTop: '12px',
                }}
              >
                {cmd}
              </p>
            ))}
          </div>

          {/* Community */}
          <div>
            <span style={labelStyle}>Community</span>
            {['GitHub', 'Twitter', 'SCF Grant', 'Open an issue'].map((item) => (
              <Link
                key={item}
                href="#"
                style={linkStyle}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted2)')}
              >
                {item}
              </Link>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: '24px',
            paddingBottom: '48px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '13px',
              color: 'var(--muted)',
            }}
          >
            © 2026 Orbit Stellar
          </span>
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '13px',
              color: 'var(--muted)',
            }}
          >
            Built for the Stellar ecosystem
          </span>
        </div>
      </div>
    </footer>
  )
}
