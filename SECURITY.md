# Security Policy

## Reporting a vulnerability

If you find a security issue (e.g. secret leak, command injection, privilege escalation), **do not** open a public issue. Contact the maintainer privately.

## Known considerations

- FUCK runs in **admin mode** by default (all tools execute without approval). Be careful in production/shared environments.
- `~/.fuck/config.json` stores your API key — keep it permission-restricted and never commit it.
- Session records (`~/.fuck/sessions/*.jsonl`) may contain sensitive info; mind the leak risk when backing up/sharing.

## Dependencies

- Keep dependencies up to date. Merge only after `bun run typecheck && bun run test` pass.
- Pin versions via `bun.lock`; CI uses a fixed Bun version (1.4.0).
