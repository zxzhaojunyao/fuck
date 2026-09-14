import { z } from "zod"
import { ExtensionManager } from "./extension/manager"
import { Agent } from "./agent"
import { createTodoExtension } from "./extensions/todo"
import type { ModelAdapter } from "./model-adapter"
import type { AssistantMessage, ToolDefinition } from "./types"

function mockModel(script: Array<() => AssistantMessage>): ModelAdapter {
  let i = 0
  return {
    async stream({ }, emit) {
      const next = script[Math.min(i, script.length - 1)]()
      i++
      if (next.content) {
        for (const ch of next.content) emit({ type: "message_delta", text: ch })
      }
      emit({ type: "message_end", message: next })
      return next
    },
    async summarize(messages) {
      return messages.map((m) => (m.role === "assistant" ? m.content : "")).join(" ").slice(0, 200)
    },
  }
}

function bindCtx(ext: ExtensionManager, agent: Agent) {
  ext.bindContext({
    cwd: process.cwd(),
    ui: { select: async () => undefined, confirm: async () => false, input: async () => undefined, notify: () => {}, setStatus: () => {}, setWidget: () => {}, editor: async () => undefined },
    model: "test/m",
    sessionId: agent.sessionId,
    appendEntry: () => {},
    readCustomEntries: () => [],
    sendUserMessage: () => {},
    getContextUsage: () => undefined,
    abort: () => {},
    isIdle: () => true,
  })
}

// 1. registerTool: dynamic tools are callable by the agent
{
  const ext = new ExtensionManager()
  await ext.load([
    async () => (pi) => {
      pi.registerTool({
        name: "greet",
        description: "greet",
        schema: z.object({ name: z.string() }),
        execute: async (args) => `hello ${args.name}`,
      })
    },
  ])
  const tools: ToolDefinition[] = []
  const model = mockModel([
    () => ({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", name: "greet", arguments: { name: "world" } }],
      stopReason: "tool-calls",
    }),
    () => ({ role: "assistant", content: "done", toolCalls: [], stopReason: "stop" }),
  ])
  const agent = new Agent({ model, system: "test", tools, extensions: ext })
  bindCtx(ext, agent)
  ext.bindToolControl(() => agent.getActiveTools(), () => agent.getAllTools(), (n) => agent.setActiveTools(n), () => {})

  const results: string[] = []
  agent.events.subscribe((e) => {
    if (e.type === "tool_end") results.push(e.result.content)
  })
  await agent.send("x")
  await agent.waitForIdle()
  console.assert(results.some((r) => r.includes("hello world")), `dynamic tool should be called, got: ${results.join(",")}`)
  console.assert(agent.getAllTools().includes("greet"), "getAllTools should include dynamic tool")
  console.log("1. registerTool dynamic tool: OK")
}

// 2. on("tool_call") intercept + arg mutation + on("tool_result") rewrite
{
  const ext = new ExtensionManager()
  let injected = ""
  await ext.load([
    async () => (pi) => {
      pi.on("tool_call", (e) => {
        if (e.toolCall.name === "bash") {
          return { input: { command: String(e.toolCall.arguments.command) + " --sandbox" } }
        }
      })
      pi.on("tool_result", (e) => {
        if (e.toolCall.name === "bash") injected = e.result.content
        return { content: "REDACTED" }
      })
    },
  ])
  const bashTool: ToolDefinition = {
    name: "bash",
    description: "run",
    schema: z.object({ command: z.string() }),
    execute: async (args) => `ran: ${args.command}`,
  }
  const model = mockModel([
    () => ({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", name: "bash", arguments: { command: "ls" } }],
      stopReason: "tool-calls",
    }),
    () => ({ role: "assistant", content: "done", toolCalls: [], stopReason: "stop" }),
  ])
  const agent = new Agent({ model, system: "test", tools: [bashTool], extensions: ext })
  bindCtx(ext, agent)
  const results: string[] = []
  agent.events.subscribe((e) => {
    if (e.type === "tool_end") results.push(e.result.content)
  })
  await agent.send("x")
  await agent.waitForIdle()
  console.assert(injected.includes("--sandbox"), `input rewrite should apply, got: ${injected}`)
  console.assert(results[0] === "REDACTED", `tool_result rewrite should apply, got: ${results[0]}`)
  console.log("2. tool_call/tool_result rewrite: OK")
}

