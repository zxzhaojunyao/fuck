import type { AgentMessage } from "../types"

// ---- automatic context compaction ----

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
  return estimateTokens(
    (m.role === "user" || m.role === "assistant" ? m.content : "") +
      (m.role === "tool" ? m.content : "")
  )
}

// sum of per-message token estimates (used for cut-point arithmetic only)
export function totalTokens(messages: AgentMessage[]): number {
  return messages.reduce((n, m) => n + messageTokens(m), 0)
}

// the current context size, preferring the model's reported inputTokens (most accurate),
// falling back to the per-message heuristic. The last assistant message's usage.inputTokens
// is the token count of the full context sent on the previous call.
export function contextTokens(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "assistant" && m.usage?.inputTokens) {
      return m.usage.inputTokens
    }
  }
  return totalTokens(messages)
}

// find a legal cut point from the tail: avoid splitting a turn (a user message starts a turn)
export function findCutPoint(messages: AgentMessage[], keepRecentTokens: number): number {
  let tail = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    tail += messageTokens(messages[i])
    if (tail >= keepRecentTokens) {
      // fall back to the nearest user message as the cut point (never split mid-turn)
      let cut = i
      while (cut < messages.length && messages[cut].role !== "user") cut++
      return Math.max(0, cut)
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
          const args = m.content
          if (args) files.add(m.toolName + ": " + args.slice(0, 120))
        } catch {}
      }
    }
  }
  return [...files]
}

// build the final compacted message list. Clears usage on kept assistant messages
// (their inputTokens reflect the pre-compaction context, which would make contextTokens
// misjudge the new size and re-trigger compaction every turn), and stamps the summary
// with a fresh usage estimate so the next contextTokens read returns the true size.
function finalizeCompacted(kept: AgentMessage[], summary: string): AgentMessage[] {
  const cleared = kept.map((m) =>
    m.role === "assistant" && m.usage ? { ...m, usage: undefined } : m
  )
  const summaryTokens = totalTokens(cleared) + estimateTokens(summary)
  return [
    {
      role: "assistant" as const,
      content: "[compaction summary]\n" + summary,
      usage: { inputTokens: summaryTokens, outputTokens: 0 },
    },
    ...cleared,
  ]
}

export async function compactMessages(
  messages: AgentMessage[],
  opts: CompactionOptions
): Promise<{ summary: string; messages: AgentMessage[] }> {
  const tokens = contextTokens(messages)
  if (tokens <= opts.maxTokens) {
    return { summary: "", messages }
  }

  const cut = findCutPoint(messages, opts.keepRecentTokens)
  if (cut <= 0) {
    // fallback: heuristic cut point failed (e.g. real usage >> heuristic chars/4).
    // keep only the most recent few messages so compaction always makes progress.
    const fallback = messages.length > 6 ? messages.length - 6 : 0
    if (fallback <= 0) return { summary: "", messages }
    const toSummarize = messages.slice(0, fallback)
    const kept = messages.slice(fallback)
    let summary = await (opts.updateSummary
      ? opts.updateSummary(opts.currentSummary ?? "", toSummarize)
      : opts.summarize(toSummarize))
    const fileOps = extractFileOps(toSummarize)
    if (fileOps.length) summary += "\n\n[file operations]\n" + fileOps.map((f) => `- ${f}`).join("\n")
    return { summary, messages: finalizeCompacted(kept, summary) }
  }

  const toSummarize = messages.slice(0, cut)
  const kept = messages.slice(cut)

  let summary: string
  if (opts.updateSummary) {
    summary = await opts.updateSummary(opts.currentSummary ?? "", toSummarize)
  } else {
    summary = await opts.summarize(toSummarize)
  }

  // append file-operation tracking
  const fileOps = extractFileOps(toSummarize)
  if (fileOps.length) {
    summary += "\n\n[file operations]\n" + fileOps.map((f) => `- ${f}`).join("\n")
  }

  return { summary, messages: finalizeCompacted(kept, summary) }
}

export function needsCompaction(messages: AgentMessage[], maxTokens: number): boolean {
  return contextTokens(messages) > maxTokens
}
