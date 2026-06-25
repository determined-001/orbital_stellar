# @orbital-stellar/web

**The public Orbital site** — landing page, documentation, and live testnet demos. Built with Next.js 16, Tailwind CSS, and Framer Motion. Also hosts the marketing-demo API routes (`/api/events/[address]`, `/api/webhook-sample`) that power the on-page sandbox.

## Running locally

```bash
pnpm install
NEXT_PUBLIC_NETWORK=testnet pnpm --filter orbital/web dev
```

The site runs on `http://localhost:3000`.

## Environment

| Variable | Required | Values | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_NETWORK` | yes | `testnet` \| `mainnet` | Stellar network the demo `EventEngine` subscribes to. Surfaced in the UI's network notice. Fails loudly at first request if missing or invalid. |

## Demo limits

The on-page demos are intentionally sandboxed so they don't burn Vercel resources:

- **`/api/events/[address]`** — 1 concurrent SSE stream per IP, 25-second max duration per stream.
- **`/api/webhook-sample`** — 1 signing request per IP every 20 seconds.

When a limit trips, the route returns `429` with a JSON envelope (`{ error: "demo_limit_reached", reason, message, upgradeUrl }`) and the demo components surface an "Upgrade to Orbital Cloud" call-to-action. Tune the numbers in `lib/demo-limits.ts`.

## Structure

| Path | Purpose |
|---|---|
| `app/` | Next.js App Router pages, layouts, and `/api/*` route handlers |
| `components/` | Reusable UI components |
| `content/` | Markdown-sourced content (docs, blog posts) rendered via `gray-matter` + `marked` |
| `lib/` | Utilities — content loaders, demo engine singleton, rate limits, env validation |

## Content authoring

Documentation pages are authored in Markdown under `content/`. Frontmatter is parsed by `gray-matter`; body is rendered by `marked`. Add a new page by dropping a new `.md` file into the appropriate `content/` subdirectory — the route is inferred from the filename.

## Styling

Tailwind CSS 4 is configured in `tailwind.config.ts`. Use utility classes directly; avoid authoring bespoke CSS modules. Design tokens (color palette, typography scale) are defined in the Tailwind config.

## Deployment

The site is deployed via Vercel from the `main` branch. Preview deploys run automatically on pull requests.

## Contributing

Content corrections, typo fixes, and new tutorial pages are welcome. For larger changes (new sections, design overhauls) open an issue first — the design system is intentionally constrained.

## License

MIT
