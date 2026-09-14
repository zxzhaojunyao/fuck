# Contributing

Thanks for wanting to contribute to FUCK.

## Dev environment

- [Bun](https://bun.sh) >= 1.4.0

```bash
bun install
bun run typecheck   # type check
bun run test        # offline tests
bun run build       # compile the single-file binary
```

## Architecture

```
packages/persona   seagull persona
packages/agent     agent-core: agent-loop / agent / hooks / harness(session/compaction/skills/system-prompt/error-memory)
packages/coding    tools: read/write/edit/bash/powershell/grep/find/ls + bash-executor + edit-diff
packages/config    config / model
packages/tui       terminal UI
```

## Conventions

- Branch: `main` is the stable branch
- PR: describe the change clearly + include test/verification results
- Style: TypeScript strict, follow existing patterns
- Commit message: `<type>: <summary>` (feat/fix/refactor/chore...)

## Tests

All offline tests must pass (`bun run test`):

```
agent integration (single-turn loop / hooks / truncation guard / steering)
session + compaction
coding tools (read/write/edit/bash/powershell/grep/find/ls)
```

## Release

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds the Windows binary and uploads it to GitHub Releases.

## Code of conduct

Be friendly. Do not introduce malicious code / backdoors / secret leaks.
