#!/usr/bin/env node
// Thin wrapper: spawn the downloaded platform binary with the given args.
const { existsSync } = require("node:fs")
const { homedir } = require("node:os")
const { join } = require("node:path")
const { spawn } = require("node:child_process")

const isWin = process.platform === "win32"
const bin = join(homedir(), ".fuck", "bin", isWin ? "fuck.exe" : "fuck")

if (!isWin) {
  console.error("f-ai-cli currently ships Windows binaries only.")
  process.exit(1)
}
if (!existsSync(bin)) {
  console.error("FUCK binary not found. Re-run: npm rebuild f-ai-cli")
  process.exit(1)
}

const child = spawn(bin, process.argv.slice(2), { stdio: "inherit", cwd: process.cwd() })
child.on("exit", (code) => process.exit(code ?? 0))
