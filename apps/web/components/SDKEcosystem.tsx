'use client'

import { useState } from 'react'

const PACKAGES = [
  {
    pkg: '@orbital-stellar/pulse-webhooks',
    title: 'Pulse Webhooks',
    description: 'Signed webhook delivery with retries, secrets, and delivery logs for your server.',
    status: 'Live' as const,
  },
  {
    pkg: '@orbital-stellar/pulse-notify',
    title: 'Pulse Notify',
    description: 'React hooks for real-time Stellar events. Drop in, subscribe, done.',
    status: 'Live' as const,
  },
  {
    pkg: '@orbital-stellar/hooks',
    title: 'Stellar Hooks',
    description: 'useAccount, useTransaction, useBalance and more data hooks for React.',
    status: 'Coming soon' as const,
  },
  {
    pkg: '@orbital-stellar/auth',
    title: 'Auth SDK',
    description: 'Embedded wallets, passkeys, and fee sponsorship for Stellar apps.',
    status: 'Coming soon' as const,
  },
  {
    pkg: '@orbital-stellar/payments',
    title: 'Payments SDK',
    description: 'Send, receive, swap and programmable payroll on Stellar.',
    status: 'Coming soon' as const,
  },
  {
    pkg: '@orbital-stellar/testing',
    title: 'Testing Utils',
    description: 'Mock Horizon responses and local testnet helpers for CI.',
    status: 'Coming soon' as const,
  },
]

function Card({ pkg, title, description, status }: typeof PACKAGES[0]) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--surface)',
        border: `1px solid ${hovered ? 'var(--border-hover)' : 'var(--border)'}`,
        padding: '28px',
        display: 'flex',
        flexDirection: 'column',
        transition: 'border-color 0.15s',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          color: 'var(--muted)',
        }}
      >
        {pkg}
      </p>
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '18px',
          fontWeight: 600,
          color: '#fff',
          marginTop: '12px',
        }}
      >
        {title}
      </p>
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '14px',
          color: 'var(--muted2)',
          lineHeight: 1.6,
          marginTop: '8px',
          flex: 1,
        }}
      >
        {description}
      </p>
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          color: status === 'Live' ? 'var(--accent)' : 'var(--muted)',
          marginTop: '20px',
        }}
      >
        {status === 'Live' ? '● Live' : '○ Soon'}
      </p>
    </div>
  )
}

export default function SDKEcosystem() {
  return (
    <section style={{ padding: '120px 32px' }}>
      <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto' }}>
        <h2
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 'clamp(1.75rem, 3vw, 2.5rem)',
            color: '#fff',
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
            marginBottom: '48px',
            textAlign: 'center',
          }}
        >
          One namespace. Every layer you need.
        </h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '1px',
            background: 'var(--border)',
          }}
        >
          {PACKAGES.map((pkg) => (
            <Card key={pkg.pkg} {...pkg} />
          ))}
        </div>
      </div>
    </section>
  )
}
