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
  // Non-destructive + incremental: each summary is merged into the previous one,
  // so no instruction or finding is ever lost — only the view sent to the model
  // shrinks (see harness/compaction.ts).
  const { maxTokens, keepRecentTokens } = compactionThresholds(resolved)
  const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Important Details
- [constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue, or "(none)"]

## Work State
### Completed
- [finished work, verified facts, or changes made; otherwise "(none)"]

### Active
- [current work, partial changes, or investigation state; otherwise "(none)"]

### Blocked
- [blockers, failing commands, or unknowns; otherwise "(none)"]

## Next Move
1. [immediate concrete action, or "(none)"]
2. [next action if known, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Do not mention the summary process or that context was compacted.
- The user's original instructions and constraints MUST be preserved verbatim.`

  const summarize = (messages: Parameters<typeof adapter.summarize>[0]) =>
    adapter.summarize(
      messages,
      "Create a summary from the conversation so another coding agent can continue the work. The user's original task and every instruction/constraint MUST be preserved verbatim.\n\n" +
        SUMMARY_TEMPLATE,
    )
  const updateSummary = (previous: string, messages: Parameters<typeof adapter.summarize>[0]) =>
    adapter.summarize(
      messages,
      `You are merging a running summary with new conversation into a single new summary.

<prior-summary>
${previous}
</prior-summary>

The <prior-summary> summarizes everything that happened before the new conversation. Construct a new summary that combines both. The <prior-summary> is discarded after this: anything you do not carry into the new summary is lost.

When combining:
- Carry forward objectives, constraints, user directives, decisions, and parallel workstreams from the <prior-summary> even when the new conversation does not mention them. Drop only what is finished and no longer needed.
- The new conversation is more recent than the <prior-summary>. Where they conflict, the conversation wins: state the corrected fact and drop the old claim.
- Add new progress, decisions, constraints, and context from the conversation.
- Move completed work from "Active" to "Completed".
- If a blocker has been resolved, update the summary to reflect that while keeping any details still needed to continue the work.
- Update "Objective" and "Next Move" to reflect the current work state.

` + SUMMARY_TEMPLATE,
    )
  const compaction = { maxTokens, keepRecentTokens, summarize, updateSummary }
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
