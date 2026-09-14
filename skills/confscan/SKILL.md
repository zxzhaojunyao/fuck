---
name: confscan
description: triggers: config scan, confscan, find plaintext passwords, config audit, sensitive info, dangerous config, hardcoded keys
---

# ConfigScan — configuration file security scan

Audit configuration files in a project for hardcoded keys, plaintext passwords, dangerous settings, and other app-security risks.

## Four-layer identification (in order)

1. **Hard rules**: use `find` + `grep` to locate config files — by extension (`.properties` `.yaml` `.yml` `.json` `.xml` `.ini` `.conf` `.config` `.env`) and by special filenames (`application*.yml` `*.properties` `*.conf` `docker-compose*.yml` `*.pom`).
2. **Heuristic**: read candidates and look for high key-value density lines in the forms `key=value`, `key: value`, `key => value`.
3. **LLM routing**: for uncertain formats, read a small snippet to judge whether it is config (credentials / connection strings / switches).
4. **Parse & extract**: for known formats, extract each key-value pair precisely (don't write your own parser — combine `read` + `grep`).

## Audit framework (A-C-E-I-V)

- **A (Analyze)**: first identify what this config is and which component it belongs to (db / cache / mq / third-party SDK / deploy script).
- **C (Categorize)**: classify each entry — credential, connection string, key, dangerous switch, weak crypto, exposed debug endpoint.
- **E (Execute)**: cross-verify each suspect with `grep`/`read` (is it referenced? does it actually leak?).
- **I (Integrate)**: collect into a findings list, annotating each with file:line, type, severity, raw evidence.
- **V (Verify)**: drop false positives and output the final conclusion.

## Automatic exclusions (do not report)

- values from env placeholders (`${VAR}` `$VAR` `{env:VAR}`)
- empty or placeholder values (`xxx` `changeme` `your_key` `example` `placeholder`)
- example values inside comments
- test/example files (`test` `example` `sample` `demo` dirs)

## Severity levels

- **Critical**: directly usable credentials (db password, API key, private key, token)
- **High**: sensitive connection strings, weak crypto, dangerous switches
- **Medium**: leaked internal paths/hostnames, debug endpoints
- **Low**: info-gathering, hints in comments

## Output format

```
### Finding
- file: relative/path:line
- type: plaintext password / API key / dangerous config / ...
- severity: Critical / High / Medium / Low
- evidence: `raw snippet`
```

Finish with a summary: how many Critical/High, and the single highest-priority item.
