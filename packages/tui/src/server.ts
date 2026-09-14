import { createRuntime } from "./runtime"
import { listSessions, deleteSession } from "@fuck/agent"
import type { AgentEvent, ExtensionUIContext } from "@fuck/agent"
import { listModels, readConfig, saveProvider, setModel } from "@fuck/config"

// Headless server mode: reuse the existing runtime, expose the agent over a
// local HTTP + WebSocket API with a one-time password. The agent logic stays
// in the Bun core, never in the renderer.

const noopUi: ExtensionUIContext = {
  select: async () => undefined,
  confirm: async () => false,
  input: async () => undefined,
  notify: () => {},
  setStatus: () => {},
  setWidget: () => {},
  editor: async () => undefined,
}

export type ServeOptions = {
  cwd: string
  port: number
  password: string
  /** 允许的 CORS 来源；默认 *（本地服务真正的安全门是一次性密码 token，不是 CORS） */
  allowOrigins?: string[]
}

type EventSink = (e: AgentEvent) => void

type Runtime = Awaited<ReturnType<typeof createRuntime>>

// A runtime wrapper that survives session switching: holds the current
// agent/store and a stable list of event sinks, resubscribing them whenever
// the runtime is recreated.
class ServerRuntime {
  private runtime: Runtime | null = null
  private sinks = new Set<EventSink>()

  constructor(private opts: ServeOptions) {}

  async init() {
    this.runtime = await createRuntime(this.opts.cwd, undefined, noopUi)
    this.bindEvents()
  }

  get agent() {
    if (!this.runtime) throw new Error("server runtime not initialized")
    return this.runtime.agent
  }
  get store() {
    if (!this.runtime) throw new Error("server runtime not initialized")
    return this.runtime.store
  }

  onEvent(sink: EventSink): () => void {
    this.sinks.add(sink)
    return () => this.sinks.delete(sink)
  }

  async switch(id: string) {
    this.runtime?.agent.abort()
    this.runtime = await createRuntime(this.opts.cwd, id, noopUi)
    this.bindEvents()
  }

  private bindEvents() {
    this.runtime?.agent.events.subscribe((e) => {
      for (const s of this.sinks) s(e)
    })
  }
}

export async function runServer(opts: ServeOptions) {
  const rt = new ServerRuntime(opts)
  await rt.init()

  const clients = new Set<{ send: (s: string) => void }>()
  rt.onEvent((e) => {
    const msg = JSON.stringify(e)
    for (const c of clients) c.send(msg)
  })

  const server = Bun.serve({
    port: opts.port,
    hostname: "127.0.0.1",
    websocket: {
      open(ws) {
        clients.add(ws)
      },
      close(ws) {
        clients.delete(ws)
      },
      message() {},
    },
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // CORS：允许配置的来源 + 无 Origin（curl / 同源 file://）
      const origin = req.headers.get("origin")
      const allow = opts.allowOrigins ?? ["*"]
      const corsHeaders: Record<string, string> = {}
      if (origin) {
        if (allow.includes("*") || allow.includes(origin)) {
          corsHeaders["Access-Control-Allow-Origin"] = origin
          corsHeaders["Access-Control-Allow-Headers"] = "content-type, authorization"
          corsHeaders["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        }
      } else {
        corsHeaders["Access-Control-Allow-Origin"] = "*"
      }
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders })
      }

      // 鉴权：HTTP 用 Bearer，WS 用 ?token=（浏览器 WebSocket 不能带自定义头）
      const authorized =
        path === "/health" ||
        req.headers.get("authorization") === `Bearer ${opts.password}` ||
        url.searchParams.get("token") === opts.password
      if (!authorized) {
        return new Response("unauthorized", { status: 401, headers: corsHeaders })
      }

      if (path === "/health") return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })

      if (path === "/events" && server.upgrade(req)) return undefined

      if (path === "/send" && req.method === "POST") {
        const body = (await req.json()) as { text?: string }
        if (body.text) void rt.agent.send(body.text).catch(() => {})
        return Response.json({ ok: true }, { headers: corsHeaders })
      }

      if (path === "/sessions" && req.method === "GET") {
        return Response.json(listSessions(), { headers: corsHeaders })
      }

      if (path === "/sessions/delete" && req.method === "POST") {
        const body = (await req.json()) as { id?: string }
        if (body.id) deleteSession(body.id)
        return Response.json({ ok: true }, { headers: corsHeaders })
      }

      if (path === "/session/switch" && req.method === "POST") {
        const body = (await req.json()) as { id?: string }
        if (body.id) await rt.switch(body.id)
        return Response.json({ ok: true }, { headers: corsHeaders })
      }

      if (path === "/session" && req.method === "GET") {
        return Response.json({ id: rt.store.id, messages: rt.store.load() }, { headers: corsHeaders })
      }

      if (path === "/models" && req.method === "GET") {
        return Response.json(await listModels(), { headers: corsHeaders })
      }

      if (path === "/config" && req.method === "GET") {
        const cfg = readConfig()
        // 脱敏：apiKey 不回传明文，只回传是否已配置
        const providers = cfg.provider as Record<string, Record<string, unknown>> | undefined
        const safe = Object.fromEntries(
          Object.entries(providers ?? {}).map(([name, p]) => [
            name,
            { ...p, apiKey: p.apiKey ? "******" : undefined },
          ]),
        )
        return Response.json(
          { provider: safe, model: cfg.model ?? "", configured: Boolean(cfg.model && Object.keys(providers ?? {}).length) },
          { headers: corsHeaders },
        )
      }

      if (path === "/config" && req.method === "POST") {
        const body = (await req.json()) as { name?: string; baseUrl?: string; apiKey?: string; model?: string }
        if (body.name && body.baseUrl && body.apiKey) {
          saveProvider(body.name, { baseUrl: body.baseUrl, apiKey: body.apiKey })
        }
        if (body.model) setModel(body.model)
        return Response.json({ ok: true }, { headers: corsHeaders })
      }

      return new Response("not found", { status: 404, headers: corsHeaders })
    },
  })

  console.log(`FUCK server listening on http://127.0.0.1:${server.port}`)
  return server
}
