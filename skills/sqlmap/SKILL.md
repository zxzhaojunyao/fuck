---
name: sqlmap
description: triggers: sqlmap, SQL injection, SQLi, injection detection, blind injection, get injection, post injection
---

# Sqlmap — SQL injection detection & exploitation

Detect and verify SQL injection points with sqlmap. **Use only on authorized targets.**

## Prerequisites

1. `sqlmap --version`; if missing, `pip install sqlmap`.
2. Parameter sources: URL params, POST body, Cookie, Header.

## Usage

```bash
# GET parameter detection
sqlmap -u "https://target/page?id=1" --batch

# POST body
sqlmap -u "https://target/login" --data "user=1&pass=2" --batch

# specific parameter + risk level
sqlmap -u "https://target/page?id=1" -p id --level=2 --risk=2

# detect only (grab db fingerprint)
sqlmap -u "https://target/page?id=1" --banner

# enumerate databases (in scope)
sqlmap -u "https://target/page?id=1" --dbs
```

## Analysis flow

1. First quick-detect with `--batch --level=1`, confirm the injection type (error / boolean-blind / time-blind / union)
2. Once confirmed, `--banner` for the fingerprint before deciding whether to go deeper
3. Record injection point, type, payload, affected tables
4. Record in findings

## Notes

- Time-based blind is slow; lower `--time-sec=2`
- On production targets, avoid destructive operations beyond `--dbs`
- Use `--batch -v 0` to cut noise when output is long

## Output

For each confirmed injection point: URL, parameter, type, payload, db fingerprint, impact scope.