// 3. setActiveTools switch to a read-only set
{
  const ext = new ExtensionManager()
  const readTool: ToolDefinition = { name: "read", description: "r", schema: z.object({}), execute: async () => "ok" }
  const bashTool: ToolDefinition = { name: "bash", description: "b", schema: z.object({}), execute: async () => "ok" }
  const agent = new Agent({ model: mockModel([() => ({ role: "assistant", content: "d", toolCalls: [], stopReason: "stop" })]), system: "t", tools: [readTool, bashTool], extensions: ext })
  ext.bindToolControl(() => agent.getActiveTools(), () => agent.getAllTools(), (n) => agent.setActiveTools(n), () => {})
  agent.setActiveTools(["read"])
  console.assert(agent.getActiveTools().join(",") === "read", `setActiveTools should keep only read, got: ${agent.getActiveTools()}`)
  console.assert(agent.getAllTools().length === 2, "getAllTools should still be full")
  console.log("3. setActiveTools: OK")
}

// 4. loader: real file loading (transpile + data URL path)
{
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { loadExtensionFactories } = await import("./extension/loader")

  const home = mkdtempSync(join(tmpdir(), "fuck-ext-"))
  const extDir = join(home, "extensions")
  mkdirSync(extDir, { recursive: true })
  const prevHome = process.env.FUCK_HOME
  process.env.FUCK_HOME = home

  writeFileSync(
    join(extDir, "disk-ext.ts"),
    `import { z } from "zod"\n` +
      `export default function (pi) {\n` +
      `  pi.registerTool({ name: "disk_tool", description: "from disk", schema: z.object({}), execute: async () => "disk-ok" })\n` +
      `  pi.registerCommand("diskcmd", { description: "disk cmd", handler: async () => {} })\n` +
      `}\n`,
  )

  const ext = new ExtensionManager()
  const factories = await loadExtensionFactories(process.cwd())
  console.assert(factories.length >= 1, "should discover disk extension")
  await ext.load(factories)
  console.assert(ext.getDynamicTools().some((t) => t.name === "disk_tool"), `should load tool from disk, got: ${ext.getDynamicTools().map((t) => t.name)}`)
  console.assert(ext.getCommands().some((c) => c.name === "diskcmd"), "should load command from disk")

  if (prevHome) process.env.FUCK_HOME = prevHome
  rmSync(home, { recursive: true, force: true })
  console.log("4. loader disk file loading: OK")
}

// 5. todo extension end-to-end
{
  const ext = new ExtensionManager()
  let persisted: { todos?: unknown[] } | undefined
  await ext.load([
    async () => {
      const factory = createTodoExtension()
      return (pi) => {
        // wrap appendEntry to capture persistence calls
        const origAppend = pi.appendEntry.bind(pi)
        pi.appendEntry = (type, data) => {
          if (type === "todo.state") persisted = data as { todos?: unknown[] }
          origAppend(type, data)
        }
        factory(pi)
      }
    },
  ])

  const model = mockModel([
    () => ({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", name: "todo_write", arguments: { todos: [{ content: "audit target", status: "in_progress", priority: "high" }, { content: "write report", status: "pending", priority: "medium" }] } }],
      stopReason: "tool-calls",
    }),
    () => ({ role: "assistant", content: "done", toolCalls: [], stopReason: "stop" }),
  ])
  const agent = new Agent({ model, system: "test", tools: [], extensions: ext })
  bindCtx(ext, agent)
  const results: string[] = []
  agent.events.subscribe((e) => {
    if (e.type === "tool_end" && e.toolCall.name === "todo_write") results.push(e.result.content)
  })
  await agent.send("x")
  await agent.waitForIdle()
  console.assert(results[0]?.includes("2 open / 2 total"), `todo_write should summarize, got: ${results[0]}`)
  console.assert((persisted?.todos?.length ?? 0) === 2, "todo state should persist 2 items")
  console.assert((persisted?.todos?.[0] as { id?: string })?.id?.startsWith("t"), "items should get short IDs")
  console.log("5. todo extension: OK")
}

console.log("\nextension system end-to-end tests passed")
