import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { Marked, type RendererObject } from 'marked'

const referenceDir = path.join(process.cwd(), 'content', 'reference')

export type ReferencePage = {
  title: string
  content: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// http(s)/mailto only — blocks javascript:, data:, vbscript:, etc. Relative/anchor URLs
// (no scheme) are also allowed.
function isSafeUrl(url: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) || /^(https?|mailto):/i.test(url)
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

/**
 * typedoc-generated markdown is build-time content, not user input, but we still render it
 * through a locked-down renderer rather than marked's defaults, as defense in depth: raw HTML
 * is escaped instead of passed through, and link/image URLs are scheme-checked, so a stray
 * HTML snippet or odd URL in a TSDoc comment can't end up as live markup on the page. Manually
 * verified against <script>, onerror=, and javascript: payloads.
 *
 * Must be a plain object, not a class extending Renderer — marked's `Marked.use()` merges
 * overrides via `for...in`, which only sees own enumerable properties; class methods on a
 * prototype are non-enumerable and get silently ignored.
 */
function createSafeRenderer(fileDir: string): RendererObject {
  return {
    html(token) {
      return escapeHtml(token.text)
    },

    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      if (!isSafeUrl(href)) return text
      const resolved = resolveInternalLink(href, fileDir)
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
      return `<a href="${escapeHtml(resolved)}"${titleAttr}>${text}</a>`
    },

    image({ href, title, text }) {
      if (!isSafeUrl(href)) return escapeHtml(text)
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttr}>`
    },
  }
}

export async function getReferencePage(slug: string[]): Promise<ReferencePage | null> {
  const base = path.join(referenceDir, ...slug)
  const filePath = fs.existsSync(base + '.md') ? base + '.md' : path.join(base, 'README.md')
  if (!fs.existsSync(filePath)) return null

  const raw = fs.readFileSync(filePath, 'utf-8')
  const { content } = matter(raw)

  const relFile = path.relative(referenceDir, filePath).split(path.sep).join('/')
  const fileDir = '/' + path.posix.dirname(relFile)

  const marked = new Marked({ renderer: createSafeRenderer(fileDir) })
  const html = marked.parse(content, { gfm: true, async: false }) as string

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
