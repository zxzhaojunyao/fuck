import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendEntry, readEntries, entriesToMessages, branchFrom, newSessionId, SessionStore } from "./harness/session"
import { compactMessages, totalTokens, findCutPoint, projectContext, needsCompaction } from "./harness/compaction"
import type { AgentMessage } from "./types"

const dir = mkdtempSync(join(tmpdir(), "fuck-session-"))
process.env.FUCK_HOME = dir

// 1. JSONL tree: append + read + reconstruct messages
{
  const id = newSessionId()
  const rootId = crypto.randomUUID()
  appendEntry(id, { id: rootId, parentId: null, seq: 0, type: "message", data: { role: "user", content: "hello" } })
  const aId = crypto.randomUUID()
  appendEntry(id, { id: aId, parentId: rootId, seq: 1, type: "message", data: { role: "assistant", content: "hi" } })
  // branch
  const branchId = branchFrom(id, rootId, { role: "assistant", content: "branch reply" })
  console.assert(!!branchId, "branchFrom should return a new leaf id")

  const entries = readEntries(id)
  console.assert(entries.length === 3, "should have 3 entries")
  const msgs = entriesToMessages(id)
  console.assert(msgs.length === 2, "reconstruct 2 messages along the parent chain")
  console.assert(msgs[1].role === "assistant", "second one is assistant")
  console.log("1. JSONL tree + branch: OK")
}

// 2. compaction: non-destructive + projection + incremental merge
{
  const messages: AgentMessage[] = []
  for (let i = 0; i < 30; i++) {
    messages.push({ role: "user", content: "question" + i + " " + "x".repeat(300) })
    messages.push({ role: "assistant", content: "answer" + i + " " + "y".repeat(300) })
  }
  const total = totalTokens(messages)
  console.assert(total > 4000, `total tokens should exceed threshold (got ${total})`)

  const cut = findCutPoint(messages, 1000)
  console.assert(cut > 0 && cut < messages.length, "cut point should be in the middle")
  console.assert(messages[cut].role === "user", "cut point should align to a user message (turn start)")

  const { summary, messages: compacted } = await compactMessages(messages, {
    maxTokens: 4000,
    keepRecentTokens: 1000,
    summarize: async (ms) => "summary:" + ms.length + "msgs",
    updateSummary: async (prev, ms) => prev + " + " + ms.length + "msgs",
  })
  console.assert(summary.includes("summary"), "should produce a summary")
  console.assert(compacted.length === messages.length + 1, "non-destructive: original messages preserved + 1 marker")

  // projection folds history into anchor + summary + tail (the view sent to the model)
  const projected = projectContext(compacted)
  console.assert(projected.length < messages.length, `projected view should shrink (got ${projected.length})`)
  console.assert(projected[0].role === "user", "projected view keeps the task anchor first")
  console.assert(
    (projected[1] as { content?: string }).content?.includes("[compaction summary]"),
    "projected view folds covered history into the summary"
  )

  // the projected view must now sit under the threshold (no repeated compaction)
  console.assert(needsCompaction(compacted, 4000) === false, "compaction should bring projected view under threshold")

  // grow the tail so a second compaction triggers; it must MERGE, not re-summarize
  const grown = compacted.slice()
  for (let i = 0; i < 30; i++) {
    grown.push({ role: "user", content: "q2-" + i + " " + "x".repeat(300) })
    grown.push({ role: "assistant", content: "a2-" + i + " " + "y".repeat(300) })
  }
  let merged = false
  const { summary: s2 } = await compactMessages(grown, {
    maxTokens: 4000,
    keepRecentTokens: 1000,
    summarize: async () => "fresh-summary",
    updateSummary: async (prev) => {
      merged = true
      return prev + "|merged"
    },
  })
  console.assert(merged, "second compaction should merge the prior summary (not re-summarize)")
  console.assert(s2.includes("summary:"), "merged summary should carry the prior summary forward")
  console.log("2. compaction (non-destructive + projection + merge): OK")
}

// 3. SessionStore: chained append + restore round-trip
{
  const store = new SessionStore()
  store.append({ role: "user", content: "first" })
  store.append({ role: "assistant", content: "reply1", toolCalls: [{ id: "c1", name: "echo", arguments: { x: 1 } }] })
  store.append({ role: "tool", toolCallId: "c1", toolName: "echo", content: "result", isError: false })
  store.append({ role: "assistant", content: "final reply" })

  // reopen the same session and verify chained restore
  const reloaded = new SessionStore(store.id)
  const msgs = reloaded.load()
  console.assert(msgs.length === 4, `round-trip should restore 4 (got ${msgs.length})`)
  console.assert(msgs[0].role === "user", "first is user")
  console.assert(msgs[2].role === "tool", "third is tool")
  console.assert((msgs[1] as { toolCalls?: unknown[] }).toolCalls?.length === 1, "assistant restored with toolCalls")

  // keep appending; seq should continue
  reloaded.append({ role: "user", content: "second" })
  const final = new SessionStore(store.id).load()
  console.assert(final.length === 5, `should be 5 after appending (got ${final.length})`)
  console.log("3. SessionStore round-trip: OK")
}

rmSync(dir, { recursive: true, force: true })
console.log("\nM3 session + compaction tests passed")
