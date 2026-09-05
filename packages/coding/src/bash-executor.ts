import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { platform, homedir } from "node:os"
import { join } from "node:path"
import type { ToolUpdate } from "@fuck/agent"

export type BashResult = {
  exitCode: number | null
  output: string
  timedOut: boolean
  truncated: boolean
}

const MAX_OUTPUT = 30_000

export type ShellKind = "bash" | "powershell"

// command prefix: PowerShell sets output encoding to UTF-8
const PS_UTF8_PREFIX = "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n"

// UTF-8 env injected into every child process so that python/other tools emit
// UTF-8 stdout/stderr even on Chinese-locale Windows (which defaults to GBK/cp936).
function utf8Env(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    MSYS_NO_PATHCONV: "1",
  }
}

// locate a real bash on Windows (Git Bash / MSYS2), so the model's Unix mental model
// matches the actual shell instead of silently running cmd.exe.
function findBashOnWindows(): string | null {
  const candidates = [
    join("C:\\Program Files\\Git\\bin\\bash.exe"),
    join("C:\\Program Files (x86)\\Git\\bin\\bash.exe"),
    join(homedir(), "AppData", "Local", "Programs", "Git", "bin", "bash.exe"),
    join("C:\\msys64\\usr\\bin\\bash.exe"),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

// resolve shell and args: bash uses a real bash on Windows (Git Bash fallback to cmd),
// powershell uses powershell.exe.
function shellCommand(command: string, kind: ShellKind): { cmd: string; args: string[] } {
  if (kind === "powershell") {
    if (platform() === "win32") {
      return { cmd: "powershell.exe", args: ["-NoProfile", "-Command", PS_UTF8_PREFIX + command] }
    }
    return { cmd: "pwsh", args: ["-NoProfile", "-Command", PS_UTF8_PREFIX + command] }
  }
  if (platform() === "win32") {
    const bash = findBashOnWindows()
    if (bash) {
      return { cmd: bash, args: ["-lc", command] }
    }
    return { cmd: "cmd.exe", args: ["/c", "chcp 65001 >nul && " + command] }
  }
  return { cmd: "bash", args: ["-c", command] }
}

// kill the process tree: taskkill /T /F on Windows, SIGKILL the process group on POSIX
function killTree(pid: number) {
  if (platform() === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" })
  } else {
    try {
      process.kill(-pid, "SIGKILL")
    } catch {
      try {
        process.kill(pid, "SIGKILL")
      } catch {}
    }
  }
}

export async function runShell(
  command: string,
  kind: ShellKind,
  opts: { cwd: string; timeoutMs?: number; signal?: AbortSignal; onUpdate?: ToolUpdate }
): Promise<BashResult> {
  const timeout = opts.timeoutMs ?? 30_000
  const { cmd, args } = shellCommand(command, kind)
  const child: ChildProcess = spawn(cmd, args, {
    cwd: opts.cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: utf8Env(),
  })

  let output = ""
  let timedOut = false
  let truncated = false

  const append = (chunk: string) => {
    if (output.length >= MAX_OUTPUT) {
      truncated = true
      return
    }
    const space = MAX_OUTPUT - output.length
    const piece = chunk.slice(0, space)
    output += piece
    if (chunk.length > space) truncated = true
    opts.onUpdate?.(piece)
  }

  const onData = (chunk: Buffer) => append(chunk.toString("utf8"))
  child.stdout?.on("data", onData)
  child.stderr?.on("data", onData)

  const timer = setTimeout(() => {
    timedOut = true
    if (child.pid) killTree(child.pid)
  }, timeout)

  const onAbort = () => {
    if (child.pid) killTree(child.pid)
  }
  opts.signal?.addEventListener("abort", onAbort, { once: true })

  // Resolve on process EXIT, not 'close'. 'close' only fires after every stdio
  // stream is closed, but a backgrounded child (openvpn --daemon, a long-running
  // server, `(cmd &)`, etc.) keeps the stdout/stderr pipe open after the shell
  // exits — so waiting on 'close' hangs the tool forever and the tool result is
  // never returned (the agent then sits there with a "tool result missing").
  const exitCode: number | null = await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code))
    child.on("error", () => resolve(null))
  })

  // Drain any remaining buffered output, bounded so a held-open pipe can't hang us.
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }
    const pending: Promise<void>[] = []
    if (child.stdout && !child.stdout.readableEnded) {
      pending.push(new Promise((r) => child.stdout!.once("end", () => r())))
    }
    if (child.stderr && !child.stderr.readableEnded) {
      pending.push(new Promise((r) => child.stderr!.once("end", () => r())))
    }
    if (pending.length) Promise.all(pending).then(finish)
    else finish()
    setTimeout(finish, 300)
  })

  clearTimeout(timer)
  opts.signal?.removeEventListener("abort", onAbort)

  return { exitCode, output, timedOut, truncated }
}

// backward compat: bash execution
export function runBash(
  command: string,
  opts: { cwd: string; timeoutMs?: number; signal?: AbortSignal; onUpdate?: ToolUpdate }
): Promise<BashResult> {
  return runShell(command, "bash", opts)
}
