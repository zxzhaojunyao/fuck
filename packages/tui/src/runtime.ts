import {
  Agent,
  createModelAdapter,
  createDelegateTool,
  GraphStore,
  createGraphTools,
  buildSystemPrompt,
  listSkills,
  createSkillHook,
  createErrorMemoryHook,
  createPermissionGateHook,
  createSandboxHook,
  sandboxPrefixFromConfig,
  composeHooks,
  composeTurnHooks,
  contextTokens,
  SessionStore,
  ExtensionManager,
  loadExtensionFactories,
  createTodoExtension,
  createGoalTest,
} from "@fuck/agent"
import type { ExtensionUIContext } from "@fuck/agent"
import { createCodingTools, createWebTools } from "@fuck/coding"
import { getModel, resolveModel, currentModel, readConfig, setModel } from "@fuck/config"

// compaction thresholds: derived from the model's declared context window,
// overridable via config.json (COMPACTION_MAX_TOKENS / COMPACTION_KEEP_RECENT_TOKENS).
// When no context window is known, fall back to a CONSERVATIVE 128K — never 512K:
// a too-large threshold means compaction never fires and the context blows up past
// the real model window, making the model hallucinate/loop and eventually stop.
function compactionThresholds(resolved: ReturnType<typeof resolveModel>) {
  const cfg = readConfig()
  const declared = resolved.contextWindow ?? (cfg.CONTEXT_WINDOW as number | undefined) ?? 128_000
  const maxTokens =
    (cfg.COMPACTION_MAX_TOKENS as number | undefined) ?? Math.floor(declared * 0.6)
  const keepRecentTokens =
    (cfg.COMPACTION_KEEP_RECENT_TOKENS as number | undefined) ?? Math.floor(declared * 0.15)
  return { maxTokens, keepRecentTokens }
}

// assemble runtime: config model + coding tools + persona system prompt + error memory + session persistence + extensions + auto-compaction
export async function createRuntime(
  cwd: string,
  sessionId: string | undefined,
  ui: ExtensionUIContext,
) {
  const skills = listSkills(cwd)
  const system = buildSystemPrompt({ cwd, skills })
  const resolved = resolveModel(currentModel())
  const model = getModel()
  const adapter = createModelAdapter(model, { maxOutputTokens: resolved.maxTokens })

  const store = new SessionStore(sessionId)
  // shared semantic graph (blackboard) — tied to this session, shared by main agent + delegates
  const graph = new GraphStore(store.id)
  const baseTools = [...createCodingTools({ cwd }), ...createWebTools(), ...createGraphTools(graph)]

  // tool hooks: permission-gate on by default, sandbox routing via config.SANDBOX_CMD
  const hook = composeHooks(
    createPermissionGateHook(),
    createSandboxHook(sandboxPrefixFromConfig(readConfig), () => cwd),
  )

  const extensions = new ExtensionManager()

  // auto-compaction: summarize older context when it grows past the threshold.
  const { maxTokens, keepRecentTokens } = compactionThresholds(resolved)
  const compaction = {
    maxTokens,
    keepRecentTokens,
    summarize: (messages: Parameters<typeof adapter.summarize>[0]) =>
      adapter.summarize(
        messages,
        "Summarize the conversation so far. Preserve all important facts, decisions, findings, file operations, credentials/flag values, and open questions. Be concise but lossless for anything that matters to the task.",
      ),
  }
  const turnHook = composeTurnHooks(createErrorMemoryHook(), createSkillHook(skills))

  // delegate: fan-out parallel sub-agents (shared model + hooks + compaction, isolated context)
  // maxTasks is dynamic (config.DELEGATE_MAX_TASKS), so CTF can inject the platform's slot limit.
  const maxTasks = (readConfig().DELEGATE_MAX_TASKS as number | undefined) ?? 10
  const delegate = createDelegateTool({
    adapter,
    system,
    tools: baseTools,
    hook,
    turnHook,
    compaction,
    maxTasks,
  })
  const tools = [...baseTools, delegate]

  const agent = new Agent(
    {
      model: adapter,
      system,
      tools,
      hook,
      turnHook,
      extensions,
      compaction,
      // per-scene goal-test: config.GOAL_MODE selects the completion check (none/ctf/coding)
      goalTest: createGoalTest((readConfig().GOAL_MODE as string) ?? "none"),
    },
    store.id,
  )
  // restore history messages into context
  agent.seed(store.load())

  // bind extension ctx + tool control
  extensions.bindContext({
    cwd,
    ui,
    model: currentModel(),
    sessionId: store.id,
    appendEntry: (customType, data) => store.appendCustom(customType, data),
    readCustomEntries: (customType) => store.readCustom(customType),
    sendUserMessage: (content) => void agent.send(content),
    getContextUsage: () => ({ tokens: contextTokens(agent.messages) }),
    abort: () => agent.abort(),
    isIdle: () => agent.status === "idle",
  })
  extensions.bindToolControl(
    () => agent.getActiveTools(),
    () => agent.getAllTools(),
    (names) => agent.setActiveTools(names),
    (spec) => setModel(spec),
  )

  // load extension modules async (built-in todo + disk discovery)
  const factories = await loadExtensionFactories(cwd)
  factories.unshift(async () => createTodoExtension())
  await extensions.load(factories)

  return { agent, tools, store, extensions, graph }
}
