import { EventBus } from "./event-bus"
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ExtensionToolDefinition,
  RegisteredCommand,
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent,
  ToolResultEventResult,
} from "./types"
import type { ToolHook, TurnHook } from "../hooks"
import type { AgentMessage, ToolCall, ToolResultMessage } from "../types"

// ---- extension manager: load extensions + dispatch events + bridge to agent-loop hooks ----

export class ExtensionManager {
  private bus = new EventBus()
  private dynamicTools = new Map<string, ExtensionToolDefinition>()
  private commands = new Map<string, RegisteredCommand>()
  private sessionName: string | undefined
  private ctx: ExtensionContext | null = null

  // backfilled after Agent construction (provides cwd/ui/sessionId, etc.)
  bindContext(ctx: ExtensionContext) {
    this.ctx = ctx
  }

  // load a batch of extension modules (default export ExtensionFactory)
  async load(modules: Array<() => Promise<ExtensionFactory | undefined>>): Promise<number> {
    let loaded = 0
    for (const loadModule of modules) {
      try {
        const factory = await loadModule()
        if (typeof factory !== "function") continue
        await factory(this.createAPI())
        loaded++
      } catch (err) {
        console.warn(`[extension] load failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return loaded
  }

  // ---- API exposed to extensions ----

  private createAPI(): ExtensionAPI {
    const mgr = this
    const context = (): ExtensionContext => {
      if (!mgr.ctx) throw new Error("extension context not bound yet")
      return mgr.ctx
    }
    return {
      on(event: string, handler: (event: never, ctx: ExtensionContext) => unknown) {
        mgr.bus.on(event, (e) => handler(e as never, context()))
      },
      registerTool(tool) {
        mgr.dynamicTools.set(tool.name, tool)
      },
      registerCommand(name, options) {
        mgr.commands.set(name, { name, ...options })
      },
      appendEntry(customType, data) {
        context().appendEntry(customType, data)
      },
      readCustomEntries(customType) {
        return context().readCustomEntries(customType)
      },
      sendUserMessage(content) {
        context().sendUserMessage(content)
      },
      setSessionName(name) {
        mgr.sessionName = name
      },
      getSessionName() {
        return mgr.sessionName
      },
      getActiveTools() {
        return mgr.getActiveTools()
      },
      getAllTools() {
        return mgr.getAllTools()
      },
      setActiveTools(names) {
        mgr.setActiveTools(names)
      },
      setModel(spec) {
        mgr.setModel(spec)
      },
    }
  }

  // ---- event emission points called by the Agent ----

  async emitSessionStart(reason: "startup" | "reload" | "new" | "resume" | "fork") {
    await this.bus.emit("session_start", { type: "session_start", reason })
  }

  async emitSessionShutdown(reason: "quit" | "reload" | "new" | "resume" | "fork") {
    await this.bus.emit("session_shutdown", { type: "session_shutdown", reason })
  }

  // before_agent_start: may rewrite systemPrompt, chained
  async emitBeforeAgentStart(prompt: string, systemPrompt: string): Promise<string | undefined> {
    const r = await this.bus.chain<BeforeAgentStartEvent, BeforeAgentStartEventResult>(
      "before_agent_start",
      { type: "before_agent_start", prompt, systemPrompt },
      (acc, next) => ({ systemPrompt: next.systemPrompt ?? acc.systemPrompt }),
    )
    return r?.systemPrompt
  }

  async emitTurnStart() {
    await this.bus.emit("turn_start", { type: "turn_start" })
  }

  async emitTurnEnd() {
    await this.bus.emit("turn_end", { type: "turn_end" })
  }

  async emitModelSelect(model: string, previousModel: string | undefined) {
    await this.bus.emit("model_select", { type: "model_select", model, previousModel })
  }

  // context: filter/inject messages, chained
  async emitContext(messages: AgentMessage[]): Promise<AgentMessage[] | undefined> {
    return this.bus
      .chain<ContextEvent, ContextEventResult>(
        "context",
        { type: "context", messages },
        (acc, next) => ({ messages: next.messages ?? acc.messages }),
      )
      .then((r) => r?.messages)
  }

  // ---- bridge: expose interception points as ToolHook / TurnHook (for agent-loop) ----

  toolHook(): ToolHook {
    const bus = this.bus
    return {
      async beforeToolCall(call: ToolCall) {
        const r = await bus.emit<ToolCallEvent, ToolCallEventResult>("tool_call", {
          type: "tool_call",
          toolCall: call,
        })
        return r ?? {}
      },
      async afterToolCall(call: ToolCall, result: ToolResultMessage) {
        const r = await bus.chain<ToolResultEvent, ToolResultEventResult>(
          "tool_result",
          { type: "tool_result", toolCall: call, result },
          (acc, next) => ({
            content: next.content ?? acc.content,
            isError: next.isError ?? acc.isError,
            terminate: next.terminate ?? acc.terminate,
          }),
        )
        return r ?? {}
      },
    }
  }

  turnHook(): TurnHook {
    return {
      async beforeTurn() {
        return null
      },
    }
  }

  // ---- tool set control (implemented by the Agent) ----

  private activeToolsProvider: () => string[] = () => []
  private allToolsProvider: () => string[] = () => []
  private setActiveToolsImpl: (names: string[]) => void = () => {}
  private setModelImpl: (spec: string) => void = () => {}

  bindToolControl(
    getActiveTools: () => string[],
    getAllTools: () => string[],
    setActiveTools: (names: string[]) => void,
    setModel: (spec: string) => void,
  ) {
    this.activeToolsProvider = getActiveTools
    this.allToolsProvider = getAllTools
    this.setActiveToolsImpl = setActiveTools
    this.setModelImpl = setModel
  }

  getDynamicTools(): ExtensionToolDefinition[] {
    return [...this.dynamicTools.values()]
  }

  getCommands(): RegisteredCommand[] {
    return [...this.commands.values()]
  }

  private getActiveTools() {
    return this.activeToolsProvider()
  }
  private getAllTools() {
    return this.allToolsProvider()
  }
  private setActiveTools(names: string[]) {
    this.setActiveToolsImpl(names)
  }
  private setModel(spec: string) {
    this.setModelImpl(spec)
  }
}
