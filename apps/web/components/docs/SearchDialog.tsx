'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { SearchResult } from '@/app/api/docs/search/route'
import { allDocPages } from '@/lib/docroutes'

type Props = {
  open: boolean
  onClose: () => void
}

/** Wrap every occurrence of `query` in the text with a highlight span. */
function highlight(text: string, query: string): React.ReactNode[] {
  if (!query.trim()) return [text]
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-accent/25 text-accent rounded-sm px-0.5 not-italic">{part}</mark>
      : part
  )
}

export default function SearchDialog({ open, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Show all pages when query is empty
  const defaultResults: SearchResult[] = allDocPages.map((p) => ({
    title: p.title,
    href: p.href,
    section: p.href.replace('/docs/', '').split('/')[0]
      .split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
    snippet: '',
    matchInTitle: false,
  }))

  const displayResults = query.trim().length < 2 ? defaultResults : results

  const navigate = useCallback((href: string) => {
    router.push(href)
    onClose()
  }, [router, onClose])

  // Focus + reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 15)
    }
  }, [open])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) { setResults([]); return }

    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/docs/search?q=${encodeURIComponent(query)}`)
        const data: SearchResult[] = await res.json()
        setResults(data)
        setSelected(0)
      } finally {
        setLoading(false)
      }
    }, 200)
  }, [query])

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, displayResults.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
      if (e.key === 'Enter' && displayResults[selected]) navigate(displayResults[selected].href)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, displayResults, selected, navigate, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-2xl bg-[#0e0e0e] border border-white/[0.14] rounded-2xl shadow-[0_32px_80px_rgba(0,0,0,0.8)] overflow-hidden">

        {/* Input row */}
        <div className="flex items-center gap-3 px-5 h-14 border-b border-white/[0.08]">
          <SearchIcon className="text-white/35 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search docs..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0) }}
            className="flex-1 bg-transparent text-base text-white placeholder-white/25 outline-none"
          />
          {loading && <SpinnerIcon />}
          {query && !loading && (
            <button onClick={() => setQuery('')} className="text-white/30 hover:text-white/60 transition-colors">
              <XIcon />
            </button>
          )}
          <kbd className="hidden sm:block text-[11px] font-mono bg-white/[0.06] text-white/25 px-1.5 py-1 rounded border border-white/[0.08]">
            esc
          </kbd>
        </div>

        {/* Results list */}
        <div className="max-h-[460px] overflow-y-auto">
          {displayResults.length === 0 && query.trim().length >= 2 && !loading ? (
            <div className="px-5 py-12 text-center">
              <p className="text-white/30 text-sm">No results for <span className="text-white/50">&ldquo;{query}&rdquo;</span></p>
              <p className="text-white/20 text-xs mt-1">Try different keywords</p>
            </div>
          ) : (
            <>
              {query.trim().length < 2 && (
                <p className="px-5 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-widest text-white/25">
                  All pages
                </p>
              )}
              <ul className="py-2">
                {displayResults.map((result, i) => {
                  const isSelected = i === selected
                  return (
                    <li key={result.href}>
                      <button
                        onClick={() => navigate(result.href)}
                        onMouseEnter={() => setSelected(i)}
                        className={`flex items-start gap-4 w-full px-5 py-3.5 text-left transition-colors ${
                          isSelected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        {/* Icon */}
                        <div className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                          isSelected ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-white/30'
                        }`}>
                          <DocIcon />
                        </div>

                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-sm font-medium truncate ${isSelected ? 'text-white' : 'text-white/80'}`}>
                              {highlight(result.title, query)}
                            </span>
                            <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/[0.06] text-white/35 border border-white/[0.08]">
                              {result.section}
                            </span>
                          </div>
                          {result.snippet && (
                            <p className="text-xs text-white/35 leading-relaxed line-clamp-2">
                              {highlight(result.snippet, query)}
                            </p>
                          )}
                          <p className="text-[11px] text-white/20 mt-1">
                            {result.href.replace('/docs/', '').replace(/\//g, ' › ')}
                          </p>
                        </div>

                        {/* Enter hint */}
                        {isSelected && (
                          <div className="flex-shrink-0 mt-1">
                            <EnterIcon />
                          </div>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center gap-3 text-[11px] text-white/20">
            <span className="flex items-center gap-1">
              <Kbd>↑↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> open
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> close
            </span>
          </div>
          <span className="text-[11px] text-white/15">
            {displayResults.length} result{displayResults.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-white/[0.07] border border-white/[0.1] text-white/30 px-1 py-0.5 rounded text-[10px] font-mono">
      {children}
    </kbd>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  )
}
function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
function DocIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  )
}
function EnterIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30">
      <polyline points="9 10 4 15 9 20" /><path d="M20 4v7a4 4 0 0 1-4 4H4" />
    </svg>
  )
}
function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="animate-spin text-white/30">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
