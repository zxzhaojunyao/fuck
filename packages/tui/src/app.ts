import {
  ProcessTerminal,
  TuiAltScreen,
  Container,
  ScrollView,
  VStack,
  HStack,
  Editor,
  SelectList,
  Text,
  Markdown,
  CombinedAutocompleteProvider,
  matchesKey,
  Key,
  type TUI,
  type ViewportTUI,
  type OverlayHandle,
  type SelectItem,
} from "@earendil-works/pi-tui"
import { currentModel, listModels, setModel } from "@fuck/config"
import { listSessions, deleteSession, contextTokens, type AgentEvent, type AgentMessage } from "@fuck/agent"
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { createRuntime } from "./runtime"
import { createUIContext } from "./ext-ui"
import { buildTheme, themeNames } from "./theme"
import { Message } from "./components/message"
import { ToolCard } from "./components/tool-card"
import { DelegateCard } from "./components/delegate-card"
import { TodoSection, SubagentListSection, SubagentDetail, type SubagentRecord, type TodoLine } from "./components/sidebar"
import { StatusBar } from "./components/status-bar"
import { ModelPicker } from "./components/model-picker"

const SLASH_COMMANDS = [
  { name: "help", description: "show help" },
  { name: "models", description: "switch model" },
  { name: "themes", description: "switch theme" },
  { name: "sessions", description: "switch/resume session" },
  { name: "findings", description: "view findings" },
  { name: "exit", description: "exit" },
]

