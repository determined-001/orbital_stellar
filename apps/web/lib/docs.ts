import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { Marked } from 'marked'
import { createSafeRenderer } from './markdownSafety'

const contentDir = path.join(process.cwd(), 'content')

function slugify(text: string): string {
  return text
    .replace(/<[^>]+>/g, '') // strip any HTML tags inside heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

export type DocPage = {
  title: string
  description?: string
  content: string
}

export async function getDocPage(slug: string[]): Promise<DocPage | null> {
  const filePath = path.join(contentDir, ...slug) + '.md'
  if (!fs.existsSync(filePath)) return null

  const raw = fs.readFileSync(filePath, 'utf-8')
  const { data: fm, content } = matter(raw)

  // Rendered through the same locked-down renderer as the reference section
  // (see lib/markdownSafety.ts). The default `marked` config passes raw HTML
  // straight through to the `dangerouslySetInnerHTML` in
  // app/docs/[[...slug]]/page.tsx, which would turn a contributor's docs PR
  // into stored XSS on this domain.
  const marked = new Marked({ renderer: createSafeRenderer() })
  const rawHtml = marked.parse(content, { gfm: true, async: false }) as string

  // Inject id attributes into h2–h4 for TOC anchor links
  const html = rawHtml.replace(
    /<h([2-4])>(.*?)<\/h[2-4]>/g,
    (_match: string, level: string, inner: string) => {
      const id = slugify(inner)
      return `<h${level} id="${id}">${inner}</h${level}>`
    }
  )

  return {
    title: (fm.title as string) || 'Untitled',
    description: fm.description as string | undefined,
    content: html,
  }
}
