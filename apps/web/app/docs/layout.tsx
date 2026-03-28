import DocNavbar from '@/components/docs/DocNavbar'
import DocSidebar from '@/components/docs/DocSidebar'
import TableOfContents from '@/components/docs/TableOfContents'
import { docSections } from '@/lib/docroutes'

// Sidebar widths are intentionally kept in sync with DocNavbar's left-section width (w-72)
// so the search bar aligns perfectly with the main content area.

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-text">
      <DocNavbar />

      <div className="flex pt-16">

        {/* Left sidebar — w-72 matches navbar left section */}
        <aside className="sticky top-16 h-[calc(100vh-64px)] w-72 flex-shrink-0 overflow-y-auto border-r border-white/[0.07] hidden lg:block">
          <DocSidebar sections={docSections} />
        </aside>

        {/* Main content — flex-1, no artificial width cap */}
        <main className="flex-1 min-w-0">
          {children}
        </main>

        {/* Right TOC — wider for comfortable reading */}
        <aside className="sticky top-16 h-[calc(100vh-64px)] w-64 flex-shrink-0 overflow-y-auto border-l border-white/[0.07] hidden xl:block">
          <TableOfContents />
        </aside>

      </div>
    </div>
  )
}
