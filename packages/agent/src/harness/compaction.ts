import type { AgentMessage, CompactionSummaryMessage } from "../types"

// ---- automatic context compaction (non-destructive) ----
//
// Design mirrors opencode's compaction: compaction NEVER deletes history. It
// inserts a `compaction` marker message that carries an accumulated summary.
// The full history stays in memory and on disk; `projectContext` folds away
// everything covered by the marker into a single summary message that is what
// actually gets sent to the model. On the next compaction the previous summary
// is merged (not re-summarized from scratch), so context is never lost — only
// the *view* sent to the model shrinks.

export type CompactionOptions = {
  maxTokens: number
  keepRecentTokens: number
  currentSummary?: string
  summarize: (messages: AgentMessage[]) => Promise<string>
  updateSummary?: (previous: string, messages: AgentMessage[]) => Promise<string>
}

export type CompactionConfig = {
  maxTokens: number
  keepRecentTokens: number
  summarize: (messages: AgentMessage[]) => Promise<string>
  updateSummary?: (previous: string, messages: AgentMessage[]) => Promise<string>
}

// rough token estimate (chars/4 heuristic when no usage data)
export function estimateTokens(text: string): number {
  // CJK characters are ~1 token each, not 4 chars/token; count them more accurately
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) ?? []).length
  const rest = text.length - cjk
  return Math.ceil(cjk + rest / 4)
}

function messageTokens(m: AgentMessage): number {
  if (m.role === "compaction") return estimateTokens(m.summary)
  return estimateTokens(
    (m.role === "user" || m.role === "assistant" ? m.content : "") +
      (m.role === "tool" ? m.content : "")
  )
}

// sum of per-message token estimates (used for cut-point arithmetic only)
export function totalTokens(messages: AgentMessage[]): number {
  return messages.reduce((n, m) => n + messageTokens(m), 0)
}

export function isCompaction(m: AgentMessage): m is CompactionSummaryMessage {
  return m.role === "compaction"
}

function lastCompactionIndex(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "compaction") return i
  }
  return -1
}

// project: the view actually sent to the model. Folds all compacted history
// into ONE summary message (the accumulated summary of the last marker) and
// keeps the first user message verbatim as the task anchor + the tail after the
// marker. The original array is never mutated.
export function projectContext(messages: AgentMessage[]): AgentMessage[] {
  const marker = lastCompactionIndex(messages)
  if (marker < 0) return messages

  const summary = (messages[marker] as CompactionSummaryMessage).summary
  const anchorIdx = messages.findIndex((m) => m.role === "user")
  const anchor = anchorIdx >= 0 ? messages.slice(anchorIdx, anchorIdx + 1) : []
  const tail = messages.slice(marker + 1)

  const summaryMsg: AgentMessage = {
    role: "assistant",
    content: "[compaction summary]\n" + summary,
  }
  return [...anchor, summaryMsg, ...tail]
}

// the current context size of the *projected* view (what the model will see),
// preferring the model's reported inputTokens, falling back to the heuristic.
export function contextTokens(messages: AgentMessage[]): number {
  const projected = projectContext(messages)
  for (let i = projected.length - 1; i >= 0; i--) {
    const m = projected[i]
    if (m.role === "assistant" && m.usage?.inputTokens) {
      return m.usage.inputTokens
    }
  }
  return totalTokens(projected)
}

// find a legal cut point from the tail: avoid splitting a turn (a user message
// starts a turn). Also guarantees the cut never orphans a tool call: a kept
// turn's tool calls always keep their tool results (same turn).
export function findCutPoint(messages: AgentMessage[], keepRecentTokens: number): number {
  let tail = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    tail += messageTokens(messages[i])
    if (tail >= keepRecentTokens) {
      let cut = i
      while (cut < messages.length && messages[cut].role !== "user") cut++
      if (cut >= messages.length) return 0
      return cut
    }
  }
  return 0
}

// extract file operations (preserve read/write traces during compaction)
function extractFileOps(messages: AgentMessage[]): string[] {
  const files = new Set<string>()
  for (const m of messages) {
    if (m.role === "tool") {
      if (m.toolName === "read" || m.toolName === "write" || m.toolName === "edit") {
        try {
          if (m.content) files.add(m.toolName + ": " + m.content.slice(0, 120))
        } catch {}
      }
    }
  }
  return [...files]
}

// non-destructive compaction: returns the ORIGINAL messages with a new
// `compaction` marker inserted at the cut point (length grows by one). The
// covered history is left in place; `projectContext` is what shrinks the view.
// A failed / empty summary leaves the array untouched so a flaky model can
// never destroy context.
export async function compactMessages(
  messages: AgentMessage[],
  opts: CompactionOptions
): Promise<{ summary: string; messages: AgentMessage[] }> {
  if (contextTokens(messages) <= opts.maxTokens) {
    return { summary: "", messages }
  }

  // the increment to summarize starts right after the last marker (or from the
  // top if there is none). The task anchor (first user) is never re-summarized —
  // it is kept verbatim by projectContext.
  const marker = lastCompactionIndex(messages)
  const start = marker + 1
  const working = messages.slice(start)

  const cut = findCutPoint(working, opts.keepRecentTokens)
  if (cut <= 0) return { summary: "", messages }

  const toSummarize = working.slice(0, cut)
  const previousSummary =
    marker >= 0 ? (messages[marker] as CompactionSummaryMessage).summary : undefined

  let summary: string
  try {
    summary = previousSummary !== undefined && opts.updateSummary
      ? await opts.updateSummary(previousSummary, toSummarize)
      : await opts.summarize(toSummarize)
  } catch {
    // summary failure must never destroy the working set — leave it untouched
    return { summary: "", messages }
  }
  if (!summary || !summary.trim()) return { summary: "", messages }

  const fileOps = extractFileOps(toSummarize)
  if (fileOps.length) {
    summary += "\n\n[file operations]\n" + fileOps.map((f) => `- ${f}`).join("\n")
  }

  const markerMsg: CompactionSummaryMessage = { role: "compaction", summary }
  const insertAt = start + cut
  return {
    summary,
    messages: [...messages.slice(0, insertAt), markerMsg, ...messages.slice(insertAt)],
  }
}

export function needsCompaction(messages: AgentMessage[], maxTokens: number): boolean {
  return contextTokens(messages) > maxTokens
}
