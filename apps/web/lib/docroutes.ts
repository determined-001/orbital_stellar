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
