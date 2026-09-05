import type { AgentMessage, ToolCall, ToolDefinition, ToolResultMessage } from "../types"

// ---- extension system types ----

// custom tools registered by extensions: ToolDefinition (zod schema)
export type ExtensionToolDefinition = ToolDefinition

// ---- ctx.ui (implemented and injected by the tui layer) ----

export type UINotifyType = "info" | "warning" | "error"

export interface ExtensionUIContext {
  select(title: string, options: string[]): Promise<string | undefined>
  confirm(title: string, message: string): Promise<boolean>
  input(title: string, placeholder?: string): Promise<string | undefined>
  notify(message: string, type?: UINotifyType): void
  setStatus(key: string, text: string | undefined): void
  setWidget(key: string, content: string[] | undefined): void
  editor(title: string, prefill?: string): Promise<string | undefined>
}

// ---- event payloads ----

export type SessionStartEvent = { type: "session_start"; reason: "startup" | "reload" | "new" | "resume" | "fork" }
export type SessionShutdownEvent = { type: "session_shutdown"; reason: "quit" | "reload" | "new" | "resume" | "fork" }
export type ContextEvent = { type: "context"; messages: AgentMessage[] }
export type BeforeAgentStartEvent = { type: "before_agent_start"; prompt: string; systemPrompt: string }
export type AgentStartEvent = { type: "agent_start" }
export type AgentEndEvent = { type: "agent_end"; messages: AgentMessage[] }
export type TurnStartEvent = { type: "turn_start" }
export type TurnEndEvent = { type: "turn_end" }
export type MessageStartEvent = { type: "message_start"; message: AgentMessage }
export type MessageEndEvent = { type: "message_end"; message: AgentMessage }
export type ToolCallEvent = { type: "tool_call"; toolCall: ToolCall }
export type ToolResultEvent = { type: "tool_result"; toolCall: ToolCall; result: ToolResultMessage }
export type ModelSelectEvent = { type: "model_select"; model: string; previousModel: string | undefined }

export type ExtensionEvent =
  | SessionStartEvent
  | SessionShutdownEvent
  | ContextEvent
  | BeforeAgentStartEvent
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageEndEvent
  | ToolCallEvent
  | ToolResultEvent
  | ModelSelectEvent

// ---- event handler return values (intercept/rewrite semantics) ----

export type ToolCallEventResult = { block?: boolean; reason?: string; input?: Record<string, unknown> }
export type ToolResultEventResult = { content?: string; isError?: boolean; terminate?: boolean }
export type ContextEventResult = { messages: AgentMessage[] }
export type BeforeAgentStartEventResult = { systemPrompt?: string }

// ---- ExtensionContext ----

export interface ExtensionContext {
  cwd: string
  ui: ExtensionUIContext
  /** current model spec (provider/model) */
  model: string
  sessionId: string
  /** append a custom entry to the session (persistent state, not sent to the LLM) */
  appendEntry(customType: string, data?: unknown): void
  /** read back custom entries of a type (in seq order) */
  readCustomEntries(customType: string): unknown[]
  /** send a message and trigger a turn */
  sendUserMessage(content: string): void
  /** current context token estimate */
  getContextUsage(): { tokens: number } | undefined
  /** abort the current agent */
  abort(): void
  /** whether idle (not streaming) */
  isIdle(): boolean
}

// ---- ExtensionAPI ----

export interface RegisteredCommand {
  name: string
  description?: string
  handler: (args: string, ctx: ExtensionContext) => void | Promise<void>
}

export interface ExtensionAPI {
  on(event: "session_start", handler: (event: SessionStartEvent, ctx: ExtensionContext) => void | Promise<void>): void
  on(event: "session_shutdown", handler: (event: SessionShutdownEvent, ctx: ExtensionContext) => void | Promise<void>): void
  on(event: "turn_start", handler: (event: TurnStartEvent, ctx: ExtensionContext) => void | Promise<void>): void
  on(event: "turn_end", handler: (event: TurnEndEvent, ctx: ExtensionContext) => void | Promise<void>): void
  on(event: "model_select", handler: (event: ModelSelectEvent, ctx: ExtensionContext) => void | Promise<void>): void
  on(event: "before_agent_start", handler: (event: BeforeAgentStartEvent, ctx: ExtensionContext) => BeforeAgentStartEventResult | void | Promise<BeforeAgentStartEventResult | void>): void
  on(event: "context", handler: (event: ContextEvent, ctx: ExtensionContext) => ContextEventResult | void | Promise<ContextEventResult | void>): void
  on(event: "tool_call", handler: (event: ToolCallEvent, ctx: ExtensionContext) => ToolCallEventResult | void | Promise<ToolCallEventResult | void>): void
  on(event: "tool_result", handler: (event: ToolResultEvent, ctx: ExtensionContext) => ToolResultEventResult | void | Promise<ToolResultEventResult | void>): void
  on(event: string, handler: (event: ExtensionEvent, ctx: ExtensionContext) => unknown): void

  registerTool(tool: ExtensionToolDefinition): void
  registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void

  // actions
  appendEntry(customType: string, data?: unknown): void
  readCustomEntries(customType: string): unknown[]
  sendUserMessage(content: string): void
  setSessionName(name: string): void
  getSessionName(): string | undefined

  // tool set control
  getActiveTools(): string[]
  getAllTools(): string[]
  setActiveTools(names: string[]): void

  // model
  setModel(spec: string): void
}

// default export signature of an extension module
export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>
