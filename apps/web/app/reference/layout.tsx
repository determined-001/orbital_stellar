import DocNavbar from '@/components/docs/DocNavbar'
import DocSidebar from '@/components/docs/DocSidebar'
import TableOfContents from '@/components/docs/TableOfContents'
import { referenceSections } from '@/lib/docroutes'

export default function ReferenceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-text">
      <DocNavbar sections={referenceSections} />

      <div className="flex pt-16">
        <aside className="sticky top-16 h-[calc(100vh-64px)] w-72 flex-shrink-0 overflow-y-auto border-r border-white/[0.07] hidden lg:block">
          <DocSidebar sections={referenceSections} />
        </aside>

        <main className="flex-1 min-w-0">{children}</main>

        <aside className="sticky top-16 h-[calc(100vh-64px)] w-64 flex-shrink-0 overflow-y-auto border-l border-white/[0.07] hidden xl:block">
          <TableOfContents />
        </aside>
      </div>
    </div>
  )
}
