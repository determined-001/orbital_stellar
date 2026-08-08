/**
 * Content-Security-Policy.
 *
 * `'unsafe-inline'` is present for styles because the app styles via inline
 * `style={{...}}` props throughout, and Next injects its own inline styles.
 * Scripts need `'unsafe-inline'` for Next's bootstrap payload and
 * `'unsafe-eval'` in development for React Refresh; production drops the eval.
 *
 * `connect-src` stays 'self' - the browser talks to this app's own SSE routes,
 * and it is the server that reaches Horizon and Soroban RPC.
 */
function contentSecurityPolicy() {
  const isDev = process.env.NODE_ENV === 'development'
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't advertise the framework and version an attacker would use to pick a CVE.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          // frame-ancestors above covers modern browsers; this is the legacy
          // equivalent. /demo/contracts was otherwise clickjackable.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
