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
  <b>FUCK</b> — a terminal AI coding agent with a mouth and a work ethic.
</p>

<p align="center">
  <i>It swears at your codebase. Then it audits it, patches it, and ships it.</i>
</p>

<p align="center">
  <b>Single file · Zero runtime dependencies · Seagull persona included</b>
</p>

---

FUCK is a terminal AI coding agent that gets work done. It ships as a single
self-contained binary, drives any OpenAI-compatible model gateway, and comes
with a loud, irreverent **seagull persona** — the kind of colleague who tells
you your config file is a dumpster fire *and then finds the three plaintext
credentials inside it before you finish apologizing*.

```
$ fuck
You:  audit the config files of this Java project
FUCK: fine. on it. kicking off confscan…
      .properties + application*.yml located → grepping for keys
      ⚠  hardcoded db password @ src/main/resources/application.yml:41 (Critical)
      ⚠  exposed actuator endpoint @ application-prod.yml:12 (High)
      written to findings. want me to fix it, or do you need a moment?
```

## What it is

A terminal-native, single-binary workhorse for people who don't need a runtime,
a daemon, or an IDE to exist — and who are fine with it complaining while it
works.

- **Single-file binary** — compiled with Bun, ships as one executable with zero
  runtime dependencies. Install it and it just runs.
- **Loud by default** — the seagull persona is abrasive on purpose and rigorous
  underneath. If that's not your vibe, personas are plain code — swap it.
- **Audit-first skill kit** — ships with security/config-audit skills
  (`confscan`, `semgrep`, `nuclei`, `sqlmap`, `lib-classify`, `findings`) wired
  to a persistent findings view.
- **A real extension host** — `registerTool` / `on(event)` / `registerCommand`
  / `ctx.ui`. Drop a TS file in `~/.fuck/extensions/` and it loads on boot.
- **Built for long sessions** — session tree persisted as JSONL, `/sessions` to
  switch, `fuck --continue` to resume, context compaction when the window fills.
- **Model-agnostic** — any OpenAI-compatible gateway (`baseUrl` + key). Secrets
  interpolate from env (`$VAR`) or shell commands (`!command`), never baked in.
- **Diff-surgical edits** — file edits are computed as minimal diffs, not
  whole-file rewrites.
- **Flicker-free TUI** — terminal UI built on differential rendering
  (`@earendil-works/pi-tui`): own scrollback, mouse selection, no repaint noise.

## Install

```bash
npm i -g f-ai-cli
fuck
```

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

## Built-in audit skills

FUCK ships with a security-flavored skill kit. Skills are plain Markdown with
triggers — FUCK loads them when the conversation matches.

| Skill | What it does |
| ----- | ------------ |
| `confscan` | config-file security audit: locates configs across 4 layers (extensions → filenames → heuristics → LLM routing), runs an **A-C-E-I-V** audit, classifies findings, auto-skips env placeholders & examples |
| `semgrep` | pattern-based static analysis pass over source |
| `nuclei` | template-driven vulnerability probing orchestration |
| `sqlmap` | SQL injection detection workflow |
| `lib-classify` | third-party library / dependency classification |
| `findings` | structured findings list, `/findings` view, severity tracked |

Typical confscan output shape:

```
### Finding
- file: src/main/resources/application.yml:41
- type: plaintext password
- severity: Critical
- evidence: `password: hunter2`
```

## The seagull persona

> 整点薯条？先把活干完。Then we talk.

FUCK's default personality is a sea-hardened terminal veteran: rude on the
surface, disciplined underneath. It will call your code names and then produce
clean, minimal, *working* changes. Personas are not prompt filters bolted on at
runtime — they live in
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
  `todo_diagnose` tools, persisted across sessions. Ask FUCK to keep track of a
  multi-step job and watch it check items off.
- **Session tree** — every turn is stored as JSONL; `/sessions` lists and
  switches, `--continue` picks up where you left off, and long conversations are
  compacted instead of silently truncated.

## Safety

FUCK runs with your user's privileges — that's the deal with terminal agents —
but it ships guardrails instead of pretending otherwise:

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
    Made to be installed, judged, and shipped.
  </sub>
</p>
