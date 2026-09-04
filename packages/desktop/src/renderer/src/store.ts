import { create } from "zustand"
import * as api from "./api"
import type { AgentEvent } from "./api"

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
}

export type ToolState = {
  id: string
  name: string
  status: "running" | "done"
  result?: string
}

type AppState = {
  messages: ChatMessage[]
  draft: string
  tools: ToolState[]
  running: boolean
  models: string[]
  currentModel: string
  sessions: { id: string; title: string }[]
  connected: boolean
  configured: boolean

  init: () => void
  send: (text: string) => void
  switchSession: (id: string) => void
  deleteSession: (id: string) => void
  selectModel: (spec: string) => void
  saveConfig: (patch: { name?: string; baseUrl?: string; apiKey?: string; model?: string }) => Promise<void>
  handleEvent: (e: AgentEvent) => void
}

let eventUnsub: (() => void) | null = null

export const useApp = create<AppState>((set, get) => ({
  messages: [],
  draft: "",
  tools: [],
  running: false,
  models: [],
  currentModel: "",
  sessions: [],
  connected: false,
  configured: true,

  init: () => {
    if (eventUnsub) eventUnsub()
    eventUnsub = api.openEventStream((e) => get().handleEvent(e))

    void api.apiHealth().then((ok) => set({ connected: ok }))
    void api.apiConfig().then((c) => {
      set({ configured: c.configured, currentModel: c.model })
      // 配置好后拉一次模型列表
      void api.apiModels().then((models) => set({ models }))
    })
    void api.apiSessions().then((sessions) => set({ sessions }))
    void api.apiSessionMessages().then(({ messages }) => {
      if (messages?.length) {
        set({
          messages: messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m, i) => ({ id: String(i), role: m.role as "user" | "assistant", content: m.content })),
        })
      }
    })
  },

  send: (text) => {
    set((s) => ({
      messages: [...s.messages, { id: crypto.randomUUID(), role: "user", content: text }],
      draft: "",
      tools: [],
      running: true,
    }))
    api.apiSend(text)
  },

  switchSession: (id) => {
    set({ messages: [], draft: "", tools: [], running: false })
    api.apiSwitchSession(id)
    void api.apiSessions().then((sessions) => set({ sessions }))
  },

  deleteSession: (id) => {
    api.apiDeleteSession(id)
    void api.apiSessions().then((sessions) => set({ sessions }))
  },

  selectModel: (spec) => {
    set({ currentModel: spec })
    // model switch is a UI-only concern for now; the core reads config.json
  },

  saveConfig: async (patch) => {
    await api.apiSaveConfig(patch)
    // 配置保存后刷新状态
    const c = await api.apiConfig()
    set({ configured: c.configured, currentModel: c.model })
    void api.apiModels().then((models) => set({ models }))
  },

  handleEvent: (e) => {
    switch (e.type) {
      case "message_delta":
        set((s) => ({ draft: s.draft + e.text }))
        break
      case "message_end": {
        const content = e.message?.content ?? ""
        if (content) {
          set((s) => ({
            messages: [...s.messages, { id: crypto.randomUUID(), role: "assistant", content }],
            draft: "",
          }))
        }
        break
      }
      case "tool_start":
        set((s) => ({
          tools: [
            ...s.tools,
            { id: e.toolCall.id, name: e.toolCall.name, status: "running" },
          ],
        }))
        break
      case "tool_delta":
        set((s) => ({
          tools: s.tools.map((t) => (t.id === e.toolCallId ? { ...t, result: (t.result ?? "") + e.text } : t)),
        }))
        break
      case "tool_end":
        set((s) => ({
          tools: s.tools.map((t) =>
            t.id === e.toolCall.id ? { ...t, status: "done", result: e.result?.content?.slice(0, 400) } : t,
          ),
        }))
        break
      case "agent_end":
        set({ draft: "", tools: [], running: false })
        break
      case "error":
        set({ running: false })
        break
    }
  },
}))
