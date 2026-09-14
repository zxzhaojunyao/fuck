---
name: semgrep
description: triggers: semgrep, static analysis, SAST, code audit, source vuln, find bugs
---

# Semgrep — static code audit

Run SAST with semgrep to find injection, XSS, command execution, dangerous functions, and other vuln patterns in source.

## Prerequisites

1. Confirm semgrep installed: `semgrep --version`. If missing, `pip install semgrep` or `npm i -g semgrep`.
2. First determine the project language: `ls` / `find` for `.js .ts .py .go .java .rb .php` entrypoints.

## Usage

```bash
# scan the whole project with the auto ruleset
semgrep --config=auto .

# language-specific rules (faster)
semgrep --config=p/owasp-top-ten --lang=py .
semgrep --config=p/javascript .

# scan a directory, JSON output for attribution
semgrep --config=auto --json -o /tmp/semgrep.json path/
```

## Analysis flow

1. Run `--config=auto` (or pick rules by language) and get the hit list
2. Cross-verify each hit with `read`: is the data flow controllable? is there filtering/escaping?
3. Drop false positives (test code, unreachable branches, already escaped)
4. Record confirmed vulns in findings (use the findings skill)

## Common rulesets

- `p/owasp-top-ten`: OWASP Top 10
- `p/security-audit`: general security audit
- `p/r2c`: security + correctness
- `p/secrets`: hardcoded secrets

## Output

For each confirmed vuln: file:line, rule, vuln type, brief data flow, severity.
