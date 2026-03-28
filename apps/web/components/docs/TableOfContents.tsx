'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

type Heading = { id: string; text: string; level: number }

export default function TableOfContents() {
  const pathname = usePathname()
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [indicatorTop, setIndicatorTop] = useState(0)
  const [indicatorHeight, setIndicatorHeight] = useState(28)
  const navRef = useRef<HTMLElement>(null)

  // Re-collect headings whenever the route changes
  useEffect(() => {
    const timer = setTimeout(() => {
      const els = document.querySelectorAll(
        'article.doc-content h2, article.doc-content h3, article.doc-content h4'
      )
      const found = Array.from(els).map((el) => ({
        id: el.id,
        text: el.textContent?.trim() || '',
        level: parseInt(el.tagName[1]),
      }))
      setHeadings(found)
      setActiveId(found[0]?.id || '')
    }, 60)
    return () => clearTimeout(timer)
  }, [pathname])

  // IntersectionObserver — highlight topmost visible heading
  useEffect(() => {
    if (headings.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-64px 0px -55% 0px', threshold: 0 }
    )

    headings.forEach((h) => {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [headings])

  // Move the accent indicator bar to the active link
  useEffect(() => {
    if (!navRef.current || !activeId) return
    const el = navRef.current.querySelector(`[data-hid="${activeId}"]`) as HTMLElement | null
    if (el) {
      setIndicatorTop(el.offsetTop)
      setIndicatorHeight(el.offsetHeight)
    }
  }, [activeId])

  if (headings.length === 0) return null

  return (
    <div className="py-10 px-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/25 mb-5">
        On this page
      </p>

      <div className="relative">
        {/* Moving accent bar */}
        <div
          className="absolute left-0 w-0.5 bg-accent rounded-full transition-all duration-200 ease-out"
          style={{ top: indicatorTop, height: indicatorHeight }}
        />

        <nav
          ref={navRef}
          className="pl-4 border-l border-white/[0.08]"
          aria-label="Table of contents"
        >
          {headings.map((h) => {
            const active = h.id === activeId
            return (
              <a
                key={h.id}
                data-hid={h.id}
                href={`#${h.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  const el = document.getElementById(h.id)
                  if (el) {
                    const top = el.getBoundingClientRect().top + window.scrollY - 80
                    window.scrollTo({ top, behavior: 'smooth' })
                  }
                }}
                className={`flex items-start py-1.5 text-sm leading-snug transition-colors duration-100 ${
                  h.level === 3 ? 'pl-3' : h.level === 4 ? 'pl-6' : ''
                } ${
                  active
                    ? 'text-accent font-medium'
                    : 'text-white/35 hover:text-white/75'
                }`}
              >
                {h.text}
              </a>
            )
          })}
        </nav>
      </div>

      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="mt-8 flex items-center gap-1.5 text-xs text-white/25 hover:text-white/55 transition-colors"
      >
        <ArrowUpIcon />
        Back to top
      </button>
    </div>
  )
}

function ArrowUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}
