import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { AgentMessage } from "../types"

// ---- JSONL session tree ----

export type SessionEntry = {
  id: string
  parentId: string | null
  seq: number
  type: "message" | "model_change" | "compaction" | "branch_summary" | "custom"
  data: unknown
}

export type SessionMeta = {
  id: string
  cwd: string
  title: string
  createdAt: number
  updatedAt: number
}

function sessionRoot(): string {
  const dir = process.env.FUCK_HOME ?? join(homedir(), ".fuck")
  return join(dir, "sessions")
}

function sessionFile(id: string): string {
  return join(sessionRoot(), `${id}.jsonl`)
}

export function newSessionId(): string {
  return crypto.randomUUID()
}

// append an entry (append-only, natural event stream)
export function appendEntry(id: string, entry: SessionEntry) {
  const file = sessionFile(id)
  mkdirSync(sessionRoot(), { recursive: true })
  appendFileSync(file, JSON.stringify(entry) + "\n", "utf8")
}

// read all entries of a session (sorted by seq)
export function readEntries(id: string): SessionEntry[] {
  const file = sessionFile(id)
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as SessionEntry)
    .sort((a, b) => a.seq - b.seq)
}

// reconstruct the message sequence from the entry tree (walk parentId to root, message type only)
export function entriesToMessages(id: string): AgentMessage[] {
  const entries = readEntries(id)
  const byId = new Map(entries.map((e) => [e.id, e]))
  const out: AgentMessage[] = []
  // find the leaf (no entry references it as parent) as the current tip
  const hasChild = new Set(entries.filter((e) => e.parentId).map((e) => e.parentId!))
  const leaf = entries.find((e) => !hasChild.has(e.id)) ?? entries.at(-1)
  if (!leaf) return []
  let cur: SessionEntry | undefined = leaf
  const chain: SessionEntry[] = []
  while (cur) {
    chain.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  for (const e of chain) {
    if (e.type === "message" && (e.data as { role?: string })?.role) {
      out.push(e.data as AgentMessage)
    }
  }
  return out
}

// branch: derive a new leaf under a given entry (returns the new leaf id)
export function branchFrom(id: string, parentEntryId: string, message: AgentMessage): string {
  const parent = readEntries(id).find((e) => e.id === parentEntryId)
  if (!parent) return ""
  const seq = (readEntries(id).at(-1)?.seq ?? 0) + 1
  const entry: SessionEntry = {
    id: crypto.randomUUID(),
    parentId: parentEntryId,
    seq,
    type: "message",
    data: message,
  }
  appendEntry(id, entry)
  return entry.id
}

// delete a session file
export function deleteSession(id: string): boolean {
  const file = sessionFile(id)
  if (!existsSync(file)) return false
  unlinkSync(file)
  return true
}

// session metadata
const META_FILE = "meta.json"

export function saveMeta(meta: SessionMeta) {
  mkdirSync(sessionRoot(), { recursive: true })
  writeFileSync(join(sessionRoot(), META_FILE), JSON.stringify(meta, null, 2), "utf8")
}

export function listSessions(): SessionMeta[] {
  const root = sessionRoot()
  if (!existsSync(root)) return []
  const out: SessionMeta[] = []
  for (const f of readdirSync(root)) {
    if (!f.endsWith(".jsonl")) continue
    const id = f.replace(/\.jsonl$/, "")
    const entries = readEntries(id)
    const first = entries.find((e) => e.type === "message")
    const firstText = (first?.data as { content?: string })?.content ?? "(empty)"
    out.push({
      id,
      cwd: "",
      title: firstText.slice(0, 40),
      createdAt: entries[0]?.seq ?? 0,
      updatedAt: entries.at(-1)?.seq ?? 0,
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

// ---- SessionStore: chained persistence + restore ----

export class SessionStore {
  readonly id: string
  private lastEntryId: string | null
  private seq: number

  constructor(id: string = newSessionId()) {
    this.id = id
    const entries = readEntries(id)
    const last = entries.at(-1)
    this.lastEntryId = last?.id ?? null
    this.seq = last?.seq ?? -1
  }

  // append a message (linear chain, parentId points to the previous one)
  append(msg: AgentMessage) {
    this.seq++
    const entry: SessionEntry = {
      id: crypto.randomUUID(),
      parentId: this.lastEntryId,
      seq: this.seq,
      type: "message",
      data: msg,
    }
    appendEntry(this.id, entry)
    this.lastEntryId = entry.id
  }

  // append a custom entry (extension state, not sent to the LLM)
  appendCustom(customType: string, data?: unknown) {
    this.seq++
    const entry: SessionEntry = {
      id: crypto.randomUUID(),
      parentId: this.lastEntryId,
      seq: this.seq,
      type: "custom",
      data: { customType, data },
    }
    appendEntry(this.id, entry)
    this.lastEntryId = entry.id
  }

  // read back custom entries of a type (seq order), return the data array
  readCustom(customType: string): unknown[] {
    return readEntries(this.id)
      .filter(
        (e): e is SessionEntry & { type: "custom" } =>
          e.type === "custom" && (e.data as { customType?: string })?.customType === customType,
      )
      .map((e) => (e.data as { data?: unknown }).data)
  }

  load(): AgentMessage[] {
    return entriesToMessages(this.id)
  }
}
