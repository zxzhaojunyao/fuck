import type { AgentEvent } from "./types"

export type EventHandler = (event: AgentEvent) => void

// event stream: multiple subscribers, async dispatch, subscribe returns an unsubscribe fn
export class EventStream {
  private handlers = new Set<EventHandler>()
  private buffer: AgentEvent[] = []
  private processing = false

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  emit(event: AgentEvent) {
    this.buffer.push(event)
    void this.drain()
  }

  private async drain() {
    if (this.processing) return
    this.processing = true
    try {
      while (this.buffer.length > 0) {
        const event = this.buffer.shift()!
        for (const handler of [...this.handlers]) {
          try {
            handler(event)
          } catch (err) {
            // one subscriber's error must not break the others
            console.error("[event-stream] handler error:", err)
          }
        }
      }
    } finally {
      this.processing = false
    }
  }
}
