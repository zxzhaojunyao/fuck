---
name: lib-classify
description: triggers: dependency classification, library identification, third-party components, pom, build.gradle, Maven deps
---

# LibClassify — three-tier Java dependency classification

Classify a Java project's third-party dependencies: in-house, well-known open source, or unknown/needs-confirmation. For dependency auditing and supply-chain review.

## Three-tier method (cheapest first)

1. **Rule engine (free)**: match built-in rules first, return immediately on hit, no external calls:
   - In-house: groupId is `com.<company>` / `cn.<company>` / the project's own package prefix
   - Known open source: `org.springframework.*` `org.apache.*` `com.google.*` `org.mybatis.*` `com.baomidou.*` `io.netty.*` `com.fasterxml.*` `org.slf4j.*` `com.alibaba.*` `mysql.*` `org.postgresql.*` `redis.clients.*` `org.projectlombok.*`
   - Known risky legacy: `commons-collections`(3.x) `log4j`(1.x) `struts2` `fastjson`(<=1.2.24) `shiro`(<=1.2.4) `xstream` old versions
2. **Remote query (next)**: if no rule matches and network is available, `fetch` Maven Central: `https://search.maven.org/solrsearch/select?q=g:"<groupId>"+AND+a:"<artifactId>"&rows=1&wt=json`
3. **LLM fallback (last)**: fall back to model knowledge, then write the conclusion back.

## Output format

```
### Dependency classification
| component | class | basis | notes |
|---|---|---|---|
| com.alibaba:fastjson:1.2.20 | known risky legacy | rule engine | fastjson old-version RCE, upgrade advised |
```

List risky components separately with CVE/risk hints and upgrade advice.
