import { EventStream } from "./event-stream"
import { MessageQueue } from "./message-queue"
import { runAgentLoop, type GoalTestResult } from "./agent-loop"
import { composeHooks } from "./hooks"
import type { ModelAdapter } from "./model-adapter"
import type { ToolHook, TurnHook } from "./hooks"
import type { AgentEvent, AgentMessage, ToolDefinition } from "./types"
import type { CompactionConfig } from "./harness/compaction"
import type { ExtensionManager } from "./extension/manager"

export type AgentConfig = {
  model: ModelAdapter
  system: string
  tools: ToolDefinition[]
  hook?: ToolHook
  turnHook?: TurnHook
  extensions?: ExtensionManager
  compaction?: CompactionConfig
  goalTest?: (messages: AgentMessage[]) => Promise<GoalTestResult>
  maxAutoContinue?: number
  maxTurns?: number
}

export type AgentStatus = "idle" | "running" | "aborted"

// stateful Agent: send / steer / followUp / abort / waitForIdle
export class Agent {
  readonly sessionId: string
  private context: AgentMessage[] = []
  private steering = new MessageQueue()
  private followUpQueue = new MessageQueue()
  private controller: AbortController | null = null
  private running: Promise<AgentMessage[]> | null = null
  private _status: AgentStatus = "idle"
  private activeToolNames: Set<string> | null = null

  readonly events = new EventStream()

  constructor(
    private config: AgentConfig,
    sessionId?: string
  ) {
    this.sessionId = sessionId ?? crypto.randomUUID()
  }

  get status(): AgentStatus {
    return this._status
  }

  get messages(): AgentMessage[] {
    return this.context
  }

  // restore history messages into context (for resuming a session)
  seed(messages: AgentMessage[]) {
    this.context.push(...messages)
  }

  // ---- tool set control (extensions can call setActiveTools / getAllTools) ----

  getAllTools(): string[] {
    return this.allTools().map((t) => t.name)
  }

  getActiveTools(): string[] {
    return this.activeTools().map((t) => t.name)
  }

  setActiveTools(names: string[]) {
    this.activeToolNames = new Set(names)
  }

  private allTools(): ToolDefinition[] {
    return [...this.config.tools, ...(this.config.extensions?.getDynamicTools() ?? [])]
  }

  private activeTools(): ToolDefinition[] {
    const all = this.allTools()
    if (!this.activeToolNames) return all
    return all.filter((t) => this.activeToolNames!.has(t.name))
  }

  // ---- session lifecycle ----

  startSession(reason: "startup" | "reload" | "new" | "resume" | "fork") {
    void this.config.extensions?.emitSessionStart(reason)
  }

  shutdownSession(reason: "quit" | "reload" | "new" | "resume" | "fork") {
    void this.config.extensions?.emitSessionShutdown(reason)
  }

  // send a user message; while running it becomes a steering message
  send(content: string): Promise<AgentMessage[]> {
    if (this._status === "running") {
      this.steering.push({ role: "user", content })
      return this.running!
    }
    return this.start(content)
  }

  // inject a steering message while running
  steer(content: string) {
    this.steering.push({ role: "user", content })
  }

  // queue a follow-up message (triggers the next round after the agent stops)
  followUp(content: string) {
    this.followUpQueue.push({ role: "user", content })
  }

  abort() {
    this.controller?.abort()
  }

  waitForIdle(): Promise<AgentMessage[]> {
    return this.running ?? Promise.resolve([])
  }

  private async start(content: string): Promise<AgentMessage[]> {
    if (this._status === "running") throw new Error("agent already running")

    // push the first user message into context before starting the loop
    this.context.push({ role: "user", content })
    this._status = "running"
    this.controller = new AbortController()

    const extensions = this.config.extensions
    const hook = composeHooks(this.config.hook, extensions?.toolHook())
    const filterContext = extensions ? (msgs: AgentMessage[]) => extensions.emitContext(msgs) : undefined

    // before_agent_start: extensions may rewrite systemPrompt (chained); await before starting the loop
    let system = this.config.system
    const modified = await extensions?.emitBeforeAgentStart(content, system)
    if (modified) system = modified

    this.running = runAgentLoop(this.context, {
      model: this.config.model,
      system,
      tools: this.activeTools(),
      hook,
      turnHook: this.config.turnHook,
      steering: this.steering,
      followUp: this.followUpQueue,
      signal: this.controller.signal,
      filterContext,
      compaction: this.config.compaction,
      goalTest: this.config.goalTest,
      maxAutoContinue: this.config.maxAutoContinue,
      maxTurns: this.config.maxTurns,
      emit: (e: AgentEvent) => this.events.emit(e),
      onTurnStart: () => extensions?.emitTurnStart(),
      onTurnEnd: () => extensions?.emitTurnEnd(),
    }).then(
      (produced) => {
        this._status = this.controller?.signal.aborted ? "aborted" : "idle"
        this.controller = null
        this.running = null
        return produced
      },
      (err) => {
        this._status = "idle"
        this.controller = null
        this.running = null
        throw err
      }
    )

    return this.running
  }
}
