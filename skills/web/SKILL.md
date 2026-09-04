---
name: web
description: triggers: CTF, WEB, web漏洞, web挖掘, 漏洞挖掘, 自动渗透, 自主发现, CVE, web scan, web vuln, web attack, web pentest, 网站漏洞, 渗透测试, 自动化渗透
---

# WEB 漏洞挖掘 — CTF 自动化工作流

对 Web 目标执行全自动漏洞挖掘：信息收集 → 指纹识别 → 子域名枚举 → 目录爆破 → 模板扫描 → 定向验证 → 漏洞记录。

## 工具清单

| 工具 | 路径 | 用途 |
|---|---|---|
| nuclei | `~/.fuck/tools/nuclei.exe` | CVE/错误配置模板化扫描 |
| httpx | `~/.fuck/tools/httpx.exe` | HTTP 探测/指纹识别 |
| katana | `~/.fuck/tools/katana.exe` | 爬虫/参数发现 |
| subfinder | `~/.fuck/tools/subfinder.exe` | 子域名枚举 |
| dnsx | `~/.fuck/tools/dnsx.exe` | DNS 解析 |
| ffuf | `~/.fuck/tools/ffuf.exe` | 目录/参数 fuzz |
| sqlmap | `D:/Scoop/apps/python/current/Scripts/sqlmap.exe` | SQL 注入 |
| wafw00f | `D:/Scoop/apps/python/current/Scripts/wafw00f.exe` | WAF 识别 |
| nmap | `nmap` | 端口扫描 |

## 工作流：五阶段推进

### 阶段 1: 侦察 Recon（快速拓扑）

```bash
# 1a. WAF 检测（识别防御）
wafw00f <target_url>

# 1b. 端口扫描（快速模式）
nmap -sV -sC --top-ports 1000 -T4 -oN /tmp/nmap_scan.txt <target_ip>
# 或者批量
nmap -sV -sC -T4 -iL targets.txt -oN /tmp/nmap_scan.txt

# 1c. HTTP 指纹识别
httpx -u <target_url> -tech-detect -status-code -title -server -o /tmp/httpx_fingerprint.txt
# 批量
httpx -l targets.txt -tech-detect -status-code -title -o /tmp/httpx_fingerprint.txt

# 1d. 子域名发现
subfinder -d <target_domain> -o /tmp/subdomains.txt
# 解析验证
dnsx -l /tmp/subdomains.txt -a -aaaa -cname -resp -o /tmp/subdomains_resolved.txt
```

### 阶段 2: 爬虫与参数发现 Crawl

```bash
# 2a. katana 爬虫（获取 URL 和参数）
katana -u <target_url> -js-crawl -d 3 -o /tmp/katana_urls.txt

# 2b. 目录/文件爆破
ffuf -u <target_url>/FUZZ -w ~/.fuck/wordlists/common.txt -ac -o /tmp/ffuf_dirs.json
# 短字典快速模式
ffuf -u <target_url>/FUZZ -w ~/.fuck/wordlists/dir_small.txt -ac -o /tmp/ffuf_dirs.json

# 2c. 参数发现
ffuf -u <target_url>/?FUZZ=test -w ~/.fuck/wordlists/params.txt -ac -o /tmp/ffuf_params.json
```

### 阶段 3: 自动化扫描 Auto

```bash
# 3a. nuclei 全量模板扫描（CVE + 错误配置 + 信息泄露）
nuclei -u <target_url> -severity low,medium,high,critical -json -o /tmp/nuclei_scan.json

# 3b. 对子域名列表批量扫描
nuclei -l /tmp/subdomains_resolved.txt -severity high,critical -json -o /tmp/nuclei_subs.json

# 3c. 对爬虫 URL 列表扫描
nuclei -l /tmp/katana_urls.txt -severity high,critical -json -o /tmp/nuclei_urls.json
```

### 阶段 4: 定向验证 Verify

```bash
# 4a. SQLi 验证（有参数的点）
sqlmap -u "<url_with_param>" --batch --level=1 --banner
# 高级检测
sqlmap -u "<url_with_param>" --batch --level=2 --risk=2 --banner

# 4b. POST 注入
sqlmap -u "<url>" --data "param1=val1&param2=val2" --batch --banner

# 4c. 对 nuclei 发现的漏洞 curl 复现
curl -v "<poc_request>"

# 4d. 可疑参数手动验证（SSRF/LFI/RCE 等）
# 根据 nuclei 命中结果，用 curl 逐一验证误报
```

### 阶段 5: 记录 Findings

每个确认漏洞用 findings skill 记录：
- 目标 URL
- 漏洞类型（CVE/注入/错误配置/信息泄露）
- 严重度（Critical/High/Medium/Low）
- 复现步骤
- 证据（输出片段）

## 命令模板速查（直接 copy 用）

### 单目标完整扫描

```bash
# 1. 侦察
wafw00f TARGET_URL
httpx -u TARGET_URL -tech-detect -status-code -title -server -o /tmp/httpx_fp.txt

# 2. 子域名
subfinder -d TARGET_DOMAIN -o /tmp/subs.txt
dnsx -l /tmp/subs.txt -a -resp -o /tmp/subs_ok.txt

# 3. 爬虫
katana -u TARGET_URL -d 2 -o /tmp/urls.txt

# 4. nuclei（关键！）
nuclei -u TARGET_URL -severity low,medium,high,critical -json -o /tmp/nuclei.json

# 5. 对结果手工验证
# （读 /tmp/nuclei.json，找 info.name / info.severity / matched-at）
```

### 无字典时的目录爆破回退

```bash
# 用 nuclei 的 fuzzing 模板或直接手工
ffuf -u TARGET_URL/FUZZ -w /dev/stdin <<< $'admin\nlogin\napi\nbackup\ntest\ndev\n.git\n.env\nwp-admin\nconsole\nswagger'
```

## 判定规则

1. **nuclei 命中 High/Critical** → 立即 curl 验证，确认后记 findings
2. **nuclei 命中 Medium** → 酌情验证，看是否可串联利用
3. **sqlmap 确认注入** → 直接记 Critical findings
4. **目录爆破发现敏感路径**（.git/.env/backup/phpinfo）→ Medium 起步
5. **指纹识别发现已知漏洞组件**（struts/weblogic/tomcat AJP）→ 找该组件对应的 nuclei 模板重扫

## 无字典回退策略

如果 `~/.fuck/wordlists/` 没有字典，生成最小字典直接使用：

```bash
# 最小目录字典
echo -e "admin\nlogin\napi\nbackup\ntest\ndev\n.git\n.env\nwp-admin\nconsole\nswagger\nactuator\ndebug\nphpinfo\nphpmyadmin\ncgi-bin\nconfig\ninstall\nupload\ndownload\ntmp\nlogs\nstatus\nmetrics\nhealth\ninfo" > /tmp/dir_mini.txt
ffuf -u TARGET_URL/FUZZ -w /tmp/dir_mini.txt -ac
```

## 输出

每个确认漏洞给：目标、漏洞类型、严重度、复现步骤、证据。最终汇总 High/Critical 数量和最高优先处理项。