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
}

const DEFAULT_SUB_SYSTEM =
  "You are a focused sub-agent. Complete the assigned task in isolation and return a single, concrete final answer. Do not ask questions; use tools to verify your result, then report the outcome."

// extract the final answer from a finished sub-agent
function finalAnswer(produced: AgentMessage[]): string {
  for (let i = produced.length - 1; i >= 0; i--) {
    const m = produced[i]
    if (m.role === "assistant" && m.content) return m.content
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
    description: `Spawn sub-agents to work on independent tasks in PARALLEL. Each sub-agent runs in its own isolated context with its own tool subset and returns one final answer. Use for fan-out: give each sub-agent a distinct, non-overlapping task. At most ${maxTasks} tasks per call. Returns all results.`,
    schema: z.object({
      tasks: z
        .array(
          z.object({
            task: z.string().describe("the complete, self-contained task for this sub-agent"),
            tools: z
              .array(z.string())
              .optional()
              .describe("optional tool-name subset for this sub-agent (default: all non-delegate tools)"),
            system: z.string().optional().describe("optional task-specific system prompt override"),
          })
        )
        .min(1)
        .max(maxTasks)
        .describe(`one or more independent tasks to run in parallel (max ${maxTasks})`),
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
