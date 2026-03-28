'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type DocSection } from '@/lib/docroutes'

type Props = {
  sections: DocSection[]
}

export default function DocSidebar({ sections }: Props) {
  const pathname = usePathname()

  const activeSection = sections.findIndex((s) =>
    s.items.some((item) => pathname === item.href || pathname.startsWith(item.href + '/'))
  )

  const [openSections, setOpenSections] = useState<boolean[]>(
    sections.map((_, i) => i === activeSection || activeSection === -1)
  )

  useEffect(() => {
    const idx = sections.findIndex((s) =>
      s.items.some((item) => pathname === item.href || pathname.startsWith(item.href + '/'))
    )
    if (idx >= 0) {
      setOpenSections((prev) => prev.map((open, i) => (i === idx ? true : open)))
    }
  }, [pathname, sections])

  const toggle = (i: number) => {
    setOpenSections((prev) => prev.map((open, j) => (j === i ? !open : open)))
  }

  return (
    <nav className="py-8 px-5" aria-label="Docs navigation">
      {sections.map((section, i) => {
        const isOpen = openSections[i]
        return (
          <div key={section.title} className="mb-2">
            {/* Section toggle */}
            <button
              onClick={() => toggle(i)}
              className="flex items-center justify-between w-full px-2 py-2.5 rounded-md text-[11px] font-semibold uppercase tracking-[0.1em] text-white/30 hover:text-white/55 transition-colors"
            >
              <span>{section.title}</span>
              <ChevronIcon open={isOpen} />
            </button>

            {/* Collapsible items */}
            <div
              className={`overflow-hidden transition-all duration-200 ease-in-out ${
                isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              <ul className="mt-1 mb-2 space-y-0.5">
                {section.items.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(item.href + '/')
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all duration-100 ${
                          active
                            ? 'bg-accent/[0.08] text-accent font-medium border-l-2 border-accent/60 rounded-l-none pl-[10px]'
                            : 'text-white/45 hover:text-white/85 hover:bg-white/[0.04]'
                        }`}
                      >
                        {item.title}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )
      })}
    </nav>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 flex-shrink-0 ${open ? 'rotate-180' : 'rotate-0'}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
