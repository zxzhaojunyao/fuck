<p align="center">
  <img src="https://img.shields.io/npm/v/f-ai-cli?style=flat-square&label=npm" alt="npm">
  <img src="https://img.shields.io/github/actions/workflow/status/zxzhaojunyao/fuck/release.yml?style=flat-square&label=release" alt="release">
  <img src="https://img.shields.io/github/license/zxzhaojunyao/fuck?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/runtime-bun%20%E2%89%A51.4-black?style=flat-square&logo=bun" alt="bun">
</p>

<div align="center">

<pre>
███████╗██╗   ██╗ ██████╗██╗  ██╗
██╔════╝██║   ██║██╔════╝██║ ██╔╝
█████╗  ██║   ██║██║     █████═╝ 
██╔══╝  ██║   ██║██║     ██╔═██╗ 
██║     ╚██████╔╝╚██████╗██║ ╚██╗
╚═╝      ╚═════╝  ╚═════╝╚═╝  ╚═╝</pre>

</div>

<p align="center">
  <b>FUCK</b> — a terminal-native offensive security agent with a mouth and a kill chain.
</p>

<p align="center">
  <i>Recon. Breach. Own. Then write the report before the coffee gets cold.</i>
</p>

<p align="center">
  <b>Single file · Zero runtime dependencies · Adversary persona included</b>
</p>

---

FUCK is a terminal-native offensive security agent built for authorized
red-team engagements. It ships as a single self-contained binary, drives any
OpenAI-compatible model gateway, and thinks like an operator: loud on the
surface, methodical underneath — the kind of teammate who calls your attack
surface *amateur hour* and then chains a config leak into a foothold before you
finish your coffee.

```
$ fuck
You:  scope: 10.0.100.0/24 — find me a way in
FUCK: fine. on it. kicking off recon…
      → live hosts: 14 · admin panels exposed: 3
      → CVE-2024-XXXX hit on ops.internal:8443 (Critical)
      → hardcoded LDAP bind creds @ /srv/app/.env
      foothold acquired: shell on ops.internal as svc-deploy
      want me to pivot, or do you need a moment?
```

## What it is

A terminal-native, single-binary operator for engagements where you refuse to
babysit a runtime — and you're fine with it running its mouth while it walks the
kill chain.

- **Single-file binary** — compiled with Bun, ships as one executable with zero
  runtime dependencies. Drop it on a box and it runs.
- **Adversary persona by default** — the seagull persona is abrasive on purpose
  and disciplined underneath. If that's not your vibe, personas are plain code —
  swap it.
- **Offensive skill kit** — recon → exploitation → reporting out of the box:
  `confscan`, `semgrep`, `nuclei`, `sqlmap`, `lib-classify`, `findings`, wired to
  a persistent findings view.
- **A real extension host** — `registerTool` / `on(event)` / `registerCommand`
  / `ctx.ui`. Drop a TS file in `~/.fuck/extensions/` and your own tooling loads
  on boot.
- **Built for long engagements** — session tree persisted as JSONL, `/sessions`
  to switch, `fuck --continue` to resume a campaign, context compaction when the
  window fills.
- **Model-agnostic** — point it at any OpenAI-compatible gateway (`baseUrl` +
  key). Secrets interpolate from env (`$VAR`) or shell commands (`!command`),
  never baked in.
- **Diff-surgical edits** — file edits are computed as minimal diffs, not
  whole-file rewrites. Payloads and PoCs stay clean.
- **Flicker-free TUI** — terminal UI built on differential rendering
  (`@earendil-works/pi-tui`): own scrollback, mouse selection, no repaint noise.

## Install

**Linux / macOS (one-liner, no sudo, no npm):**

```bash
curl -fsSL https://raw.githubusercontent.com/zxzhaojunyao/fuck/main/install.sh | bash
fuck
```

Downloads the matching binary (linux-x64 / linux-arm64) into `~/.fuck/bin/` and wires up your PATH. Pin a version with `FUCK_VERSION=v1.1.2`.

**npm (Windows / any platform):**

```bash
npm i -g f-ai-cli
fuck
```

> Linux note: on a system-wide Node install (apt/yum), `npm i -g` needs root and the binary lands under root's home. Prefer the one-liner above, or set a user-level prefix first (`npm config set prefix ~/.npm-global` + add `~/.npm-global/bin` to PATH).

> Slow network? `npm i -g f-ai-cli --registry=https://registry.npmmirror.com`

