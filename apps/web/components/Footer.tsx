'use client'

import Link from 'next/link'

import {
  FOOTER_COMMUNITY_LINKS,
  FOOTER_PRODUCT_LINKS,
  NPM_PACKAGES,
  npmUrl,
  type NavLink,
} from '@/lib/links'

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

function FooterLink({ label, href, external }: NavLink) {
  return (
    <Link
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      style={linkStyle}
      onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted2)')}
    >
      {label}
    </Link>
  )
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
              Orbital
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
            {/*
              A hardcoded "● All systems operational" badge used to sit here,
              next to a "Status" link that went nowhere. There is no uptime
              monitor behind it, so it was green even while the demo endpoint
              was returning 503. Removed rather than faked - put it back only
              alongside a real status source.
            */}
          </div>

          {/* Product */}
          <div>
            <span style={labelStyle}>Product</span>
            {FOOTER_PRODUCT_LINKS.map((link) => (
              <FooterLink key={link.label} {...link} />
            ))}
          </div>

          {/* Packages */}
          <div>
            <span style={labelStyle}>Packages</span>
            {/*
              All six published packages, each linked to its npm page. This
              listed only two of them as unlinked plain text, which understated
              what is actually shipped and gave the reader nowhere to go.
            */}
            {NPM_PACKAGES.map((pkg) => (
              <Link
                key={pkg}
                href={npmUrl(pkg)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  color: 'var(--muted2)',
                  textDecoration: 'none',
                  display: 'block',
                  marginTop: '12px',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted2)')}
              >
                @orbital-stellar/{pkg}
              </Link>
            ))}
          </div>

          {/* Community */}
          <div>
            <span style={labelStyle}>Community</span>
            {FOOTER_COMMUNITY_LINKS.map((link) => (
              <FooterLink key={link.label} {...link} />
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
            © 2026 Orbital
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
