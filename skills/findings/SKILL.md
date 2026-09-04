---
name: findings
description: triggers: findings, vulnerability record, vuln report, record vulns, organize vulns, export report, poc record
---

# Findings — vulnerability recording & reporting

Structurally record confirmed vulnerabilities found during audit/scanning, then export a report.

## Record format

When you confirm a vulnerability, append an entry to `~/.fuck/findings/<target>.md` (with the `edit` tool):

```markdown
## [severity] title
- target: <URL/IP/project>
- type: injection / XSS / misconfig / info leak / deserialization / ...
- file: <path:line> (for code audits)
- evidence: `key output snippet`
- repro: steps or payload
- impact: one sentence
- status: to-verify / confirmed / fixed
```

Use Critical / High / Medium / Low for severity.

## Summarize & export

At the end of the task, `read` all findings and output a summary:

```
### Summary
Critical: N
High: N
Medium: N
Low: N
Top priority: <title>
```

## Principles

- Record only **confirmed** findings (reproducible or with clear evidence); mark suspected ones "to-verify".
- Evidence must quote the original snippet, not just "there is an injection".
- Merge the same target into one file, sorted by severity.
