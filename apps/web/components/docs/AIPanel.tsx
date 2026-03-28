'use client'

import { useState, useRef, useEffect } from 'react'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTED = [
  'How do I register a webhook?',
  'What events does pulse-core emit?',
  'How to verify webhook signatures?',
  'Getting started with pulse-notify',
]

type Props = {
  open: boolean
  onClose: () => void
}

export default function AIPanel({ open, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  const sendMessage = async (text: string) => {
    if (!text.trim() || thinking) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text }
    setMessages((m) => [...m, userMsg])
    setInput('')
    setThinking(true)

    // Placeholder: replace with real AI API call
    await new Promise((r) => setTimeout(r, 1200))
    const reply: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: `I can help with that! Check out the relevant documentation section for more details. If you have a specific question about **${text.toLowerCase()}**, feel free to ask and I'll point you to the right place.`,
    }
    setMessages((m) => [...m, reply])
    setThinking(false)
  }

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
              <SparklesIcon />
            </div>
            <span className="text-sm font-semibold text-white">AI Assistant</span>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="text-xs text-white/30 hover:text-white/60 transition-colors"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
            >
              <XIcon />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <SparklesIcon />
                </div>
                <div className="bg-white/[0.05] rounded-xl rounded-tl-sm px-3 py-2.5 text-sm text-white/80 leading-relaxed">
                  Hi! I&apos;m your Orbital Stellar docs assistant. Ask me anything about the SDK, webhooks, or real-time events.
                </div>
              </div>

              {/* Suggested questions */}
              <div className="space-y-1.5 pt-1">
                <p className="text-xs text-white/25 mb-2">Suggested questions</p>
                {SUGGESTED.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg border border-white/[0.08] text-white/50 hover:text-white/80 hover:border-white/20 hover:bg-white/[0.04] transition-all duration-100"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`flex items-start gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-semibold ${
                  msg.role === 'user'
                    ? 'bg-accent/20 text-accent'
                    : 'bg-white/10 text-white/50'
                }`}>
                  {msg.role === 'user' ? 'U' : <SparklesIcon />}
                </div>
                <div className={`max-w-[220px] rounded-xl px-3 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-accent/10 text-accent rounded-tr-sm'
                    : 'bg-white/[0.05] text-white/80 rounded-tl-sm'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))
          )}

          {/* Thinking indicator */}
          {thinking && (
            <div className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <SparklesIcon />
              </div>
              <div className="bg-white/[0.05] rounded-xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 px-3 py-3 border-t border-white/[0.08]">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              sendMessage(input)
            }}
            className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-white/20 transition-colors"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              disabled={thinking}
              className="flex-1 bg-transparent text-sm text-white placeholder-white/25 outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || thinking}
              className="flex-shrink-0 w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-bg transition-opacity disabled:opacity-30"
            >
              <SendIcon />
            </button>
          </form>
          <p className="text-[10px] text-white/15 text-center mt-2">
            AI can make mistakes. Verify important info.
          </p>
        </div>
      </aside>
    </>
  )
}

function SparklesIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
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

function SendIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13" /><path d="M22 2L15 22l-4-9-9-4 20-7z" />
    </svg>
  )
}
