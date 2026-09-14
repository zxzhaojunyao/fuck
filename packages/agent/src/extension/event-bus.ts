// ---- event bus ----

export type EventHandler<E, R = void> = (event: E) => R | void | Promise<R | void>

export class EventBus {
  private handlers = new Map<string, Array<(event: unknown) => unknown>>()

  on<E, R = void>(event: string, handler: EventHandler<E, R>): () => void {
    const list = this.handlers.get(event) ?? []
    list.push(handler as (event: unknown) => unknown)
    this.handlers.set(event, list)
    return () => {
      const cur = this.handlers.get(event) ?? []
      const i = cur.indexOf(handler as (event: unknown) => unknown)
      if (i >= 0) cur.splice(i, 1)
    }
  }

  has(event: string): boolean {
    return (this.handlers.get(event)?.length ?? 0) > 0
  }

  // run handlers in order, return the last non-undefined result (chained override)
  async emit<E, R = void>(event: string, payload: E): Promise<R | undefined> {
    const list = this.handlers.get(event) ?? []
    let last: R | undefined
    for (const h of list) {
      const r = (await (h as EventHandler<E, R>)(payload)) as R | undefined
      if (r !== undefined) last = r
    }
    return last
  }

  // chained merge (for tool_result middleware and before_agent_start systemPrompt chains)
  async chain<E, R>(
    event: string,
    payload: E,
    merge: (acc: R, next: R) => R,
  ): Promise<R | undefined> {
    const list = this.handlers.get(event) ?? []
    let acc: R | undefined
    for (const h of list) {
      const r = (await (h as EventHandler<E, R>)(payload)) as R | undefined
      if (r !== undefined) acc = acc === undefined ? r : merge(acc, r)
    }
    return acc
  }
}
