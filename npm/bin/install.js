#!/usr/bin/env node
// postinstall: download the Windows binary from GitHub Releases into ~/.fuck/bin
// 版本感知：已安装版本与目标版本一致则跳过，否则自动更新。
const { execSync } = require("node:child_process")
const { existsSync, mkdirSync, writeFileSync, readFileSync } = require("node:fs")
const { homedir } = require("node:os")
const { join } = require("node:path")

// Override with FUCK_REPO env if you host the binaries elsewhere.
const REPO = process.env.FUCK_REPO || "zxzhaojunyao/fuck"
const VERSION = "v1.1.0"
const FILE = "fuck-windows-x64.zip"

const url = `https://github.com/${REPO}/releases/download/${VERSION}/${FILE}`
const binDir = join(homedir(), ".fuck", "bin")
const cache = join(binDir, FILE)
const outBin = join(binDir, "fuck.exe")
const versionFile = join(binDir, ".version")

function installedVersion() {
  try {
    return readFileSync(versionFile, "utf8").trim()
  } catch {
    return ""
  }
}

async function main() {
  if (process.platform !== "win32") {
    console.error("f-ai-cli currently ships Windows binaries only.")
    process.exit(0)
  }

  // 版本一致且二进制存在 → 跳过；否则（首次安装 / 升级）重新下载
  const current = installedVersion()
  if (existsSync(outBin) && current === VERSION) {
    console.log(`FUCK ${VERSION} already installed.`)
    return
  }

  mkdirSync(binDir, { recursive: true })
  if (current) console.log(`Updating FUCK ${current} -> ${VERSION} ...`)
  else console.log(`Downloading FUCK ${VERSION} (${FILE})...`)

  const res = await fetch(url)
  if (!res.ok) {
    console.error(`Download failed (HTTP ${res.status}). Release not published yet?`)
    console.error(`  ${url}`)
    console.error("After publishing the GitHub release, re-run: npm rebuild f-ai-cli")
    process.exit(0) // don't fail npm install; user can rebuild later
  }
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(cache, buf)

  // 用 tar 解压（Windows 10 1803+ 自带 tar.exe，无需 PowerShell）
  execSync(`tar -xf "${cache}" -C "${binDir}"`)

  // 写入版本标记，下次安装据此判断是否需要更新
  writeFileSync(versionFile, VERSION, "utf8")
  if (current) console.log(`FUCK updated to ${VERSION}: ${outBin}`)
  else console.log(`FUCK installed: ${outBin}`)
  console.log("Open a NEW terminal and type: fuck")
}

main()
