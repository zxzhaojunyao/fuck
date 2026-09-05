export { EventStream } from "./event-stream"
export { MessageQueue } from "./message-queue"
export { runAgentLoop } from "./agent-loop"
export type { AgentLoopOptions, GoalTestResult } from "./agent-loop"
export { createDelegateTool } from "./delegate"
export type { DelegateOptions } from "./delegate"
export { Agent } from "./agent"
export { createModelAdapter } from "./model-adapter"
export type { ModelAdapter } from "./model-adapter"
export type { ToolHook, TurnHook, BeforeToolCallResult, AfterToolCallResult } from "./hooks"
export { composeHooks, composeTurnHooks } from "./hooks"
export { buildSystemPrompt } from "./harness/system-prompt"
export { listSkills, matchSkills, createSkillHook } from "./harness/skills"
export type { Skill } from "./harness/skills"
export { createErrorMemoryHook } from "./harness/error-memory"
export { createPermissionGateHook, createSandboxHook, sandboxPrefixFromConfig } from "./harness/security"
export {
  appendEntry,
  readEntries,
  entriesToMessages,
  branchFrom,
  listSessions,
  deleteSession,
  newSessionId,
  SessionStore,
} from "./harness/session"
export type { SessionEntry, SessionMeta } from "./harness/session"
export {
  compactMessages,
  needsCompaction,
  estimateTokens,
  totalTokens,
  contextTokens,
  findCutPoint,
} from "./harness/compaction"
export type { CompactionOptions, CompactionConfig } from "./harness/compaction"
export { GraphStore, createGraphTools } from "./harness/graph"
export type { GraphNode, GraphNodeType, GraphEdge, GraphEdgeType, GraphSnapshot } from "./harness/graph"
export { createGoalTest } from "./harness/goal-test"
export type { GoalScene } from "./harness/goal-test"
export type {
  AgentEvent,
  AgentMessage,
  AssistantMessage,
  UserMessage,
  ToolCall,
  ToolResultMessage,
  ToolDefinition,
  ToolExecuteArgs,
  ToolUpdate,
  ToolEventSink,
  DelegateSubEvent,
  CustomAgentMessages,
} from "./types"

// ---- extension system ----
export { EventBus } from "./extension/event-bus"
export { ExtensionManager } from "./extension/manager"
export { discoverExtensions, loadExtensionFactories } from "./extension/loader"
export type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
  ExtensionFactory,
  ExtensionToolDefinition,
  RegisteredCommand,
  ExtensionEvent,
  UINotifyType,
} from "./extension/types"
export { createTodoExtension } from "./extensions/todo"
