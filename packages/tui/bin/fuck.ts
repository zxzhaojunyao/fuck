#!/usr/bin/env bun
import { chdir } from "node:process"
import { runOneShot } from "../src/oneShot"
import { runServer } from "../src/server"

const args = process.argv.slice(2)
const VERSION = "1.1.0"

function help() {
  console.log(`FUCK - a terminal AI coding agent

Usage:
  fuck                 Start in the current directory
  fuck <dir>          Start in the given directory
  fuck --continue      Resume the most recent session (alias -c)
  fuck -p <text>       One-shot execution (non-interactive, prints result and exits)
  fuck --serve         Headless server mode (localhost HTTP+WS, for the desktop app)
  fuck --version       Version
  fuck --help          Help

Config: ~/.fuck/config.json (API key / model)
Sessions: ~/.fuck/sessions/ (JSONL session tree)
Keys: Enter send · Shift+Enter newline · @file reference · /help /models /themes /sessions`)
}

let target: string | undefined
let prompt: string | undefined
let continueMode = false
let serveMode = false
let servePort: number | undefined
let servePassword: string | undefined
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === "--help" || a === "-h") {
    help()
    process.exit(0)
  } else if (a === "--version" || a === "-v") {
    console.log(VERSION)
    process.exit(0)
  } else if (a === "--continue" || a === "-c") {
    continueMode = true
  } else if (a === "--serve") {
    serveMode = true
  } else if (a === "--port") {
    servePort = Number(args[++i])
  } else if (a === "--password") {
    servePassword = args[++i]
  } else if (a === "-p" || a === "--prompt") {
    prompt = args[++i]
  } else if (!a.startsWith("-")) {
    target = a
  }
}

if (target) {
  try {
    chdir(target)
  } catch {
    console.error(`cannot enter directory: ${target}`)
    process.exit(1)
  }
}

if (continueMode) {
  process.env.FUCK_CONTINUE = "1"
}

if (serveMode) {
  const port = servePort ?? 0
  const password = servePassword ?? crypto.randomUUID()
  await runServer({ cwd: process.cwd(), port, password })
  // keep alive
  await new Promise(() => {})
}

// Non-TTY (piped/scripted/redirected): run one-shot instead of crashing on raw mode.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  let text = prompt
  if (text == null) {
    try {
      const buf = await Bun.stdin.arrayBuffer()
      text = new TextDecoder().decode(buf).trim()
    } catch {}
  }
  if (!text) {
    help()
    process.exit(1)
  }
  process.exit(await runOneShot(text, process.cwd()))
}

await import("../src/index.ts")
