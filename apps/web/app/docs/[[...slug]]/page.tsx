import { notFound, redirect } from 'next/navigation'
import { getDocPage } from '@/lib/docs'
import { allDocPages } from '@/lib/docroutes'

type Props = {
  params: { slug?: string[] }
}

export async function generateMetadata({ params }: Props) {
  const { slug } = params
  if (!slug || slug.length === 0) return {}
  const page = await getDocPage(slug)
  if (!page) return {}
  return {
    title: `${page.title} — Orbital Stellar Docs`,
    description: page.description,
  }
}

export function generateStaticParams() {
  return allDocPages.map((page) => ({
    slug: page.href.replace('/docs/', '').split('/'),
  }))
}

export default async function DocPage({ params }: Props) {
  const { slug } = params

  // /docs → redirect to first page
  if (!slug || slug.length === 0) {
    redirect('/docs/getting-started/introduction')
  }

  const page = await getDocPage(slug)
  if (!page) notFound()

  // Pagination: find previous / next in the flat page list
  const currentHref = '/docs/' + slug.join('/')
  const currentIdx = allDocPages.findIndex((p) => p.href === currentHref)
  const prev = currentIdx > 0 ? allDocPages[currentIdx - 1] : null
  const next = currentIdx < allDocPages.length - 1 ? allDocPages[currentIdx + 1] : null

  return (
    <div className="px-10 lg:px-14 py-12">
      {/* Page header */}
      <header className="mb-10">
        <h1
          className="text-4xl font-bold text-white mb-3 leading-tight"
          style={{ fontFamily: 'var(--font-instrument-serif)' }}
        >
          {page.title}
        </h1>
        {page.description && (
          <p className="text-white/45 text-xl leading-relaxed">{page.description}</p>
        )}
      </header>

      <hr className="border-white/[0.08] mb-10" />

      {/* Rendered markdown */}
      <article
        className="doc-content"
        dangerouslySetInnerHTML={{ __html: page.content }}
      />

      {/* Pagination */}
      <nav className="flex items-start justify-between mt-20 pt-8 border-t border-white/[0.08] gap-4">
        {prev ? (
          <a href={prev.href} className="group flex flex-col gap-1">
            <span className="flex items-center gap-1 text-xs text-white/30 group-hover:text-white/50 transition-colors">
              <ChevronLeft />
              Previous
            </span>
            <span className="text-sm font-medium text-white/70 group-hover:text-accent transition-colors">
              {prev.title}
            </span>
          </a>
        ) : (
          <div />
        )}

        {next ? (
          <a href={next.href} className="group flex flex-col gap-1 items-end">
            <span className="flex items-center gap-1 text-xs text-white/30 group-hover:text-white/50 transition-colors">
              Next
              <ChevronRight />
            </span>
            <span className="text-sm font-medium text-white/70 group-hover:text-accent transition-colors">
              {next.title}
            </span>
          </a>
        ) : (
          <div />
        )}
      </nav>
    </div>
  )
}

function ChevronLeft() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}
