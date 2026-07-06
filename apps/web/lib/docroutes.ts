export type DocItem = {
  title: string
  href: string
}

export type DocSection = {
  title: string
  items: DocItem[]
}

export const docSections: DocSection[] = [
  {
    title: 'Getting Started',
    items: [
      { title: 'Introduction', href: '/docs/getting-started/introduction' },
      { title: 'Installation', href: '/docs/getting-started/installation' },
      { title: 'Quick Start', href: '/docs/getting-started/quick-start' },
    ],
  },
  {
    title: 'Guides',
    items: [
      { title: 'Webhooks', href: '/docs/guides/webhooks' },
      { title: 'Real-time Events', href: '/docs/guides/real-time-events' },
      { title: 'Webhook Durability', href: '/docs/guides/webhook-durability' },
      { title: 'ABI Registry & Typed Event Decoding', href: '/docs/guides/abi-registry' },
      { title: 'Migrate from raw EventSource', href: '/docs/guides/migrate-from-eventsource' },
      { title: 'Soroban Event Subscription', href: '/docs/guides/soroban-subscription' },
    ],
  },
  {
    title: 'API Reference',
    items: [
      { title: 'pulse-core', href: '/docs/api/pulse-core' },
      { title: 'pulse-webhooks', href: '/docs/api/pulse-webhooks' },
      { title: 'pulse-notify', href: '/docs/api/pulse-notify' },
    ],
  },
]

export const allDocPages: DocItem[] = docSections.flatMap((s) => s.items)

export const referenceSections: DocSection[] = [
  {
    title: 'API Reference',
    items: [
      { title: 'pulse-core', href: '/reference/pulse-core' },
      { title: 'pulse-webhooks', href: '/reference/pulse-webhooks' },
      { title: 'pulse-notify', href: '/reference/pulse-notify' },
    ],
  },
]
