import { win32InstallUtf8 } from "./terminal-win32"
import { runApp } from "./app"
import { listSessions } from "@fuck/agent"

// force truecolor for accurate ANSI rendering
process.env.COLORTERM ??= "truecolor"
process.env.TERM ??= "xterm-256color"

win32InstallUtf8()

// --continue: resume the most recent session
let resumeId: string | undefined
if (process.env.FUCK_CONTINUE === "1") {
  resumeId = listSessions()[0]?.id
}

await runApp(process.cwd(), resumeId)
