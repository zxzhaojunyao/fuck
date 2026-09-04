import type { ModelAdapter } from "./model-adapter"
import type { ToolHook, TurnHook } from "./hooks"
import { MessageQueue } from "./message-queue"
import { compactMessages, needsCompaction, type CompactionConfig } from "./harness/compaction"
import type {
  AgentEvent,
  AgentMessage,
  AssistantMessage,
  ToolCall,
  ToolDefinition,
  ToolExecuteArgs,
  ToolResultMessage,
} from "./types"

export type AgentLoopOptions = {
  model: ModelAdapter
  system: string
  tools: ToolDefinition[]
  hook?: ToolHook
  turnHook?: TurnHook
  // steering: messages injected while the agent is running (inner loop)
  steering?: MessageQueue
  // followUp: queued messages that resume the agent after it stops (outer loop)
  followUp?: MessageQueue
  signal?: AbortSignal
  emit: (event: AgentEvent) => void
  // infinite-loop guard: force-stop after N consecutive steps with no text
  maxNoTextSteps?: number
  // how many times to retry a failed model stream (transient/network errors)
  maxRetries?: number
  // context event: filter/inject messages before each LLM call (returns the new array)
  filterContext?: (messages: AgentMessage[]) => Promise<AgentMessage[] | undefined>
  // auto-compaction: summarize older context when it grows past maxTokens
  compaction?: CompactionConfig
  // goal-test: after the model stops calling tools (no explicit terminate), decide whether
  // the task is actually complete. Return done=false to auto-inject a "keep going" message
  // (anti premature-stop / anti-hallucination: the model must produce verifiable progress,
  // not just decide it is done).
  goalTest?: (messages: AgentMessage[]) => Promise<GoalTestResult>
  // max auto-continue rounds driven by goalTest (infinite-loop guard)
  maxAutoContinue?: number
  // turn events (for the extension system)
  onTurnStart?: () => void | Promise<void>
  onTurnEnd?: () => void | Promise<void>
}

export type GoalTestResult = {
  done: boolean
  // when done=false, this message is injected as the next user turn
  continue?: string
}

// truncation: stopReason means output was cut off; tool args may be incomplete, so fail all tools and ask the model to retry
const TRUNCATED_REASONS = new Set(["length", "max_tokens", "maxTokens"])

