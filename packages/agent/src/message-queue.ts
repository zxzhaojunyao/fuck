import type { AgentMessage } from "./types"

// pending message queue
export class MessageQueue {
  private queue: AgentMessage[] = []

  push(message: AgentMessage) {
    this.queue.push(message)
  }

  get length(): number {
    return this.queue.length
  }

  // drain modes: all takes everything at once; one-at-a-time takes one
  drain(mode: "all" | "one-at-a-time" = "all"): AgentMessage[] {
    if (mode === "all") {
      const out = this.queue
      this.queue = []
      return out
    }
    return this.queue.splice(0, 1)
  }

  clear() {
    this.queue = []
  }
}
