import { useEffect, useRef, useState } from "react"
import { useApp } from "./store"
import { ConfigPanel } from "./ConfigPanel"
import Markdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"

function ToolCard({ name, status, result }: { name: string; status: string; result?: string }) {
  return (
    <div className={`mb-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm ${status === "running" ? "tool-running" : ""}`}>
      <div className="flex items-center gap-2 font-mono text-zinc-300">
        <span className={status === "running" ? "animate-spin text-amber-400" : "text-emerald-400"}>
          {status === "running" ? "◌" : "✓"}
        </span>
        <span className="font-semibold">{name}</span>
      </div>
      {result && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-zinc-500">{result}</pre>
      )}
    </div>
  )
}

function SessionSidebar() {
  const sessions = useApp((s) => s.sessions)
  const currentModel = useApp((s) => s.currentModel)
  const models = useApp((s) => s.models)
  const switchSession = useApp((s) => s.switchSession)
  const deleteSession = useApp((s) => s.deleteSession)
  const selectModel = useApp((s) => s.selectModel)

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="border-b border-zinc-800 p-3">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Model</div>
        <select
          value={currentModel}
          onChange={(e) => selectModel(e.target.value)}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 outline-none transition focus:border-cyan-500"
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Sessions</div>
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        {sessions.length === 0 && <div className="px-2 py-3 text-sm text-zinc-600">No sessions yet</div>}
        {sessions.map((s) => (
          <div
            key={s.id}
            className="group flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-sm text-zinc-300 transition hover:bg-zinc-900"
            onClick={() => switchSession(s.id)}
          >
            <span className="truncate">{s.title || "(empty)"}</span>
            <button
              className="hidden text-zinc-600 hover:text-red-400 group-hover:block"
              onClick={(e) => {
                e.stopPropagation()
                deleteSession(s.id)
              }}
              title="Delete session"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}

export default function App() {
  const messages = useApp((s) => s.messages)
  const draft = useApp((s) => s.draft)
  const tools = useApp((s) => s.tools)
  const running = useApp((s) => s.running)
  const connected = useApp((s) => s.connected)
  const configured = useApp((s) => s.configured)
  const send = useApp((s) => s.send)
  const init = useApp((s) => s.init)

  const [input, setInput] = useState("")
  const [showConfig, setShowConfig] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, draft, tools])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || running) return
    setInput("")
    send(text)
  }

  // 未配置 → 全屏 onboarding
  if (!configured) {
    return <ConfigPanel onDone={() => setShowConfig(false)} />
  }

  // 配置面板打开 → 全屏设置
  if (showConfig) {
    return <ConfigPanel onDone={() => setShowConfig(false)} />
  }

  return (
    <div className="flex h-screen">
      <SessionSidebar />

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
          <span className="gradient-text text-lg font-black tracking-widest">FUCK</span>
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} title={connected ? "connected" : "disconnected"} />
          {running && (
            <span className="thinking-dots text-zinc-400">
              <span>·</span>
              <span>·</span>
              <span>·</span>
            </span>
          )}
          <div className="ml-auto">
            <button
              onClick={() => setShowConfig(true)}
              className="rounded-md px-2 py-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
              title="Settings"
            >
              ⚙
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 && !running && (
            <div className="flex h-full items-center justify-center text-zinc-600">
              <div className="text-center">
                <div className="gradient-text mb-3 font-mono text-4xl font-black tracking-widest">FUCK</div>
                <div className="text-sm">Type a message to start.</div>
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className="msg-in mb-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {m.role === "user" ? "You" : "FUCK"}
              </div>
              {m.role === "user" ? (
                <div className="whitespace-pre-wrap text-zinc-200">{m.content}</div>
              ) : (
                <div className="prose prose-invert max-w-none prose-pre:bg-zinc-900">
                  <Markdown rehypePlugins={[rehypeHighlight]}>{m.content}</Markdown>
                </div>
              )}
            </div>
          ))}

          {tools.map((t) => (
            <ToolCard key={t.id} name={t.name} status={t.status} result={t.result} />
          ))}

          {draft && (
            <div className="mb-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">FUCK</div>
              <div className="prose prose-invert max-w-none prose-pre:bg-zinc-900">
                <Markdown rehypePlugins={[rehypeHighlight]}>{draft}</Markdown>
              </div>
            </div>
          )}

          {running && !draft && tools.length === 0 && (
            <div className="thinking-dots text-zinc-500">
              Thinking
              <span>·</span>
              <span>·</span>
              <span>·</span>
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="border-t border-zinc-800 bg-zinc-950/50 p-3">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  onSubmit(e as unknown as React.FormEvent)
                }
              }}
              placeholder="Message FUCK… (Enter to send, Shift+Enter for newline)"
              rows={2}
              className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={running || !input.trim()}
              className="rounded-lg bg-gradient-to-r from-cyan-600 to-violet-600 px-5 text-sm font-semibold text-white transition hover:from-cyan-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
