import type { z } from "zod"

// ---- message abstraction ----

export type UserMessage = {
  role: "user"
  content: string
  images?: { mime: string; data: Uint8Array }[]
}

export type AssistantMessage = {
  role: "assistant"
  content: string
  reasoning?: string
  toolCalls?: ToolCall[]
  stopReason?: string
  usage?: { inputTokens: number; outputTokens: number }
}

export type ToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type ToolResultMessage = {
  role: "tool"
  toolCallId: string
  toolName: string
  content: string
  isError: boolean
  terminate?: boolean
}

// extensible custom messages (declaration merging)
export interface CustomAgentMessages {}

export type CustomMessage = {
  role: "custom"
  [key: string]: unknown
}

export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | CustomMessage

// ---- tool definition ----

export type ToolExecuteArgs = Record<string, unknown>

// streaming tool output callback: long commands like bash report partial output as it runs
export type ToolUpdate = (partial: string) => void

// structured sub-agent progress events emitted by tools that spawn sub-agents (e.g. delegate)
export type DelegateSubEvent =
  | { type: "task_start"; index: number; total: number; title: string }
  | { type: "task_message"; index: number; text: string }
  | { type: "task_tool_start"; index: number; name: string; args: string }
  | { type: "task_tool_delta"; index: number; text: string }
  | { type: "task_tool_end"; index: number }
  | { type: "task_result"; index: number; result: string }
  | { type: "task_error"; index: number; message: string }

// callback for tools to emit structured sub-agent events (forwarded as delegate_event)
export type ToolEventSink = (event: DelegateSubEvent) => void

export type ToolDefinition = {
  name: string
  description: string
  schema: z.ZodTypeAny
  execute(
    args: ToolExecuteArgs,
    signal?: AbortSignal,
    onUpdate?: ToolUpdate,
    onEvent?: ToolEventSink
  ): Promise<unknown>
}

// ---- event stream ----

export type AgentEvent =
  | { type: "agent_start"; sessionId: string }
  | { type: "turn_start" }
  | { type: "message_start" }
  | { type: "message_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "message_end"; message: AssistantMessage }
  | { type: "tool_start"; toolCall: ToolCall }
  | { type: "tool_delta"; toolCallId: string; text: string }
  | { type: "tool_end"; toolCall: ToolCall; result: ToolResultMessage }
  | { type: "delegate_event"; toolCallId: string; event: DelegateSubEvent }
  | { type: "turn_end"; messages: AgentMessage[] }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "compaction"; summaryLength: number; remainingMessages: number }
  | { type: "error"; error: Error }
