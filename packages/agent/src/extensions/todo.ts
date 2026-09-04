import { z } from "zod"
import type { ExtensionAPI, ExtensionContext, ExtensionToolDefinition } from "../extension/types"

// ---- built-in todo extension ----

const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const
const PRIORITIES = ["high", "medium", "low"] as const
type Status = (typeof STATUSES)[number]
type Priority = (typeof PRIORITIES)[number]

type TodoItem = {
  id?: string
  content: string
  status: Status
  priority: Priority
}

const STATE_TYPE = "todo.state"
const MAX_ITEMS = 200
const MAX_CONTENT = 500

// ---- state store (in-memory + appendEntry persistence + session_start replay) ----

function marker(status: Status): string {
  switch (status) {
    case "completed":
      return "[✓]"
    case "in_progress":
      return "[•]"
    case "cancelled":
      return "[×]"
    default:
      return "[ ]"
  }
}

function line(t: TodoItem): string {
  return `${marker(t.status)} ${t.id ? t.id + " " : ""}${t.content}`
}

function formatList(todos: TodoItem[], summary: string): string {
  if (todos.length === 0) return summary
  return [summary, ...todos.map(line)].join("\n")
}

function nextShortId(used: Set<string>): string {
  let n = 1
  while (used.has(`t${n}`)) n++
  return `t${n}`
}

function sanitize(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim()
}

function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v)
}
function isPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as readonly string[]).includes(v)
}

// ---- validation ----

type ValidateResult =
  | { ok: true; todos: TodoItem[]; unchanged: boolean }
  | { ok: false; error: string }

function validateWrite(raw: unknown, current: TodoItem[]): ValidateResult {
  if (!Array.isArray(raw)) return { ok: false, error: "todos must be an array" }
  if (raw.length > MAX_ITEMS) return { ok: false, error: `at most ${MAX_ITEMS} items` }

  const currentIds = new Set(current.map((t) => t.id).filter(Boolean) as string[])
  const todos: TodoItem[] = []
  let inProgress = 0

  for (let i = 0; i < raw.length; i++) {
    const rec = raw[i] as Record<string, unknown>
    if (!rec || typeof rec !== "object") return { ok: false, error: `todos[${i}] must be an object` }
    if (typeof rec.content !== "string") return { ok: false, error: `todos[${i}].content must be a string` }
    let content = sanitize(rec.content)
    if (!content) return { ok: false, error: `todos[${i}].content must not be empty` }
    if (content.length > MAX_CONTENT) content = content.slice(0, MAX_CONTENT - 1) + "…"
    if (!isStatus(rec.status)) return { ok: false, error: `todos[${i}].status must be one of ${STATUSES.join("/")}` }
    if (!isPriority(rec.priority)) return { ok: false, error: `todos[${i}].priority must be one of ${PRIORITIES.join("/")}` }
    if (rec.status === "in_progress") inProgress++

    let id: string | undefined
    if (rec.id !== undefined) {
      if (typeof rec.id !== "string" || !rec.id.trim()) return { ok: false, error: `todos[${i}].id must be a non-empty string` }
      id = currentIds.has(rec.id) ? rec.id : undefined
    }
    todos.push({ ...(id ? { id } : {}), content, status: rec.status as Status, priority: rec.priority as Priority })
  }

  if (inProgress > 1) return { ok: false, error: `only one in_progress is allowed (currently ${inProgress})` }

  const unchanged =
    todos.length === current.length &&
    todos.every(
      (t, i) =>
        t.id === current[i].id &&
        t.content === current[i].content &&
        t.status === current[i].status &&
        t.priority === current[i].priority,
    )

  return { ok: true, todos, unchanged }
}

function ensureIds(todos: TodoItem[], current: TodoItem[]): TodoItem[] {
  const currentIds = new Set(current.map((t) => t.id).filter(Boolean) as string[])
  const used = new Set<string>()
  return todos.map((t) => {
    if (t.id) {
      used.add(t.id)
      return t
    }
    const id = nextShortId(new Set([...used, ...currentIds]))
    used.add(id)
    return { ...t, id }
  })
}

function validateUpdate(raw: unknown, current: TodoItem[]): ValidateResult {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "updates must be a non-empty array" }
  const next = current.map((t) => ({ ...t }))
  for (let i = 0; i < raw.length; i++) {
    const rec = raw[i] as Record<string, unknown>
    if (!rec || typeof rec !== "object") return { ok: false, error: `updates[${i}] must be an object` }
    if (typeof rec.id !== "string" || !rec.id) return { ok: false, error: `updates[${i}].id must be a non-empty string` }
    const target = next.find((t) => t.id === rec.id)
    if (!target) return { ok: false, error: `updates[${i}].id "${rec.id}" not found; current IDs: ${current.map((t) => t.id).join(", ")}` }
    if (rec.content !== undefined) target.content = rec.content as string
    if (rec.status !== undefined) {
      if (!isStatus(rec.status)) return { ok: false, error: `status must be one of ${STATUSES.join("/")}` }
      target.status = rec.status as Status
    }
    if (rec.priority !== undefined) {
      if (!isPriority(rec.priority)) return { ok: false, error: `priority must be one of ${PRIORITIES.join("/")}` }
      target.priority = rec.priority as Priority
    }
  }
  // single in_progress constraint
  const inProgress = next.filter((t) => t.status === "in_progress").length
  if (inProgress > 1) return { ok: false, error: `only one in_progress is allowed` }
  return { ok: true, todos: next, unchanged: false }
}

