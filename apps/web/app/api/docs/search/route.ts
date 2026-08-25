import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { docSections } from '@/lib/docroutes'
import { checkWebhookCooldown, clientIp } from '@/lib/demo-limits'

export type SearchResult = {
  title: string
  href: string
  section: string
  snippet: string     // plain text excerpt around the match
  matchInTitle: boolean
}

const contentDir = path.join(process.cwd(), 'content')

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')   // fenced code blocks
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1)) // inline code
    .replace(/#{1,6}\s+/g, '')         // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1')     // italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/>\s+/g, '')              // blockquotes
    .replace(/\|[^\n]+\|/g, '')        // tables
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function getSnippet(content: string, query: string, length = 160): string {
  const lower = content.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1) return content.slice(0, length).trim() + '…'

  const before = Math.max(0, idx - 60)
  const after = Math.min(content.length, idx + query.length + 100)
  let snippet = content.slice(before, after).trim()

  if (before > 0) snippet = '…' + snippet
  if (after < content.length) snippet = snippet + '…'
  return snippet
}

type IndexedDoc = {
  title: string
  href: string
  section: string
  plainContent: string
  lowerTitle: string
  lowerContent: string
}

/**
 * The docs corpus, parsed once per process.
 *
 * Every request used to `existsSync` + `readFileSync` + `gray-matter` + regex
 * strip every doc file, on a route with no rate limit that the search UI calls
 * on a 200ms debounce. The content is build-time static - it cannot change
 * while the server is running - so there is no reason to redo any of it.
 */
let corpus: IndexedDoc[] | null = null

function getCorpus(): IndexedDoc[] {
  if (corpus) return corpus

  const docs: IndexedDoc[] = []
  for (const section of docSections) {
    for (const item of section.items) {
      const slug = item.href.replace('/docs/', '').split('/')
      const filePath = path.join(contentDir, ...slug) + '.md'
      if (!fs.existsSync(filePath)) continue

      const raw = fs.readFileSync(filePath, 'utf-8')
      const { data: fm, content } = matter(raw)
      const title = (fm.title as string) || item.title
      const plainContent = stripMarkdown(content)

      docs.push({
        title,
        href: item.href,
        section: section.title,
        plainContent,
        lowerTitle: title.toLowerCase(),
        lowerContent: plainContent.toLowerCase(),
      })
    }
  }

  corpus = docs
  return corpus
}

/**
 * Longest query we will scan the corpus for. Past this a query cannot match
 * anything meaningful, and the length is attacker-controlled.
 */
const MAX_QUERY_LENGTH = 128

export async function GET(request: NextRequest) {
  const ip = clientIp(request)
  const cooldown = checkWebhookCooldown(ip)
  if (!cooldown.ok) {
    return NextResponse.json(cooldown.body, {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(cooldown.body.retryAfterMs / 1000)) },
    })
  }

  const query = request.nextUrl.searchParams.get('q')?.trim().slice(0, MAX_QUERY_LENGTH) ?? ''

  if (query.length < 2) {
    return NextResponse.json([] as SearchResult[])
  }

  const lowerQuery = query.toLowerCase()
  const results: (SearchResult & { score: number })[] = []

  for (const doc of getCorpus()) {
    const titleMatch = doc.lowerTitle.includes(lowerQuery)
    const contentMatch = doc.lowerContent.includes(lowerQuery)

    if (!titleMatch && !contentMatch) continue

    const snippet = contentMatch
      ? getSnippet(doc.plainContent, query)
      : doc.plainContent.slice(0, 140).trim() + '…'

    results.push({
      title: doc.title,
      href: doc.href,
      section: doc.section,
      snippet,
      matchInTitle: titleMatch,
      score: titleMatch ? 10 : 1,
    })
  }

  results.sort((a, b) => b.score - a.score)

  return NextResponse.json(
    results.slice(0, 8).map(({ score: _s, ...r }) => r) as SearchResult[]
  )
}
