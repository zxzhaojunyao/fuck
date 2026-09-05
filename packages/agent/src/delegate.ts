import { z } from "zod"
import { Agent } from "./agent"
import type { ModelAdapter } from "./model-adapter"
import type { ToolHook, TurnHook } from "./hooks"
import type { CompactionConfig } from "./harness/compaction"
import type { AgentMessage, DelegateSubEvent, ToolDefinition } from "./types"

// ---- delegate: spawn parallel sub-agents to work on independent tasks ----

export type DelegateOptions = {
  adapter: ModelAdapter
  system: string
  tools: ToolDefinition[]
  hook?: ToolHook
  turnHook?: TurnHook
  compaction?: CompactionConfig
  // how deep sub-agents may delegate further (0 = no nested delegation)
  maxDepth?: number
  // max sub-agents per delegate call (dynamic; e.g. CTF injects the platform's concurrent-slot limit)
  maxTasks?: number
  // max turns per sub-agent (stop-loss: a sub-agent that keeps calling tools can't run forever)
  maxTurns?: number
}

// fan-out worker contract: a worker executes ONE bounded intent, reports a concrete
// result, then STOPS. It must NOT expand into autonomous exploration — that is the
// planner's job. This is what makes fan-out workers terminate reliably (unlike a
// full agent loop, which relies on "the model stops calling tools" and never does
// during a pentest).
const DEFAULT_SUB_SYSTEM = [
  "You are a fan-out worker spawned to explore ONE specific, bounded intent.",
  "Your job: carry out that single operation with tools, then report a concrete result (success / failure / what you found) in 1-3 sentences and STOP.",
  "Do NOT expand beyond the assigned intent. Do NOT autonomously start exploring other angles — that is the planner's job, not yours.",
  "Do NOT ask questions. Verify with a tool, then report and stop.",
  "If you cannot complete the intent, report exactly what you tried and what blocked you — that IS a valid result.",
].join(" ")

// extract the final answer from a finished sub-agent.
// prefers the last assistant text; falls back to reasoning (reasoning models may
// put the answer there and leave content empty); last resort: last tool result.
function finalAnswer(produced: AgentMessage[]): string {
  for (let i = produced.length - 1; i >= 0; i--) {
    const m = produced[i]
    if (m.role === "assistant" && m.content) return m.content
  }
  for (let i = produced.length - 1; i >= 0; i--) {
    const m = produced[i]
    if (m.role === "assistant" && (m as { reasoning?: string }).reasoning) {
      return (m as { reasoning?: string }).reasoning!.slice(-2000)
    }
  }
  for (let i = produced.length - 1; i >= 0; i--) {
    const m = produced[i]
    if (m.role === "tool" && m.content) return m.content.slice(0, 2000)
  }
  return "(no output)"
}

// wrap an onUpdate sink so the prefix is emitted only at line starts,
// not on every streaming delta chunk (avoids "[1/3] 我[1/3] 们...").
function linePrefixed(
  prefix: string,
  onUpdate: ((text: string) => void) | undefined
): (text: string) => void {
  let atLineStart = true
  return (text: string) => {
    if (!onUpdate) return
    let out = ""
    for (const ch of text) {
      if (atLineStart) {
        out += prefix
        atLineStart = false
      }
      out += ch
      if (ch === "\n") atLineStart = true
    }
    onUpdate(out)
  }
}

