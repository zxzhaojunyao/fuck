import type { AgentMessage, ToolCall, ToolResultMessage } from "./types"

// ---- tool hooks ----

export type BeforeToolCallResult = {
  block?: boolean
  reason?: string
  // arg mutation: merged into the original args before execution
  input?: Record<string, unknown>
}

export type AfterToolCallResult = {
  content?: string
  isError?: boolean
  terminate?: boolean
}

export type ToolHook = {
  // before execution: return { block: true } to intercept and inject an error toolResult
  beforeToolCall?(call: ToolCall): BeforeToolCallResult | Promise<BeforeToolCallResult>
  // after execution: may override content / isError / terminate
  afterToolCall?(call: ToolCall, result: ToolResultMessage): AfterToolCallResult | Promise<AfterToolCallResult>
  // decide whether to stop this tool batch (stop early only if every finalized toolResult is terminate)
  shouldTerminate?(results: ToolResultMessage[]): boolean | Promise<boolean>
}

// turn hook: cross-turn context such as error-memory / skill-loading injection
export type TurnHook = {
  // before each turn: return context to inject (e.g. "failed on X last time, don't repeat"), or null
  beforeTurn?(context: { toolErrors: ToolResultMessage[]; messages: AgentMessage[] }): string | null | Promise<string | null>
}

// compose multiple ToolHooks into one: run beforeToolCall in order (block wins, input merges),
// run afterToolCall in order (later overrides earlier), terminate if any shouldTerminate returns true.
export function composeHooks(...hooks: (ToolHook | undefined)[]): ToolHook | undefined {
  const active = hooks.filter((h): h is ToolHook => !!h)
  if (active.length === 0) return undefined
  return {
    async beforeToolCall(call) {
      let mergedInput: Record<string, unknown> | undefined
      for (const h of active) {
        if (!h.beforeToolCall) continue
        const r = await h.beforeToolCall(call)
        if (r.block) return { block: true, reason: r.reason }
        if (r.input) mergedInput = { ...(mergedInput ?? {}), ...r.input }
      }
      return mergedInput ? { input: mergedInput } : {}
    },
    async afterToolCall(call, result) {
      let cur: AfterToolCallResult = {}
      for (const h of active) {
        if (!h.afterToolCall) continue
        const r = await h.afterToolCall(call, result)
        cur = { ...cur, ...r }
      }
      return cur
    },
    async shouldTerminate(results) {
      for (const h of active) {
        if (!h.shouldTerminate) continue
        if (await h.shouldTerminate(results)) return true
      }
      return false
    },
  }
}

// compose multiple TurnHooks: run beforeTurn in order, join non-empty injections
export function composeTurnHooks(...hooks: (TurnHook | undefined)[]): TurnHook | undefined {
  const active = hooks.filter((h): h is TurnHook => !!h)
  if (active.length === 0) return undefined
  return {
    async beforeTurn(context) {
      const parts: string[] = []
      for (const h of active) {
        if (!h.beforeTurn) continue
        const r = await h.beforeTurn(context)
        if (r) parts.push(r)
      }
      return parts.length ? parts.join("\n\n") : null
    },
  }
}
