'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SearchDialog from './SearchDialog'
import AIPanel from './AIPanel'
import { docSections } from '@/lib/docroutes'

export default function DocNavbar() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => { setMobileOpen(false) }, [pathname])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <>
      <header className="fixed top-0 inset-x-0 z-50 h-16 backdrop-blur-md bg-[#080808]/95 border-b border-white/[0.08]">
        <div className="flex items-center h-full px-6 gap-6">

          {/* Left — matches sidebar width so search truly fills the center */}
          <div className="flex items-center gap-3 flex-shrink-0 w-72">
            <Link
              href="/"
              className="flex items-center gap-2.5 text-white hover:opacity-75 transition-opacity"
            >
              <OrbitalLogo />
              <span className="text-sm font-semibold tracking-tight">Orbital</span>
            </Link>
            <span className="text-white/20 text-base">/</span>
            <span className="text-sm text-white/45 font-medium">Docs</span>
          </div>

          {/* Center — flex-1, search fills entire space like docus */}
          <div className="flex-1">
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-3 w-full h-9 bg-white/[0.04] border border-white/[0.1] hover:border-white/25 hover:bg-white/[0.06] rounded-lg px-3.5 text-sm text-white/35 transition-all duration-150 group"
            >
              <SearchIcon />
              <span className="flex-1 text-left">Search documentation...</span>
              <kbd className="hidden sm:flex items-center gap-0.5 text-[11px] font-mono bg-white/[0.07] text-white/25 px-1.5 py-0.5 rounded border border-white/[0.08] group-hover:border-white/15">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Right — actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setAiOpen(!aiOpen)}
              title="AI Assistant"
              className={`hidden sm:flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-all duration-150 ${
                aiOpen
                  ? 'bg-accent text-bg shadow-[0_0_16px_rgba(232,255,71,0.25)]'
                  : 'bg-white/[0.05] border border-white/[0.1] text-white/55 hover:bg-white/[0.09] hover:text-white/80'
              }`}
            >
              <SparklesIcon active={aiOpen} />
              AI
            </button>

            <button
              title="Language"
              className="hidden sm:flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-white/[0.05] border border-white/[0.1] text-xs font-semibold text-white/45 hover:bg-white/[0.09] hover:text-white/70 transition-colors"
            >
              <GlobeIcon />
              EN
            </button>

            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              title="GitHub"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white/45 hover:bg-white/[0.09] hover:text-white/70 transition-colors"
            >
              <GitHubIcon />
            </a>

            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white/45 hover:bg-white/[0.09] transition-colors"
            >
              {mobileOpen ? <XIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <nav
            className="absolute top-16 left-0 bottom-0 w-80 bg-[#0c0c0c] border-r border-white/[0.08] overflow-y-auto py-6"
            onClick={(e) => e.stopPropagation()}
          >
            {docSections.map((section) => (
              <div key={section.title} className="mb-6">
                <p className="px-5 mb-2 text-[11px] font-semibold uppercase tracking-widest text-white/25">
                  {section.title}
                </p>
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block px-5 py-2.5 text-sm transition-colors ${
                      pathname === item.href ? 'text-accent font-medium' : 'text-white/55 hover:text-white'
                    }`}
                  >
                    {item.title}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </div>
      )}

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} />
    </>
  )
}

function OrbitalLogo() {
  return (
    <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="2.5" fill="#080808" />
        <circle cx="8" cy="2.5" r="1.5" fill="#080808" />
        <circle cx="13.5" cy="11" r="1.5" fill="#080808" />
        <circle cx="2.5" cy="11" r="1.5" fill="#080808" />
      </svg>
    </div>
  )
}
function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  )
}
function SparklesIcon({ active }: { active: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={active ? '#080808' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  )
}
function GlobeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />
    </svg>
  )
}
function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  )
}
function MenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}
function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
