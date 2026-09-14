---
name: nuclei
description: triggers: nuclei, web scan, vuln scan, URL scan, target scan, subdomain, recon
---

# Nuclei — web vulnerability scanning

Use nuclei for template-based scanning of web targets (tens of thousands of PoC templates covering CVEs / misconfig / exposure).

## Prerequisites

1. `nuclei -version`; if missing, `go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest` or grab a release.
2. Targets must be **in scope** (authorized). Confirm authorization before scanning.

## Usage

```bash
# single target (auto download/update templates)
nuclei -u https://target -severity low,medium,high,critical

# batch list
nuclei -l targets.txt -severity high,critical

# specific template dirs
nuclei -u https://target -t cves/ -t misconfiguration/

# JSON output for attribution
nuclei -u https://target -json -o /tmp/nuclei.json
```

## Analysis flow

1. Start with `-severity high,critical` to control noise
2. Cross-verify hits: curl to reproduce, confirm not a false positive (generic match, 404 page)
3. Record confirmed vulns in findings
4. Hand off deeper validation (e.g. injection) to sqlmap / manual

## Common template groups

- `cves/`: known CVE PoCs
- `misconfiguration/`: misconfigs
- `exposures/`: info leaks
- `technologies/`: fingerprinting

## Output

For each confirmed vuln: target, template ID, type, severity, repro steps.