// ---- zod schema ----

const todoItemSchema = z.object({
  id: z.string().optional().describe("stable ID of an existing todo; omit for new items"),
  content: z.string().describe("brief task description"),
  status: z.enum(STATUSES).describe("pending | in_progress | completed | cancelled"),
  priority: z.enum(PRIORITIES).describe("high | medium | low"),
})

// ---- extension factory ----

export function createTodoExtension(): (pi: ExtensionAPI) => void {
  return function (pi: ExtensionAPI) {
    let todos: TodoItem[] = []

    const persist = (next: TodoItem[]) => {
      pi.appendEntry(STATE_TYPE, { todos: next })
    }

    const commit = (next: TodoItem[]) => {
      todos = next
      persist(next)
    }

    const writeTool: ExtensionToolDefinition = {
      name: "todo_write",
      description:
        "Replace the whole session todo list (full replace). Use it to track multi-step work. Fill in id only for existing items, omit it for new ones. Only one in_progress is allowed.",
      schema: z.object({
        todos: z.array(todoItemSchema).max(MAX_ITEMS).describe("complete todo list (full replace)"),
      }),
      execute: async (args) => {
        const result = validateWrite(args.todos, todos)
        if (!result.ok) return `Error: ${result.error}`
        const next = ensureIds(result.todos, todos)
        const open = next.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
        if (!result.unchanged) commit(next)
        return result.unchanged
          ? "No change"
          : formatList(next, `${open} open / ${next.length} total`)
      },
    }

    const readTool: ExtensionToolDefinition = {
      name: "todo_read",
      description: "read the current session todo list",
      schema: z.object({}),
      execute: async () => {
        if (todos.length === 0) return "No todos"
        const open = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
        return `${formatList(todos, `${open} open / ${todos.length} total`)}\n\n${JSON.stringify(todos, null, 2)}`
      },
    }

    const updateTool: ExtensionToolDefinition = {
      name: "todo_update",
      description:
        "Partially update existing todos by stable ID (t1/t2...), without replacing the whole list. id must exactly match a current todo (copy it from todo_read), never guess. This tool never deletes entries.",
      schema: z.object({
        updates: z
          .array(
            z.object({
              id: z.string().min(1).describe("stable ID of an existing todo"),
              content: z.string().optional(),
              status: z.enum(STATUSES).optional(),
              priority: z.enum(PRIORITIES).optional(),
            })
          )
          .min(1)
          .max(MAX_ITEMS),
      }),
      execute: async (args) => {
        const result = validateUpdate(args.updates, todos)
        if (!result.ok) return `Error: ${result.error}`
        commit(result.todos)
        const open = result.todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
        return `Updated ${(args.updates as unknown[]).length} todo(s)\n\n${formatList(result.todos, `${open} open / ${result.todos.length} total`)}`
      },
    }

    const diagnoseTool: ExtensionToolDefinition = {
      name: "todo_diagnose",
      description: "diagnose todo persistence state (read-only)",
      schema: z.object({}),
      execute: async () => {
        const durable = pi.readCustomEntries(STATE_TYPE).map((d) => (d as { todos?: TodoItem[] }).todos ?? [])
        const last = durable.at(-1) ?? []
        const ids = new Set<string>()
        const issues: string[] = []
        for (const t of todos) {
          if (!t.id) issues.push(`missing ID: ${t.content}`)
          else if (ids.has(t.id)) issues.push(`duplicate ID: ${t.id}`)
          else ids.add(t.id)
        }
        const mismatch =
          todos.length !== last.length ||
          todos.some((t, i) => t.id !== last[i]?.id || t.status !== last[i]?.status)
        const status = issues.length ? "repair_needed" : mismatch ? "mismatch" : "consistent"
        return `persistence check: ${status === "consistent" ? "consistent" : status === "repair_needed" ? "REPAIR NEEDED" : "MISMATCH"}\nissues: ${issues.join("; ") || "none"}`
      },
    }

    pi.registerTool(writeTool)
    pi.registerTool(readTool)
    pi.registerTool(updateTool)
    pi.registerTool(diagnoseTool)

    pi.registerCommand("todo", {
      description: "view the current todo list",
      handler: async (_args, ctx) => {
        const open = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
        const text = todos.length === 0 ? "No todos" : formatList(todos, `${open} open / ${todos.length} total`)
        ctx.ui.notify(text, "info")
      },
    })

    // session_start: replay persisted state
    pi.on("session_start", () => {
      const durable = pi.readCustomEntries(STATE_TYPE).map((d) => (d as { todos?: TodoItem[] }).todos ?? [])
      todos = durable.at(-1) ?? []
    })

    // context hook: inject a light reminder when there are open tasks
    pi.on("context", (event) => {
      const open = todos.filter((t) => t.status === "pending" || t.status === "in_progress")
      if (open.length === 0) return
      const reminder = `[todo reminder] ${open.length} open task(s):\n${open.map(line).join("\n")}\nKeep going; mark them done with todo_update.`
      return { messages: [...event.messages, { role: "user" as const, content: reminder }] }
    })
  }
}