// retry a model stream on transient errors (network/empty-stream), with backoff.
// aborts are re-thrown immediately (never retried). Retry attempts buffer their
// events and only flush on success, so a failed attempt never leaves partial/duplicate
// UI output (no re-emitted message_start/delta).
async function streamWithRetry(
  opts: AgentLoopOptions,
  params: { system: string; messages: AgentMessage[] }
): Promise<AssistantMessage> {
  const maxRetries = opts.maxRetries ?? 3
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted) {
      throw new Error("aborted")
    }
    const buffer: AgentEvent[] = []
    const emit = (e: AgentEvent) => {
      if (attempt === 0) opts.emit(e)
      else buffer.push(e)
    }
    try {
      const result = await opts.model.stream(
        { system: params.system, messages: params.messages, tools: opts.tools, signal: opts.signal },
        emit
      )
      if (attempt > 0) {
        for (const e of buffer) opts.emit(e)
      }
      return result
    } catch (err) {
      lastErr = err
      if (opts.signal?.aborted) throw err
      if (attempt < maxRetries) {
        const delay = 500 * Math.pow(2, attempt)
        // log to stderr, not an "error" event (which the UI treats as fatal)
        console.warn(
          `[fuck] model stream failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${err instanceof Error ? err.message : String(err)}`
        )
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function runAgentLoop(
  context: AgentMessage[],
  opts: AgentLoopOptions
): Promise<AgentMessage[]> {
  const produced: AgentMessage[] = []
  const steering = opts.steering ?? new MessageQueue()
  const followUp = opts.followUp ?? new MessageQueue()
  const maxNoTextSteps = opts.maxNoTextSteps ?? 8
  const maxRetries = opts.maxRetries ?? 3
  const maxAutoContinue = opts.maxAutoContinue ?? 10
  let autoContinueCount = 0

  const toolMap = new Map(opts.tools.map((t) => [t.name, t]))

  let noTextSteps = 0
  let toolErrors: ToolResultMessage[] = []

  // ---- outer loop: follow-up resumption ----
  while (true) {
    let hasMoreToolCalls = true

    // ---- inner loop: tool calls + steering ----
    while (hasMoreToolCalls || steering.length > 0) {
      // 1. inject pending steering messages
      const pending = steering.drain("all")
      for (const m of pending) {
        context.push(m)
        produced.push(m)
      }

      opts.emit({ type: "turn_start" })
      void opts.onTurnStart?.()

      // 1.5 turn hook: error-memory injection (cross-turn context)
      let system = opts.system
      if (opts.turnHook?.beforeTurn) {
        const extra = await opts.turnHook.beforeTurn({ toolErrors })
        if (extra) system = opts.system + "\n\n" + extra
      }

      // 1.5 auto-compaction: when context grows past the limit, summarize older
      // messages in place so the working set stays bounded (never sent to the store;
      // the store keeps full fidelity and is re-compacted on resume).
      if (opts.compaction && needsCompaction(context, opts.compaction.maxTokens)) {
        const { summary, messages: compacted } = await compactMessages(context, {
          maxTokens: opts.compaction.maxTokens,
          keepRecentTokens: opts.compaction.keepRecentTokens,
          summarize: opts.compaction.summarize,
          updateSummary: opts.compaction.updateSummary,
        })
        if (compacted.length && compacted.length !== context.length) {
          context.splice(0, context.length, ...compacted)
          opts.emit({
            type: "compaction",
            summaryLength: summary.length,
            remainingMessages: compacted.length,
          })
        }
      }

      // 2. stream one assistant message (with bounded retry for transient model/network errors)
      let assistant: AssistantMessage
      try {
        const messages = opts.filterContext ? (await opts.filterContext(context)) ?? context : context
        assistant = await streamWithRetry(opts, { system, messages })
      } catch (err) {
        opts.emit({ type: "error", error: err instanceof Error ? err : new Error(String(err)) })
        return produced
      }

      context.push(assistant)
      produced.push(assistant)

      if (assistant.content || assistant.reasoning) noTextSteps = 0
      else noTextSteps++

      // 3. execute tool calls
      const toolCalls = assistant.toolCalls ?? []
      const truncated = TRUNCATED_REASONS.has(assistant.stopReason ?? "")

      let results: ToolResultMessage[] = []
      if (toolCalls.length > 0) {
        results = await executeToolCalls(toolCalls, toolMap, opts.hook, truncated, opts)
        for (const r of results) {
          context.push(r)
          produced.push(r)
        }
        const errors = results.filter((r) => r.isError)
        if (errors.length) toolErrors = toolErrors.concat(errors).slice(-20)
      }

      // 4. termination check
      const shouldTerminate =
        results.length > 0 && (await shouldTerminateBatch(results, opts.hook))

      void opts.onTurnEnd?.()

      hasMoreToolCalls = toolCalls.length > 0

      if (shouldTerminate) break

      if (noTextSteps >= maxNoTextSteps) {
        opts.emit({
          type: "error",
          error: new Error(`${maxNoTextSteps} consecutive steps produced no text; possible infinite loop, aborting`),
        })
        return produced
      }
    }

    // ---- end of outer loop: check follow-up, then goal-test ----
    const followUps = followUp.drain("all")
    if (followUps.length > 0) {
      for (const m of followUps) {
        context.push(m)
        produced.push(m)
      }
      continue
    }

    // goal-test: model stopped without explicit terminate. If the goal is not verifiably
    // complete, inject a steering message to keep it working (anti-hallucination).
    if (opts.goalTest && autoContinueCount < maxAutoContinue) {
      const goal = await opts.goalTest(produced)
      if (!goal.done) {
        autoContinueCount++
        const resume: AgentMessage = {
          role: "user",
          content:
            goal.continue ??
            "The task is not complete yet. Continue working with tools: verify your result against the actual goal (run tests / submit / inspect output) instead of declaring done from assumptions.",
        }
        context.push(resume)
        produced.push(resume)
        continue
      }
    }

    break
  }

  opts.emit({ type: "agent_end", messages: produced })
  return produced
}

async function executeToolCalls(
  toolCalls: ToolCall[],
  toolMap: Map<string, ToolDefinition>,
  hook: ToolHook | undefined,
  truncated: boolean,
  opts: AgentLoopOptions
): Promise<ToolResultMessage[]> {
  const results: ToolResultMessage[] = []

  for (const call of toolCalls) {
    opts.emit({ type: "tool_start", toolCall: call })

    let result: ToolResultMessage

    if (truncated) {
      // truncation guard: args may be incomplete, mark as failed without executing
      result = {
        role: "tool",
        toolCallId: call.id,
        toolName: call.name,
        content: "ERROR: model output was truncated; tool arguments may be incomplete. Please retry the tool call.",
        isError: true,
      }
    } else {
      // pre-execution hook: may block / mutate args
      if (hook?.beforeToolCall) {
        const before = await hook.beforeToolCall(call)
        if (before.block) {
          result = {
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: `tool call blocked: ${before.reason ?? "no reason"}`,
            isError: true,
          }
          results.push(result)
          opts.emit({ type: "tool_end", toolCall: call, result })
          continue
        }
        if (before.input) {
          call.arguments = { ...call.arguments, ...before.input }
        }
      }

      const tool = toolMap.get(call.name)
      if (!tool) {
        result = {
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          content: `unknown tool: ${call.name}`,
          isError: true,
        }
      } else {
        try {
          const parsed = tool.schema.parse(call.arguments) as ToolExecuteArgs
          const out = await tool.execute(
            parsed,
            opts.signal,
            (partial) => {
              opts.emit({ type: "tool_delta", toolCallId: call.id, text: partial })
            },
            (event) => {
              opts.emit({ type: "delegate_event", toolCallId: call.id, event })
            }
          )
          result = {
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: typeof out === "string" ? out : JSON.stringify(out),
            isError: false,
          }
        } catch (err) {
          result = {
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: `tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      }
    }

    // post-execution hook: may override content / isError / terminate
    if (hook?.afterToolCall) {
      const after = await hook.afterToolCall(call, result)
      if (after.content !== undefined) result.content = after.content
      if (after.isError !== undefined) result.isError = after.isError
      if (after.terminate !== undefined) result.terminate = after.terminate
    }

    results.push(result)
    opts.emit({ type: "tool_end", toolCall: call, result })
  }

  return results
}

async function shouldTerminateBatch(
  results: ToolResultMessage[],
  hook: ToolHook | undefined
): Promise<boolean> {
  if (hook?.shouldTerminate) return hook.shouldTerminate(results)
  // default: terminate only when every result is marked terminate
  return results.every((r) => r.terminate === true)
}