export async function runApp(cwd: string, resumeId?: string) {
  let theme = buildTheme("tokyo")

  const terminal = new ProcessTerminal()
  // openUrl handles OSC 8 hyperlink clicks (e.g. sidebar sub-agent rows)
  let handleOpenUrl: (url: string) => void = () => {}
  const tui: TUI & ViewportTUI = new TuiAltScreen(terminal, false, undefined, {
    mouse: true,
    copyOnSelect: true,
    openUrl: (url) => handleOpenUrl(url),
  })

  // ---- component tree ----
  const transcript = new Container()
  const scrollView = new ScrollView(transcript, { follow: "end", primary: true, overscroll: "chain" })
  const editor = new Editor(tui, theme.editor, { paddingX: 1 })
  const statusBar = new StatusBar(currentModel(), theme)

  editor.setAutocompleteProvider(new CombinedAutocompleteProvider(SLASH_COMMANDS, cwd))

  const mainColumn = new VStack([
    { component: scrollView, basis: 0, grow: 1, minSize: 1 },
    { component: editor, basis: "auto", shrink: 1, minSize: 1 },
    { component: statusBar, basis: "auto", shrink: 1, minSize: 1 },
  ])

  // sub-agent registry (across delegate calls) + todo provider, for the sidebar
  const subagents = new Map<string, SubagentRecord>()
  let subagentOrder = 0
  let selectedKey: string | null = null
  const storeHolder: { store: Awaited<ReturnType<typeof createRuntime>>["store"] | null } = { store: null }
  const getTodos = (): TodoLine[] => {
    const entries = (storeHolder.store?.readCustom("todo.state") ?? []) as { todos?: { status: string; content: string }[] }[]
    const last = entries.at(-1)?.todos ?? []
    return last.map((t) => ({ status: t.status as TodoLine["status"], content: t.content }))
  }
  // only running sub-agents are listed; finished ones drop out (result lives in the body)
  const getRunningSubagents = (): SubagentRecord[] =>
    [...subagents.values()].filter((s) => s.status === "running").sort((a, b) => a.order - b.order)

  const todoSection = new TodoSection(theme, getTodos)
  const listSection = new SubagentListSection(theme, getRunningSubagents)
  const detailContent = new SubagentDetail(theme, () => (selectedKey ? subagents.get(selectedKey) : undefined))
  const detailScroll = new ScrollView(detailContent, { follow: "none", overscroll: "contain" })

  const sidebarStack = new VStack([
    { component: todoSection, basis: "auto", shrink: 1 },
    { component: listSection, basis: "auto", shrink: 1 },
    { component: detailScroll, basis: 0, grow: 1, minSize: 1, visible: () => selectedKey !== null },
  ])

  let sidebarVisible = true
  const rebuildLayout = () => {
    if (sidebarVisible) {
      tui.setLayoutRoot(
        new HStack([
          { component: mainColumn, basis: 0, grow: 1, minSize: 1 },
          { component: sidebarStack, basis: 42, grow: 0, shrink: 0, minSize: 42 },
        ])
      )
    } else {
      tui.setLayoutRoot(mainColumn)
    }
    tui.requestRender()
  }
  rebuildLayout()

  const ui = createUIContext(tui, theme, () => tui.setFocus(editor))

  let runtime = await createRuntime(cwd, resumeId, ui)
  let agent = runtime.agent
  let store = runtime.store
  let extensions = runtime.extensions
  storeHolder.store = store

  // ---- streaming state ----
  let draft: Message | null = null
  let draftBuf = ""
  let running = false
  let activeTool: ToolCard | null = null
  let activeDelegate: DelegateCard | null = null
  let lastDelegate: DelegateCard | null = null
  let spinnerTimer: ReturnType<typeof setInterval> | null = null

  const requestRender = () => tui.requestRender()

  const startSpinner = () => {
    statusBar.running = true
    spinnerTimer = setInterval(() => {
      statusBar.frame++
      requestRender()
    }, 120)
  }
  const stopSpinner = () => {
    statusBar.running = false
    if (spinnerTimer) clearInterval(spinnerTimer)
    spinnerTimer = null
    requestRender()
  }

  // ---- history rendering ----
  function renderHistory(messages: AgentMessage[]) {
    transcript.clear()
    for (const m of messages) {
      if (m.role === "user") {
        transcript.addChild(new Message("user", m.content, theme))
      } else if (m.role === "assistant") {
        if (m.content) transcript.addChild(new Message("assistant", m.content, theme))
      } else if (m.role === "tool") {
        const card = new ToolCard(m.toolName, "", theme)
        card.setResult(m.content)
        transcript.addChild(card)
      }
    }
    if (messages.length === 0) {
      transcript.addChild(new Text(theme.dim("AI agent - type a message to start, /help for commands"), 1, 1))
    }
    requestRender()
  }

  // ---- event handling (render + persist) ----
  function handleEvent(e: AgentEvent) {
    switch (e.type) {
      case "message_start":
        draftBuf = ""
        if (draft) {
          // retry/restart: reset the existing draft instead of adding a duplicate
          draft.setContent("")
        } else {
          draft = new Message("assistant", "", theme)
          transcript.addChild(draft)
        }
        requestRender()
        break
      case "message_delta":
        draftBuf += e.text
        if (!draft) {
          draft = new Message("assistant", "", theme)
          transcript.addChild(draft)
        }
        draft.setContent(draftBuf)
        requestRender()
        break
      case "message_end":
        if (draft && !draftBuf && e.message.content) {
          draft.setContent(e.message.content)
        }
        if (e.message.content || (e.message.toolCalls && e.message.toolCalls.length > 0)) {
          store.append(e.message)
        }
        draft = null
        draftBuf = ""
        requestRender()
        break
      case "tool_start":
        if (e.toolCall.name === "delegate") {
          activeDelegate = new DelegateCard(theme)
          lastDelegate = activeDelegate
          transcript.addChild(activeDelegate)
        } else {
          activeTool = new ToolCard(e.toolCall.name, JSON.stringify(e.toolCall.arguments), theme)
          transcript.addChild(activeTool)
        }
        requestRender()
        break
      case "tool_delta":
        if (activeTool) {
          activeTool.result = (activeTool.result || "") + e.text
          requestRender()
        }
        break
      case "delegate_event":
        // update the persistent sub-agent registry (for the sidebar) + the inline card
        {
          const key = `${e.toolCallId}:${e.event.index}`
          let rec = subagents.get(key)
          if (!rec) {
            rec = { key, title: "", status: "running", body: "", order: subagentOrder++ }
            subagents.set(key, rec)
          }
          switch (e.event.type) {
            case "task_start":
              rec.title = e.event.title
              break
            case "task_message":
              if (rec.body.length < 40000) rec.body += e.event.text
              break
            case "task_tool_start":
              if (rec.body.length < 40000) rec.body += `\n  [tool] ${e.event.name} ${e.event.args}\n`
              break
            case "task_tool_delta":
              if (rec.body.length < 40000) rec.body += e.event.text
              break
            case "task_tool_end":
              if (rec.body.length < 40000) rec.body += "\n  [done]\n"
              break
            case "task_result":
              rec.status = "done"
              rec.result = e.event.result
              break
            case "task_error":
              rec.status = "error"
              rec.error = e.event.message
              break
          }
        }
        if (activeDelegate) {
          activeDelegate.apply(e.event)
        }
        requestRender()
        break
      case "tool_end":
        if (activeDelegate) {
          activeDelegate.markDone(e.result.content)
          activeDelegate = null
        }
        if (activeTool) {
          activeTool.setResult(e.result.content)
          activeTool = null
        }
        store.append(e.result)
        requestRender()
        break
      case "agent_end":
        draft = null
        draftBuf = ""
        activeTool = null
        running = false
        stopSpinner()
        break
      case "error":
        running = false
        stopSpinner()
        transcript.addChild(new Text("error: " + e.error.message, 1, 0))
        requestRender()
        break
    }
  }

  let unsubscribe = agent.events.subscribe(handleEvent)

  // ---- session switch ----
  async function switchSession(id: string) {
    agent.shutdownSession("resume")
    agent.abort()
    unsubscribe()
    runtime = await createRuntime(cwd, id, ui)
    agent = runtime.agent
    store = runtime.store
    extensions = runtime.extensions
    storeHolder.store = store
    draft = null
    draftBuf = ""
    activeTool = null
    activeDelegate = null
    subagents.clear()
    selectedKey = null
    running = false
    stopSpinner()
    renderHistory(store.load())
    unsubscribe = agent.events.subscribe(handleEvent)
    agent.startSession("resume")
  }

  // ---- input submit ----
  editor.onSubmit = (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (trimmed.startsWith("/")) {
      handleCommand(trimmed)
      editor.setText("")
      return
    }
    editor.addToHistory(text)
    store.append({ role: "user", content: trimmed })
    transcript.addChild(new Message("user", trimmed, theme))
    running = true
    startSpinner()
    editor.setText("")
    void agent.send(trimmed).catch(() => {})
  }

  // ---- commands ----
  let overlay: OverlayHandle | null = null
  let sessionPicker: { selectedId: string } | null = null
  function closeOverlay() {
    if (overlay) {
      overlay.hide()
      overlay = null
    }
    sessionPicker = null
    tui.setFocus(editor)
  }

  // OSC 8 hyperlink click handler: toggle a sub-agent's detail view below the list
  handleOpenUrl = (url: string) => {
    if (url.startsWith("fuck://subagent/")) {
      const key = decodeURIComponent(url.slice("fuck://subagent/".length))
      if (subagents.has(key)) {
        selectedKey = selectedKey === key ? null : key
        requestRender()
      }
    }
  }

  function openSessions() {
    const metas = listSessions()
    const items: SelectItem[] = metas.map((m) => ({
      value: m.id,
      label: m.title || "(empty)",
      description: m.id === store.id ? "current" : undefined,
    }))
    const list = new SelectList(items, 15, theme.selectList)
    sessionPicker = { selectedId: metas[0]?.id ?? "" }
    list.onSelectionChange = (item) => {
      sessionPicker = { selectedId: item.value }
    }
    list.onSelect = (item) => {
      closeOverlay()
      if (item.value !== store.id) switchSession(item.value)
    }
    list.onCancel = closeOverlay
    overlay = tui.showOverlay(list, { width: 70, maxHeight: 18 })
  }

  function handleCommand(cmd: string) {
    const name = cmd.slice(1).split(/\s+/)[0]
    switch (name) {
      case "help": {
        const help = new Container()
        help.addChild(
          new Text(
            theme.role("FUCK — help") +
              "\n" +
              theme.statusText("Commands: /help /models /themes /sessions /exit\nKeys: Ctrl+C quit · Escape interrupt · Enter send · Shift+Enter newline · Tab complete · @file reference"),
            1,
            1
          )
        )
        overlay = tui.showOverlay(help, { width: 70, maxHeight: 12 })
        break
      }
      case "models": {
        void listModels().then((models) => {
          const picker = new ModelPicker(models, currentModel(), theme)
          picker.onSelect = (spec) => {
            setModel(spec)
            statusBar.model = spec
            closeOverlay()
          }
          picker.onCancel = closeOverlay
          overlay = tui.showOverlay(picker, { width: 76, maxHeight: 24 })
          tui.setFocus(picker)
        })
        break
      }
      case "themes": {
        const items: SelectItem[] = themeNames().map((n) => ({ value: n, label: n }))
        const list = new SelectList(items, 10, theme.selectList)
        list.onSelect = (item) => {
          theme = buildTheme(item.value)
          closeOverlay()
        }
        list.onCancel = closeOverlay
        overlay = tui.showOverlay(list, { width: 40, maxHeight: 12 })
        break
      }
      case "sessions": {
        openSessions()
        break
      }
      case "findings": {
        const dir = join(homedir(), ".fuck", "findings")
        const files = existsSync(dir)
          ? readdirSync(dir).filter((f) => f.endsWith(".md"))
          : []
        if (files.length === 0) {
          const empty = new Container()
          empty.addChild(new Text(theme.dim("No findings yet. Run the findings skill to audit; results land in ~/.fuck/findings/"), 1, 1))
          overlay = tui.showOverlay(empty, { width: 60, maxHeight: 8 })
          break
        }
        const items: SelectItem[] = files.map((f) => ({ value: f, label: f.replace(/\.md$/, "") }))
        const list = new SelectList(items, 15, theme.selectList)
        list.onSelect = (item) => {
          closeOverlay()
          const content = readFileSync(join(dir, item.value), "utf8").slice(0, 4000)
          // defer the detail overlay to the next tick to avoid re-entrant overlay handling inside onSelect
          setTimeout(() => {
            const view = new Container()
            view.addChild(new Text(theme.role("findings: " + item.value), 1, 1))
            view.addChild(new Markdown(content, 1, 0, theme.markdown, { color: theme.assistant }))
            overlay = tui.showOverlay(view, { width: 80, maxHeight: 30 })
          }, 0)
        }
        list.onCancel = closeOverlay
        overlay = tui.showOverlay(list, { width: 70, maxHeight: 18 })
        break
      }
      case "exit":
        agent.shutdownSession("quit")
        tui.stop()
        process.exit(0)
        break
      default: {
        // commands registered by extensions (registerCommand)
        const found = extensions.getCommands().find((c) => c.name === name)
        if (found) {
          const args = cmdNameArgs(cmd)
          const ctx = extensionCtx(extensions)
          void Promise.resolve(found.handler(args, ctx))
        }
      }
    }
  }

  function cmdNameArgs(cmd: string): string {
    const i = cmd.indexOf(" ")
    return i === -1 ? "" : cmd.slice(i + 1)
  }

  function extensionCtx(ext: typeof extensions) {
    return {
      cwd,
      ui,
      model: currentModel(),
      sessionId: store.id,
      appendEntry: (customType: string, data?: unknown) => store.appendCustom(customType, data),
      readCustomEntries: (customType: string) => store.readCustom(customType),
      sendUserMessage: (content: string) => void agent.send(content),
      getContextUsage: () => ({ tokens: contextTokens(agent.messages) }),
      abort: () => agent.abort(),
      isIdle: () => agent.status === "idle",
    }
  }

  // ---- global keyboard ----
  tui.addInputListener((data) => {
    if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.ctrl("q"))) {
      tui.stop()
      process.exit(0)
      return { consume: true }
    }
    // while the session list is open, Ctrl+D deletes the selected session
    if (matchesKey(data, Key.ctrl("d")) && sessionPicker?.selectedId) {
      const targetId = sessionPicker.selectedId
      void (async () => {
        const ok = await ui.confirm("Delete session", "Delete this session? This cannot be undone.")
        if (ok) {
          const wasCurrent = targetId === store.id
          deleteSession(targetId)
          if (wasCurrent) {
            // deleting the current session: switch to a new one
            agent.shutdownSession("new")
            agent.abort()
            unsubscribe()
            runtime = await createRuntime(cwd, undefined, ui)
            agent = runtime.agent
            store = runtime.store
            extensions = runtime.extensions
            storeHolder.store = store
            draft = null
            draftBuf = ""
            activeTool = null
            activeDelegate = null
            subagents.clear()
            running = false
            stopSpinner()
            renderHistory([])
            unsubscribe = agent.events.subscribe(handleEvent)
            agent.startSession("new")
          }
          // close and reopen the list to refresh after deletion
          closeOverlay()
          openSessions()
        }
      })()
      return { consume: true }
    }
    if (matchesKey(data, Key.escape)) {
      if (overlay) {
        closeOverlay()
        return { consume: true }
      }
      if (running) {
        agent.abort()
        running = false
        stopSpinner()
        return { consume: true }
      }
    }
    // Ctrl+E: toggle expand/collapse of the most recent delegate card
    if (matchesKey(data, Key.ctrl("e")) && lastDelegate) {
      lastDelegate.toggleAll()
      requestRender()
      return { consume: true }
    }
    // Ctrl+B: toggle the right sidebar
    if (matchesKey(data, Key.ctrl("b"))) {
      sidebarVisible = !sidebarVisible
      rebuildLayout()
      return { consume: true }
    }
    // Ctrl+1..9: toggle an individual sub-agent section (only when a delegate card exists)
    if (lastDelegate) {
      const digitKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const
      for (let i = 0; i < digitKeys.length; i++) {
        if (matchesKey(data, Key.ctrl(digitKeys[i]))) {
          lastDelegate.toggle(i)
          requestRender()
          return { consume: true }
        }
      }
    }
    return undefined
  })

  // render history (or welcome) at startup
  renderHistory(store.load())

  tui.setFocus(editor)
  tui.start()
}
