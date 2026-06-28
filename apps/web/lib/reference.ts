import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { Marked, type RendererObject } from 'marked'
import sanitizeHtml from 'sanitize-html'

const referenceDir = path.join(process.cwd(), 'content', 'reference')

export type ReferencePage = {
  title: string
  content: string
}

function resolveInternalLink(href: string, fileDir: string): string {
  if (/^([a-z]+:)?\/\//i.test(href) || href.startsWith('#') || href.startsWith('/')) return href

  const [linkPath, anchor] = href.split('#')
  if (!linkPath || !linkPath.endsWith('.md')) return href

  let resolved = path.posix.normalize(path.posix.join(fileDir, linkPath)).replace(/\.md$/, '')
  resolved = resolved.replace(/\/README$/i, '')
  if (resolved === '' || resolved === '/README') resolved = ''

  return `/reference${resolved}${anchor ? '#' + anchor : ''}`
}

// Rewrites typedoc's relative ../foo.md links to /reference/* routes. Security (raw HTML,
// link/image schemes) is handled below by sanitize-html, not here.
function createLinkRenderer(fileDir: string): RendererObject {
  return {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      const resolved = resolveInternalLink(href, fileDir)
      const titleAttr = title ? ` title="${title}"` : ''
      return `<a href="${resolved}"${titleAttr}>${text}</a>`
    },
  }
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'title', 'id'],
    img: ['src', 'alt', 'title'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
}

export async function getReferencePage(slug: string[]): Promise<ReferencePage | null> {
  const base = path.join(referenceDir, ...slug)
  const filePath = fs.existsSync(base + '.md') ? base + '.md' : path.join(base, 'README.md')
  if (!fs.existsSync(filePath)) return null

  const raw = fs.readFileSync(filePath, 'utf-8')
  const { content } = matter(raw)

  const relFile = path.relative(referenceDir, filePath).split(path.sep).join('/')
  const fileDir = '/' + path.posix.dirname(relFile)

  const marked = new Marked({ renderer: createLinkRenderer(fileDir) })
  const rawHtml = marked.parse(content, { gfm: true, async: false }) as string
  const html = sanitizeHtml(rawHtml, SANITIZE_OPTIONS)

  const titleMatch = content.match(/^#\s+(.+)$/m)
  return {
    title: titleMatch ? titleMatch[1].trim() : slug[slug.length - 1] || 'Reference',
    content: html,
  }
}

export function getReferencePackages(): string[] {
  if (!fs.existsSync(referenceDir)) return []
  return fs
    .readdirSync(referenceDir)
    .filter((entry) => fs.statSync(path.join(referenceDir, entry)).isDirectory())
    .sort()
}

/** Walks the generated reference tree, returning a slug array per page (README.md files become their directory's slug). */
export function getAllReferenceSlugs(): string[][] {
  if (!fs.existsSync(referenceDir)) return []
  const slugs: string[][] = []

  function walk(dir: string, slug: string[]) {
    for (const entry of fs.readdirSync(dir)) {
      const entryPath = path.join(dir, entry)
      if (fs.statSync(entryPath).isDirectory()) {
        walk(entryPath, [...slug, entry])
      } else if (entry.endsWith('.md')) {
        const name = entry.replace(/\.md$/, '')
        slugs.push(name === 'README' ? slug : [...slug, name])
      }
    }
  }

  walk(referenceDir, [])
  return slugs
}
