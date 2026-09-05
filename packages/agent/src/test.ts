import { z } from "zod"
import { Agent } from "./agent"
import type { ModelAdapter } from "./model-adapter"
import type { AgentEvent, AssistantMessage, ToolDefinition } from "./types"

// mock model: scripted response sequence, returns the next one per call
function mockModel(script: Array<() => AssistantMessage>): ModelAdapter {
  let i = 0
  return {
    async stream({ }, emit) {
      const next = script[Math.min(i, script.length - 1)]()
      i++
      // mock streaming delta
      if (next.content) {
        for (const ch of next.content) {
          emit({ type: "message_delta", text: ch })
        }
      }
      emit({ type: "message_end", message: next })
      return next
    },
    async summarize(messages) {
      return messages.map((m) => (m.role === "assistant" ? m.content : "")).join(" ").slice(0, 200)
    },
  }
}

const echoTool: ToolDefinition = {
  name: "echo",
  description: "return the input string",
  schema: z.object({ text: z.string() }),
  execute: async (args) => `echoed: ${args.text}`,
}

// 1. single-turn tool-call loop: user -> assistant(toolCall) -> tool result -> assistant(final text)
{
  const model = mockModel([
    () => ({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", name: "echo", arguments: { text: "hi" } }],
      stopReason: "tool-calls",
    }),
    () => ({ role: "assistant", content: "done", toolCalls: [], stopReason: "stop" }),
  ])
  const agent = new Agent({ model, system: "test", tools: [echoTool] })
  const events: AgentEvent[] = []
  agent.events.subscribe((e) => events.push(e))
  await agent.send("hello")
  await agent.waitForIdle()

  const toolStart = events.filter((e) => e.type === "tool_start")
  const toolEnd = events.filter((e) => e.type === "tool_end")
  console.assert(toolStart.length === 1, "should have one tool_start")
  console.assert(
    toolEnd.length === 1 && toolEnd[0].type === "tool_end" && toolEnd[0].result.content === "echoed: hi",
    "tool result should be returned"
  )
  console.assert(agent.messages.at(-1)?.role === "assistant", "last one should be the assistant final reply")
  console.log("1. single-turn tool loop: OK")
}

// 2. before/after hooks + terminate
{
  const model = mockModel([
    () => ({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", name: "echo", arguments: { text: "x" } }],
      stopReason: "tool-calls",
    }),
    () => ({ role: "assistant", content: "after", toolCalls: [], stopReason: "stop" }),
  ])
  const agent = new Agent({
    model,
    system: "test",
    tools: [echoTool],
    hook: {
      beforeToolCall: () => ({ block: true, reason: "test block" }),
    },
  })
  const events: AgentEvent[] = []
  agent.events.subscribe((e) => events.push(e))
  await agent.send("x")
  await agent.waitForIdle()
  const end = events.find((e) => e.type === "tool_end")
  console.assert(end?.type === "tool_end" && end.result.isError === true, "block should produce an error toolResult")
  console.log("2. before hook block: OK")
}

// 3. truncation guard: stopReason=length -> tool marked failed, not executed
{
  let executed = false
  const t: ToolDefinition = {
    name: "danger",
    description: "should not be executed",
    schema: z.object({}),
    execute: async () => {
      executed = true
      return "ran"
    },
  }
  const model = mockModel([
    () => ({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", name: "danger", arguments: {} }],
      stopReason: "length",
    }),
    () => ({ role: "assistant", content: "retry", toolCalls: [], stopReason: "stop" }),
  ])
  const agent = new Agent({ model, system: "test", tools: [t] })
  await agent.send("x")
  await agent.waitForIdle()
  console.assert(executed === false, "tool should not execute on truncation")
  console.log("3. truncation guard: OK")
}

// 4. steering: injected while running, handled by the inner loop
{
  let callCount = 0
  const model: ModelAdapter = {
    async stream({ messages: _messages }, emit) {
      callCount++
      // intentionally slow, so steering arrives while running
      await new Promise((r) => setTimeout(r, 20))
      const msg: AssistantMessage = {
        role: "assistant",
        content: "step" + callCount,
        toolCalls: [],
        stopReason: "stop",
      }
      emit({ type: "message_delta", text: msg.content })
      emit({ type: "message_end", message: msg })
      return msg
    },
    async summarize(messages) {
      return messages.map((m) => (m.role === "assistant" ? m.content : "")).join(" ").slice(0, 200)
    },
  }
  const agent = new Agent({ model, system: "test", tools: [] })
  const p = agent.send("first")
  // inject steering while running (agent's first turn takes 20ms; inject at 5ms)
  setTimeout(() => agent.steer("interrupt"), 5)
  await p
  await agent.waitForIdle()
  console.assert(callCount >= 2, `steering should trigger extra rounds (got ${callCount})`)
  console.log(`4. steering injection: OK (${callCount} rounds)`)
}

// 5. permission-gate: dangerous command interception + sandbox arg mutation
{
  const { createPermissionGateHook, createSandboxHook } = await import("./harness/security")
  let captured = ""
  const t: ToolDefinition = {
    name: "bash",
    description: "run",
    schema: z.object({ command: z.string() }),
    execute: async (args) => {
      captured = String((args as { command: string }).command)
      return "ran: " + captured
    },
  }
  const model = mockModel([
    () => ({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", name: "bash", arguments: { command: "rm -rf /tmp/x" } }],
      stopReason: "tool-calls",
    }),
    () => ({ role: "assistant", content: "done", toolCalls: [], stopReason: "stop" }),
  ])
  const agent = new Agent({ model, system: "test", tools: [t], hook: createPermissionGateHook() })
  const events: AgentEvent[] = []
  agent.events.subscribe((e) => events.push(e))
  await agent.send("x")
  await agent.waitForIdle()
  console.assert(captured === "", "dangerous command should be blocked")
  const blocked = events.find((e) => e.type === "tool_end" && e.result.isError)
  console.assert(!!blocked, "should produce an isError toolResult")
  console.log("5. permission-gate: OK")

  // sandbox prefix mutation
  captured = ""
  const sandboxModel = mockModel([
    () => ({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c2", name: "bash", arguments: { command: "ls" } }],
      stopReason: "tool-calls",
    }),
    () => ({ role: "assistant", content: "done", toolCalls: [], stopReason: "stop" }),
  ])
  const agent2 = new Agent({
    model: sandboxModel,
    system: "test",
    tools: [t],
    hook: createSandboxHook(() => "bwrap -- ", () => "/work"),
  })
  await agent2.send("y")
  await agent2.waitForIdle()
  console.assert(captured.startsWith("bwrap -- "), `sandbox should rewrite command, got: ${captured}`)
  console.log("6. sandbox routing: OK")
}

console.log("\nagent-core integration tests passed")
