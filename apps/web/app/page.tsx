import Nav from '@/components/Nav'
import Hero from '@/components/Hero'
import CodeSection from '@/components/CodeSection'
import LiveDemo from '@/components/LiveDemo'
import WebhookDemo from '@/components/WebhookDemo'
import HowItWorks from '@/components/HowItWorks'
import SDKEcosystem from '@/components/SDKEcosystem'
import Footer from '@/components/Footer'
import Link from 'next/link';

export default function Home() {
  return (
    <>
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-4 text-center">
        <Link href="/changelog" className="underline font-medium">Latest: v0.1.0 → what's new?</Link>
      </div>
      <Nav />
      <main>
        <Hero />
        <CodeSection />
        <LiveDemo />
        <WebhookDemo />
        <HowItWorks />
        <SDKEcosystem />
      </main>
      <Footer />
    </>
  )
}
