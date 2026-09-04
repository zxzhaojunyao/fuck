import { createRuntime } from "./runtime"

const noopUi = {
  select: async () => undefined,
  confirm: async () => false,
  input: async () => undefined,
  notify: () => {},
  setStatus: () => {},
  setWidget: () => {},
  editor: async () => undefined,
}

export async function runOneShot(prompt: string, cwd: string): Promise<number> {
  const { agent } = await createRuntime(cwd, undefined, noopUi)
  let lastText = ""
  agent.events.subscribe((e) => {
    if (e.type === "message_delta") {
      lastText += e.text
      process.stdout.write(e.text)
    } else if (e.type === "tool_start") {
      process.stdout.write(`\n[tool] ${e.toolCall.name} ${JSON.stringify(e.toolCall.arguments).slice(0, 120)}\n`)
    }
  })
  try {
    await agent.send(prompt)
    await agent.waitForIdle()
  } catch (err) {
    process.stderr.write(`(error) ${err instanceof Error ? err.message : String(err)}\n`)
  }
  process.stdout.write("\n")
  return 0
}
