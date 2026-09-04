import { z } from "zod"
import type { ToolDefinition } from "@fuck/agent"

// ---- web access tools ----

// DuckDuckGo HTML search, returns title+link+snippet. No API key.
async function duckDuckGoSearch(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FuckAgent/1.0)" },
  })
  if (!res.ok) return []
  const html = await res.text()
  const results: Array<{ title: string; url: string; snippet: string }> = []
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && results.length < 10) {
    const url = decodeURIComponent(m[1].replace(/^.*uddg=/, "").split("&")[0] ?? m[1])
    const title = m[2].replace(/<[^>]+>/g, "").trim()
    const snippet = m[3].replace(/<[^>]+>/g, "").trim()
    if (title) results.push({ title, url, snippet })
  }
  return results
}

// fetch a page and convert to plain text (Jina Reader, keyless)
async function fetchText(url: string): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FuckAgent/1.0)" },
  })
  if (!res.ok) return `(fetch failed: ${res.status})`
  const text = await res.text()
  return text.length > 12000 ? text.slice(0, 12000) + "\n...(truncated)" : text
}

export function createWebTools(): ToolDefinition[] {
  const webSearch: ToolDefinition = {
    name: "web_search",
    description: "Web search (DuckDuckGo), returns title+link+snippet. For public info, technical docs, and vuln intelligence.",
    schema: z.object({
      query: z.string().describe("search keywords"),
    }),
    execute: async (args) => {
      const results = await duckDuckGoSearch(String(args.query))
      if (!results.length) return "(no results)"
      return results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n")
    },
  }

  const fetchUrl: ToolDefinition = {
    name: "fetch_url",
    description: "Fetch a web page as plain text (Jina Reader). For reading docs, articles, announcements, etc.",
    schema: z.object({
      url: z.string().describe("full URL to fetch"),
    }),
    execute: async (args) => fetchText(String(args.url)),
  }

  return [webSearch, fetchUrl]
}
