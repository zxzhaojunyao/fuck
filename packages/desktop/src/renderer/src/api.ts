// Client for the FUCK serve backend (localhost HTTP + WebSocket).
// The base URL + token are injected at runtime (query param / env), so the same
// renderer works in the browser (dev) and inside Electron (prod, file://).

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "message_start" }
  | { type: "message_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "message_end"; message: { content: string; toolCalls?: { id: string; name: string; arguments: unknown }[] } }
  | { type: "tool_start"; toolCall: { id: string; name: string; arguments: unknown } }
  | { type: "tool_delta"; toolCallId: string; text: string }
  | { type: "tool_end"; toolCall: { id: string; name: string }; result: { content: string; isError: boolean } }
  | { type: "turn_end" }
  | { type: "agent_end" }
  | { type: "error"; error: { message: string } }

export type SessionMeta = {
  id: string
  title: string
  updatedAt: number
}

function resolveEndpoint(): { url: string; token: string } {
  const params = new URLSearchParams(window.location.search)
  const token = params.get("token") ?? ""
  const url = params.get("url") ?? "http://127.0.0.1:0"
  return { url, token }
}

const { url: baseUrl, token } = resolveEndpoint()

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
}

export async function apiHealth(): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl}/health`)
    return r.ok
  } catch {
    return false
  }
}

export async function apiModels(): Promise<string[]> {
  const r = await request("/models")
  return r.ok ? r.json() : []
}

export async function apiSessions(): Promise<SessionMeta[]> {
  const r = await request("/sessions")
  return r.ok ? r.json() : []
}

export async function apiSessionMessages(): Promise<{ id: string; messages: { role: string; content: string }[] }> {
  const r = await request("/session")
  return r.ok ? r.json() : { id: "", messages: [] }
}

export type ServerConfig = {
  provider: Record<string, { baseUrl?: string; apiKey?: string; api?: string }>
  model: string
  configured: boolean
}

export async function apiConfig(): Promise<ServerConfig> {
  const r = await request("/config")
  return r.ok ? r.json() : { provider: {}, model: "", configured: false }
}

export async function apiSaveConfig(patch: { name?: string; baseUrl?: string; apiKey?: string; model?: string }) {
  return request("/config", { method: "POST", body: JSON.stringify(patch) })
}

export function apiSend(text: string) {
  void request("/send", { method: "POST", body: JSON.stringify({ text }) })
}

export function apiSwitchSession(id: string) {
  void request("/session/switch", { method: "POST", body: JSON.stringify({ id }) })
}

export function apiDeleteSession(id: string) {
  void request("/sessions/delete", { method: "POST", body: JSON.stringify({ id }) })
}

export function openEventStream(onEvent: (e: AgentEvent) => void): () => void {
  const ws = new WebSocket(`ws://${baseUrl.replace(/^https?:\/\//, "")}/events?token=${encodeURIComponent(token)}`)
  ws.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data as string) as AgentEvent)
    } catch {}
  }
  return () => ws.close()
}