export function createDelegateTool(opts: DelegateOptions, depth = 0): ToolDefinition {
  const maxDepth = opts.maxDepth ?? 2
  const maxTasks = opts.maxTasks ?? 10
  // intent 粒度的 worker 应该在少数几步内完成；40 轮是慷慨的兜底，防止失控
  const maxTurns = opts.maxTurns ?? 40

  // the sub-agent's tool set: base tools minus delegate, plus a nested delegate at depth+1
  function subAgentTools(toolNames: string[] | undefined): ToolDefinition[] {
    let base = opts.tools.filter((t) => t.name !== "delegate")
    if (toolNames && toolNames.length) {
      base = base.filter((t) => toolNames.includes(t.name))
    }
    if (depth + 1 < maxDepth) {
      base.push(createDelegateTool(opts, depth + 1))
    }
    return base
  }

  async function runOne(
    task: { task: string; tools?: string[]; system?: string },
    index: number,
    total: number,
    signal: AbortSignal | undefined,
    report: (text: string) => void,
    emitTask: (event: DelegateSubEvent) => void
  ): Promise<string> {
    const sub = new Agent({
      model: opts.adapter,
      system: task.system ?? DEFAULT_SUB_SYSTEM,
      tools: subAgentTools(task.tools),
      hook: opts.hook,
      turnHook: opts.turnHook,
      compaction: opts.compaction,
      maxTurns,
    })

    // forward the sub-agent's live events to the parent as structured events
    const unsubscribe = sub.events.subscribe((e) => {
      if (e.type === "message_delta") {
        emitTask({ type: "task_message", index, text: e.text })
        report(e.text)
      } else if (e.type === "tool_start") {
        emitTask({ type: "task_tool_start", index, name: e.toolCall.name, args: JSON.stringify(e.toolCall.arguments).slice(0, 120) })
        report(`\n  [tool] ${e.toolCall.name} ${JSON.stringify(e.toolCall.arguments).slice(0, 120)}\n`)
      } else if (e.type === "tool_delta") {
        emitTask({ type: "task_tool_delta", index, text: e.text })
        report(e.text)
      } else if (e.type === "tool_end") {
        emitTask({ type: "task_tool_end", index })
        report("\n  [done]\n")
      }
    })

    const onAbort = () => sub.abort()
    signal?.addEventListener("abort", onAbort, { once: true })

    try {
      emitTask({ type: "task_start", index, total, title: task.task.slice(0, 80) })
      report(`[task] ${task.task.slice(0, 80)}\n`)
      const produced = await sub.send(task.task)
      await sub.waitForIdle()
      const answer = finalAnswer(produced)
      emitTask({ type: "task_result", index, result: answer })
      return answer
    } catch (err) {
      emitTask({ type: "task_error", index, message: err instanceof Error ? err.message : String(err) })
      return `(error) ${err instanceof Error ? err.message : String(err)}`
    } finally {
      unsubscribe()
      signal?.removeEventListener("abort", onAbort)
    }
  }

  return {
    name: "delegate",
    description: `Fan out N independent intents to N parallel workers. Each worker executes ONE bounded, non-overlapping intent and reports a concrete result (success/failure/finding), then stops. This is for trying multiple paths at once — NOT for delegating an entire goal. Give each worker a small, well-scoped intent, not "solve this whole challenge". At most ${maxTasks} workers per call.`,
    schema: z.object({
      tasks: z
        .array(
          z.object({
            task: z
              .string()
              .describe("ONE bounded, concrete intent for this worker (e.g. 'test the login endpoint for SQLi', 'scan port 80 for directories'). Not an entire goal."),
            tools: z
              .array(z.string())
              .optional()
              .describe("optional tool-name subset for this worker (default: all non-delegate tools)"),
            system: z.string().optional().describe("optional intent-specific system prompt override"),
          })
        )
        .min(1)
        .max(maxTasks)
        .describe(`one or more independent intents to run in parallel (max ${maxTasks})`),
    }),
    execute: async (args, signal, onUpdate, onEvent) => {
      const tasks = args.tasks as { task: string; tools?: string[]; system?: string }[]
      const results = await Promise.all(
        tasks.map((t, i) =>
          runOne(t, i, tasks.length, signal, linePrefixed(`[${i + 1}/${tasks.length}] `, onUpdate), onEvent ?? (() => {}))
        )
      )
      return results
        .map((r, i) => `### task ${i + 1}: ${tasks[i].task.slice(0, 80)}\n${r}`)
        .join("\n\n")
    },
  }
}
