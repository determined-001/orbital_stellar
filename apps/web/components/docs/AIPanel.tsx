'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { SearchResult } from '@/app/api/docs/search/route'

/**
 * Docs search sidebar.
 *
 * This was an "AI Assistant" that greeted visitors with "Ask me anything about
 * the SDK, webhooks, or real-time events", waited a hardcoded 1200ms to
 * simulate thinking, and returned a canned template string. There was no model
 * behind it and no "coming soon" label, so a developer evaluating the SDK asked
 * a real question and got a confident non-answer.
 *
 * It now answers from the docs corpus over `GET /api/docs/search`, the same
 * endpoint `SearchDialog` uses. Every line it shows is a real section with a
 * real link. When nothing matches it says so rather than inventing prose.
 */

const SUGGESTED = [
  'register a webhook',
  'verify webhook signatures',
  'real-time events',
  'cursor persistence',
]

type Props = {
  open: boolean
  onClose: () => void
}

export default function AIPanel({ open, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [open])

  const runSearch = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearched(false)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/docs/search?q=${encodeURIComponent(trimmed)}`)
      setResults(res.ok ? ((await res.json()) as SearchResult[]) : [])
    } catch {
      setResults([])
    } finally {
      setLoading(false)
      setSearched(true)
    }
  }, [])

  // Debounced, matching SearchDialog - one request per pause, not per keystroke.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void runSearch(query), 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, runSearch])

  return (
    <>
      {/* Overlay backdrop (only on mobile) */}
      {open && (
        <div
          className="fixed inset-0 z-[55] xl:hidden bg-black/40"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <aside
        className={`fixed top-[60px] right-0 bottom-0 z-[55] w-80 bg-[#0d0d0d] border-l border-white/[0.08] flex flex-col transition-transform duration-250 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.08] flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-accent/20 flex items-center justify-center">
              <SearchIcon />
            </div>
            <span className="text-sm font-semibold text-white">Search the docs</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
          >
            <XIcon />
          </button>
        </div>

        {/* Input */}
        <div className="flex-shrink-0 px-3 py-3 border-b border-white/[0.08]">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void runSearch(query)
            }}
            className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-white/20 transition-colors"
          >
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search guides and API reference..."
              className="flex-1 bg-transparent text-sm text-white placeholder-white/25 outline-none"
            />
          </form>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
          {query.trim().length < 2 ? (
            <>
              <p className="text-xs text-white/25 px-1 mb-2">Try searching for</p>
              {SUGGESTED.map((q) => (
                <button
                  key={q}
                  onClick={() => setQuery(q)}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg border border-white/[0.08] text-white/50 hover:text-white/80 hover:border-white/20 hover:bg-white/[0.04] transition-all duration-100"
                >
                  {q}
                </button>
              ))}
            </>
          ) : loading ? (
            <p className="text-xs text-white/30 px-1">Searching…</p>
          ) : results.length === 0 ? (
            searched && (
              <p className="text-xs text-white/40 px-1 leading-relaxed">
                No docs match “{query.trim()}”. Try a different term, or{' '}
                <Link href="/reference" className="text-accent hover:underline">
                  browse the API reference
                </Link>
                .
              </p>
            )
          ) : (
            results.map((result) => (
              <Link
                key={result.href}
                href={result.href}
                onClick={onClose}
                className="block px-3 py-2.5 rounded-lg border border-white/[0.06] hover:border-white/20 hover:bg-white/[0.04] transition-all duration-100"
              >
                <p className="text-[10px] uppercase tracking-wider text-white/25 mb-0.5">
                  {result.section}
                </p>
                <p className="text-sm text-white/85 font-medium">{result.title}</p>
                {result.snippet && (
                  <p className="text-xs text-white/40 mt-1 leading-relaxed line-clamp-3">
                    {result.snippet}
                  </p>
                )}
              </Link>
            ))
          )}
        </div>

        <div className="flex-shrink-0 px-3 py-2 border-t border-white/[0.08]">
          <p className="text-[10px] text-white/15 text-center">
            Results come from this site&apos;s documentation.
          </p>
        </div>
      </aside>
    </>
  )
}

function SearchIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
