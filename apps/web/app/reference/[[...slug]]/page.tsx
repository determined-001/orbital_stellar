import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getReferencePage, getAllReferenceSlugs, getReferencePackages } from '@/lib/reference'

type Props = {
  params: Promise<{ slug?: string[] }>
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params
  if (!slug || slug.length === 0) return { title: 'API Reference — Orbital Stellar Docs' }
  const page = await getReferencePage(slug)
  if (!page) return {}
  return { title: `${page.title} — Orbital Stellar Reference` }
}

export function generateStaticParams() {
  return [{ slug: [] }, ...getAllReferenceSlugs().map((slug) => ({ slug }))]
}

export default async function ReferencePage({ params }: Props) {
  const { slug } = await params

  if (!slug || slug.length === 0) {
    const packages = getReferencePackages()
    return (
      <div className="px-10 lg:px-14 py-12">
        <header className="mb-10">
          <h1
            className="text-4xl font-bold text-white mb-3 leading-tight"
            style={{ fontFamily: 'var(--font-instrument-serif)' }}
          >
            API Reference
          </h1>
          <p className="text-white/45 text-xl leading-relaxed">
            Auto-generated from TSDoc comments in each package&apos;s source.
          </p>
        </header>
        <ul className="space-y-2">
          {packages.map((pkg) => (
            <li key={pkg}>
              <Link
                href={`/reference/${encodeURIComponent(pkg)}`}
                className="text-accent hover:underline"
              >
                {pkg}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const page = await getReferencePage(slug)
  if (!page) notFound()

  return (
    <div className="px-10 lg:px-14 py-12">
      <header className="mb-10">
        <h1
          className="text-4xl font-bold text-white mb-3 leading-tight"
          style={{ fontFamily: 'var(--font-instrument-serif)' }}
        >
          {page.title}
        </h1>
      </header>

      <hr className="border-white/[0.08] mb-10" />

      <article className="doc-content" dangerouslySetInnerHTML={{ __html: page.content }} />
    </div>
  )
}
