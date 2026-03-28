import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { docSections } from '@/lib/docroutes'

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

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim() ?? ''

  if (query.length < 2) {
    return NextResponse.json([] as SearchResult[])
  }

  const lowerQuery = query.toLowerCase()
  const results: (SearchResult & { score: number })[] = []

  for (const section of docSections) {
    for (const item of section.items) {
      const slug = item.href.replace('/docs/', '').split('/')
      const filePath = path.join(contentDir, ...slug) + '.md'
      if (!fs.existsSync(filePath)) continue

      const raw = fs.readFileSync(filePath, 'utf-8')
      const { data: fm, content } = matter(raw)
      const title = (fm.title as string) || item.title

      const titleMatch = title.toLowerCase().includes(lowerQuery)
      const plainContent = stripMarkdown(content)
      const contentMatch = plainContent.toLowerCase().includes(lowerQuery)

      if (!titleMatch && !contentMatch) continue

      const snippet = contentMatch ? getSnippet(plainContent, query) : plainContent.slice(0, 140).trim() + '…'

      results.push({
        title,
        href: item.href,
        section: section.title,
        snippet,
        matchInTitle: titleMatch,
        score: titleMatch ? 10 : 1,
      })
    }
  }

  results.sort((a, b) => b.score - a.score)

  return NextResponse.json(
    results.slice(0, 8).map(({ score: _s, ...r }) => r) as SearchResult[]
  )
}
