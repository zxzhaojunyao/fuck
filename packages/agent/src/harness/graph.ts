import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { z } from "zod"
import type { ToolDefinition } from "../types"

// ---- semantic graph: externalized memory (fact / intent / hypothesis / hint) ----
// This is the anti-hallucination layer: a hypothesis (what the model thinks) is stored
// separately from a fact (what a tool confirmed). The graph is the shared blackboard
// that the main agent and any delegate sub-agents all read/write.

export type GraphNodeType = "fact" | "intent" | "hypothesis" | "hint"
export type GraphEdgeType = "derived_from" | "yields" | "contradicts"

export type GraphNode = {
  id: string
  type: GraphNodeType
  content: string
  // hypothesis lifecycle
  status?: "pending" | "testing" | "verified" | "failed" | "skipped"
  // for facts: the tool/evidence that confirmed it
  evidence?: string
  createdAt: number
}

export type GraphEdge = {
  from: string
  to: string
  type: GraphEdgeType
}

export type GraphSnapshot = {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function graphRoot(): string {
  const dir = process.env.FUCK_HOME ?? join(homedir(), ".fuck")
  return join(dir, "graphs")
}

function graphFile(sessionId: string): string {
  return join(graphRoot(), `${sessionId}.json`)
}

export class GraphStore {
  readonly sessionId: string
  private nodes: GraphNode[] = []
  private edges: GraphEdge[] = []

  constructor(sessionId: string) {
    this.sessionId = sessionId
    const file = graphFile(sessionId)
    if (existsSync(file)) {
      try {
        const snap = JSON.parse(readFileSync(file, "utf8")) as GraphSnapshot
        this.nodes = snap.nodes ?? []
        this.edges = snap.edges ?? []
      } catch {
        this.nodes = []
        this.edges = []
      }
    }
  }

  private persist() {
    mkdirSync(graphRoot(), { recursive: true })
    writeFileSync(graphFile(this.sessionId), JSON.stringify({ nodes: this.nodes, edges: this.edges }), "utf8")
  }

  addNode(input: Omit<GraphNode, "id" | "createdAt">): GraphNode {
    const node: GraphNode = { ...input, id: crypto.randomUUID(), createdAt: Date.now() }
    this.nodes.push(node)
    this.persist()
    return node
  }

  getNode(id: string): GraphNode | undefined {
    // exact match first, then short-id prefix match (e.g. the 8-char id shown in tool output)
    const exact = this.nodes.find((n) => n.id === id)
    if (exact) return exact
    if (id.length >= 8) {
      const prefix = this.nodes.filter((n) => n.id.startsWith(id))
      if (prefix.length === 1) return prefix[0]
    }
    return undefined
  }

  addEdge(from: string, to: string, type: GraphEdgeType): boolean {
    if (!this.getNode(from) || !this.getNode(to)) return false
    // avoid duplicate edges
    if (this.edges.some((e) => e.from === from && e.to === to && e.type === type)) return true
    this.edges.push({ from, to, type })
    this.persist()
    return true
  }

  // relevant nodes: match a query against content (substring/token), filter by type
  query(query?: string, type?: GraphNodeType, limit = 20): GraphNode[] {
    let out = this.nodes
    if (type) out = out.filter((n) => n.type === type)
    if (query) {
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
      out = out
        .map((n) => {
          const content = n.content.toLowerCase()
          const score = tokens.reduce((s, t) => (content.includes(t) ? s + 1 : s), 0)
          return { n, score }
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.n.createdAt - a.n.createdAt)
        .map((x) => x.n)
    } else {
      out = [...out].sort((a, b) => b.createdAt - a.createdAt)
    }
    return out.slice(0, limit)
  }

  edgesFor(nodeId: string): GraphEdge[] {
    return this.edges.filter((e) => e.from === nodeId || e.to === nodeId)
  }

  snapshot(): GraphSnapshot {
    return { nodes: [...this.nodes], edges: [...this.edges] }
  }

  // promote a hypothesis to a verified fact (anti-hallucination: only tool-confirmed)
  verifyHypothesis(id: string, evidence: string): GraphNode | undefined {
    const n = this.getNode(id)
    if (!n || n.type !== "hypothesis") return undefined
    n.status = "verified"
    n.evidence = evidence
    this.persist()
    return n
  }
}

// ---- graph tools (built-in, wired into the runtime and delegate sub-agents) ----

const NODE_TYPES = ["fact", "intent", "hypothesis", "hint"] as const
const EDGE_TYPES = ["derived_from", "yields", "contradicts"] as const

function formatNode(n: GraphNode): string {
  const meta = [n.status, n.evidence ? `evidence: ${n.evidence}` : undefined].filter(Boolean).join(", ")
  return `${n.type}(${n.id.slice(0, 8)})${meta ? " [" + meta + "]" : ""}: ${n.content}`
}

export function createGraphTools(store: GraphStore): ToolDefinition[] {
  const write: ToolDefinition = {
    name: "graph_write",
    description:
      "Write one node to the shared semantic graph. Use type=fact only for tool-confirmed observations (cite the tool in evidence); type=hypothesis for unverified guesses (with a pending/testing status); type=intent for a direction to explore; type=hint for a weak clue. Optionally link to existing nodes via edges (derived_from / yields / contradicts).",
    schema: z.object({
      type: z.enum(NODE_TYPES),
      content: z.string().min(1).describe("the node content (fact/guess/direction/clue)"),
      status: z.enum(["pending", "testing", "verified", "failed", "skipped"]).optional(),
      evidence: z.string().optional().describe("for facts: which tool output confirmed this"),
      links: z
        .array(
          z.object({
            to: z.string().describe("existing node id (short 8-char id from graph_read)"),
            edge: z.enum(EDGE_TYPES),
          })
        )
        .optional(),
    }),
    execute: async (args) => {
      const node = store.addNode({
        type: args.type as GraphNodeType,
        content: String(args.content),
        status: (args.status as GraphNode["status"]) ?? (args.type === "hypothesis" ? "pending" : undefined),
        evidence: args.evidence ? String(args.evidence) : undefined,
      })
      const lines = [`wrote ${node.type}(${node.id.slice(0, 8)})`]
      for (const link of (args.links ?? []) as Array<{ to: string; edge: string }>) {
        const ok = store.addEdge(node.id, link.to, link.edge as GraphEdgeType)
        lines.push(ok ? `linked --${link.edge}-> ${link.to}` : `link failed: node ${link.to} not found`)
      }
      return lines.join("\n")
    },
  }

  const read: ToolDefinition = {
    name: "graph_read",
    description:
      "Query the shared semantic graph for relevant nodes. Pass a query string to search content, and/or a type filter. Returns the most relevant nodes (id, type, status, content).",
    schema: z.object({
      query: z.string().optional().describe("search keywords"),
      type: z.enum(NODE_TYPES).optional().describe("filter by node type"),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async (args) => {
      const nodes = store.query(
        args.query ? String(args.query) : undefined,
        args.type as GraphNodeType | undefined,
        args.limit != null ? Number(args.limit) : 20
      )
      if (nodes.length === 0) return "(no nodes)"
      return nodes.map(formatNode).join("\n")
    },
  }

  const list: ToolDefinition = {
    name: "graph_list",
    description: "List all graph nodes by type (summary + counts). Use to understand what is already known vs still open.",
    schema: z.object({
      type: z.enum(NODE_TYPES).optional(),
    }),
    execute: async (args) => {
      const nodes = store.query(undefined, args.type as GraphNodeType | undefined, 200)
      if (nodes.length === 0) return "(empty graph)"
      const byType = new Map<GraphNodeType, number>()
      for (const n of nodes) byType.set(n.type, (byType.get(n.type) ?? 0) + 1)
      const summary = [...byType.entries()].map(([t, c]) => `${t}: ${c}`).join(", ")
      return `[${summary}]\n\n` + nodes.map(formatNode).join("\n")
    },
  }

  const verify: ToolDefinition = {
    name: "graph_verify",
    description:
      "Promote a hypothesis to a verified fact after a tool confirmed it. This is the ONLY way a hypothesis becomes trusted — never write a fact without tool confirmation.",
    schema: z.object({
      id: z.string().describe("hypothesis node id (short 8-char id from graph_read)"),
      evidence: z.string().describe("the tool output that confirms it"),
    }),
    execute: async (args) => {
      const node = store.verifyHypothesis(String(args.id), String(args.evidence))
      return node ? `verified hypothesis(${node.id.slice(0, 8)}) -> fact confirmed: ${node.content}` : "not found or not a hypothesis"
    },
  }

  return [write, read, list, verify]
}