Single-file binaries are also attached to every
[GitHub Release](https://github.com/zxzhaojunyao/fuck/releases) — download, run,
done. No Node, no Python, no runtime to babysit.

Requires [Bun](https://bun.sh) ≥ 1.4 only if you build from source.

## Configuration

First run creates `~/.fuck/config.json`. Point it at any OpenAI-compatible
gateway:

```json
{
  "provider": {
    "tokenhub": {
      "baseUrl": "https://tokenhub.tencentmaas.com/v1",
      "apiKey": "$TOKENHUB_API_KEY",
      "api": "openai-completions",
      "models": [
        { "id": "deepseek-v4-pro-0813" },
        { "id": "glm-5.3-flash" }
      ]
    }
  },
  "model": "tokenhub/deepseek-v4-pro-0813"
}
```

**Secrets never live in the file.** `apiKey` accepts:

| Syntax | Meaning |
| ------ | ------- |
| `$VAR` | read from environment variable |
| `!command` | run a shell command and use its output |

Switch models any time with `/models` — fuzzy search across providers, grouped
by gateway.

## Usage

```bash
fuck                  # start in the current directory
fuck <dir>            # start in the given directory
fuck --continue       # resume the most recent session
fuck -p "text"        # one-shot execution (non-interactive)
```

### Slash commands

| Command | Purpose |
| ------- | ------- |
| `/models` | search + fuzzy-switch model |
| `/sessions` | switch / resume session |
| `/findings` | view audit findings |
| `/themes` | switch theme |
| `/todo` | view todo progress |
| `/help` | help |

### Key bindings

| Key | Action |
| --- | ------ |
| `Enter` | send (`Shift+Enter` newline) |
| `Tab` | complete (file path / slash command) |
| `Ctrl+C` / `Ctrl+Q` | quit |
| `Escape` | interrupt / close overlay |

## Built-in offensive skills

FUCK ships with an attack-flavored skill kit. Skills are plain Markdown with
triggers — FUCK loads them when the conversation matches.

| Skill | What it does |
| ----- | ------------ |
| `confscan` | secrets & misconfig hunting: locates configs across 4 layers (extensions → filenames → heuristics → LLM routing), runs an **A-C-E-I-V** audit, classifies findings, auto-skips env placeholders & examples |
| `semgrep` | pattern-based static analysis pass — source-level bug & vulnerability hunting |
| `nuclei` | template-driven vulnerability probing orchestration across live targets |
| `sqlmap` | SQL injection detection workflow |
| `lib-classify` | third-party library / dependency fingerprinting — flags known-vulnerable components |
| `findings` | structured engagement record, `/findings` view, severity tracked |

Typical confscan output shape:

```
### Finding
- file: src/main/resources/application.yml:41
- type: plaintext credential
- severity: Critical
- evidence: `password: hunter2`
```

## The seagull persona

> Get the job done first. Then we talk.

FUCK's default personality is a sea-hardened terminal veteran: rude on the
surface, disciplined underneath. It will call your attack surface names and then
produce clean, minimal, *working* exploits. Personas are not prompt filters
bolted on at runtime — they live in
[`packages/persona/src/basePersona.ts`](packages/persona/src/basePersona.ts) and
are part of the core loop, so you can read exactly what you're getting, fork it,
or replace it outright.

## Extension system

Drop a TypeScript module into `~/.fuck/extensions/` — it's loaded automatically
at startup:

```ts
export default function (fuck) {
  fuck.registerTool({
    name: "whoami",
    description: "return session info",
    schema: { type: "object", properties: {} },
    execute: async () => "session: " + fuck.getSessionName(),
  })

  fuck.on("tool_call", (event) => {
    if (event.toolCall.name === "bash") {
      // block or mutate args before execution
    }
  })

  fuck.registerCommand("hello", {
    description: "say hello",
    handler: async (_args, ctx) => ctx.ui.notify("hello"),
  })
}
```

Supported events: `session_start` / `session_shutdown` / `turn_start` /
`turn_end` / `tool_call` / `tool_result` / `context` /
`before_agent_start` / `model_select`.

## Todos & sessions

- **Built-in todo** — `todo_write` / `todo_read` / `todo_update` /
  `todo_diagnose` tools, persisted across sessions. Ask FUCK to track a
  multi-stage op and watch it check stages off.
- **Session tree** — every turn is stored as JSONL; `/sessions` lists and
  switches, `--continue` picks up a campaign where you left off, and long
  conversations are compacted instead of silently truncated.

## Rules of engagement

FUCK runs with your user's privileges inside the scope you give it — it's an
operator's tool, not a magic wand. **Use it only on systems you own or are
contracted to test. You set the scope, you own the authorization.**

It ships guardrails instead of pretending otherwise:

- **Dangerous-command interception** before execution.
- **Sandbox routing** — prefix commands with the `SANDBOX_CMD` route to push
  them into an external sandbox/host.
- Tool calls are events first: extensions can block or rewrite any `bash` call
  before it runs (see above).

Report issues via [SECURITY.md](SECURITY.md).

## Architecture

A Bun workspace monorepo — the compiled binary is just `packages/tui` +
everything below:

| Package | Role |
| ------- | ---- |
| `packages/persona` | persona definitions (`basePersona.ts`) |
| `packages/agent` | agent core: dual agent loop / event stream / tool hooks / session tree / context compaction / skills loader / extension host |
| `packages/coding` | tools: read/write/edit (diff-based) / bash / powershell / grep / find / ls + web search |
| `packages/config` | config & model layer (OpenAI-compatible adapter) |
| `packages/tui` | terminal UI (differential rendering on pi-tui) |
| `packages/desktop` | native desktop shell |

Stack: TypeScript · Bun · [`@ai-sdk/openai-compatible`](https://www.npmjs.com/package/@ai-sdk/openai-compatible)
· [`@earendil-works/pi-tui`](https://www.npmjs.com/package/@earendil-works/pi-tui)
· `chalk` · `diff`.

## Build from source

```bash
bun install
bun run typecheck
bun run test          # agent core + session + extension + coding suites
bun run build         # compile the single-file binary
```

## Contributing & license

- Contributions welcome — read [CONTRIBUTING.md](CONTRIBUTING.md) first.
- MIT licensed — see [LICENSE](LICENSE).
- Other docs: [Node setup notes](docs/NODE_SETUP.md).

<p align="center">
  <sub>
    Terminal UI powered by
    <a href="https://github.com/earendil-works/pi">@earendil-works/pi-tui</a> ·
    Recon it. Root it. Report it.
  </sub>
</p>
