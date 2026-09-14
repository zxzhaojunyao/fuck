---
name: web
description: triggers: CTF, WEB, web漏洞, web挖掘, 漏洞挖掘, 自动渗透, 自主发现, CVE, web scan, web vuln, web attack, web pentest, 网站漏洞, 渗透测试, 自动化渗透
---

# WEB 漏洞挖掘 — CTF 自动化工作流

**运行环境: 离线靶场，禁止外网。所有工具本地安装，禁止 web_search/fetch_url 下载。**

## 工具清单（全部本地）

| 工具 | 路径 | 调用方式 |
|---|---|---|
| nuclei | `~/.fuck/tools/nuclei.exe` | `powershell -NoProfile -File ~/.fuck/tools/run.ps1 -- ~/.fuck/tools/nuclei.exe <args>` |
| httpx | `~/.fuck/tools/httpx.exe` | 同上 run.ps1 包装 |
| katana | `~/.fuck/tools/katana.exe` | 同上 run.ps1 包装 |
| subfinder | `~/.fuck/tools/subfinder.exe` | 同上 run.ps1 包装 |
| dnsx | `~/.fuck/tools/dnsx.exe` | 同上 run.ps1 包装 |
| ffuf | `~/.fuck/tools/ffuf.exe` | 直接调用（ffuf 无 ANSI 问题） |
| sqlmap | `D:/Scoop/apps/python/current/Scripts/sqlmap.exe` | 直接调用 |
| wafw00f | `D:/Scoop/apps/python/current/Scripts/wafw00f.exe` | 直接调用 |
| nmap | `nmap` | 直接调用 |

> **编码规则**: 所有 Go 工具（nuclei/httpx/katana/subfinder/dnsx）必须通过 `run.ps1` 包装，剥离 ANSI 转义码。Python 工具和 nmap 直接调用即可。

## 工作流：五阶段推进

### 阶段 1: 侦察 Recon

```bash
# 1a. WAF 检测
wafw00f <target_url>

# 1b. 端口扫描（快速模式）
nmap -sV -sC --top-ports 1000 -T4 -oN /tmp/nmap_scan.txt <target_ip>

# 1c. HTTP 指纹
powershell -NoProfile -File ~/.fuck/tools/run.ps1 -- ~/.fuck/tools/httpx.exe -u <target_url> -tech-detect -status-code -title -server -nc -o /tmp/httpx_fp.txt

# 1d. 子域名发现
powershell -NoProfile -File ~/.fuck/tools/run.ps1 -- ~/.fuck/tools/subfinder.exe -d <target_domain> -silent -o /tmp/subs.txt
powershell -NoProfile -File ~/.fuck/tools/run.ps1 -- ~/.fuck/tools/dnsx.exe -l /tmp/subs.txt -a -resp -nc -o /tmp/subs_ok.txt
```

### 阶段 2: 爬虫与参数发现 Crawl

```bash
# 2a. katana 爬虫
powershell -NoProfile -File ~/.fuck/tools/run.ps1 -- ~/.fuck/tools/katana.exe -u <target_url> -d 2 -nc -o /tmp/urls.txt

# 2b. 目录爆破（无字典时用内联最小字典，见底部）
ffuf -u <target_url>/FUZZ -w ~/.fuck/wordlists/dir_small.txt -ac -o /tmp/ffuf_dirs.json

# 2c. 参数发现
ffuf -u <target_url>/?FUZZ=test -w ~/.fuck/wordlists/params_small.txt -ac -o /tmp/ffuf_params.json
```

### 阶段 3: 自动化扫描 Auto Star

```bash
# 3a. nuclei 全量模板扫描
powershell -NoProfile -File ~/.fuck/tools/run.ps1 -- ~/.fuck/tools/nuclei.exe -u <target_url> -severity low,medium,high,critical -silent -json -o /tmp/nuclei.json

# 3b. 子域名批量
powershell -NoProfile -File ~/.fuck/tools/run.ps1 -- ~/.fuck/tools/nuclei.exe -l /tmp/subs_ok.txt -severity high,critical -silent -json -o /tmp/nuclei_subs.json

# 3c. 爬虫 URL 批量
powershell -NoProfile -File ~/.fuck/tools/run.ps1 -- ~/.fuck/tools/nuclei.exe -l /tmp/urls.txt -severity high,critical -silent -json -o /tmp/nuclei_urls.json
```

### 阶段 4: 定向验证 Verify

```bash
# 4a. SQLi 验证
sqlmap -u "<url_with_param>" --batch --level=1 --banner

# 4b. POST 注入
sqlmap -u "<url>" --data "param1=val1&param2=val2" --batch --banner

# 4c. nuclei 命中复现
curl -v "<poc_url>"

# 4d. 读 nuclei JSON 输出
cat /tmp/nuclei.json | python -c "import json,sys; [print(f'{i[\"info\"][\"name\"]} | {i[\"info\"][\"severity\"]} | {i[\"matched-at\"]}') for i in [json.loads(l) for l in sys.stdin]]"
```

### 阶段 5: 记录 Findings

每个确认漏洞用 findings skill 记录：目标 URL、漏洞类型、严重度、复现步骤、证据。

## 单目标完整扫描命令（一键复制）

```bash
# 1. 侦察
wafw00f TARGET_URL
powershell -NoProfile -File ~/.fuck/tools/run.ps1 -- ~/.fuck/tools/httpx.exe -u TARGET_URL -tech-detect -status-code -title -server -nc -o /tmp/httpx_fp.txt

# 2. 子域名
powershell -NoProfile -File ~/.fuck/tools/run.ps1 -- ~/.fuck/tools/subfinder.exe -d TARGET_DOMAIN -silent -o /tmp/subs.txt
powershell -NoProfile -File ~/.fuck/tools/run.ps1 -- ~/.fuck/tools/dnsx.exe -l /tmp/subs.txt -a -resp -nc -o /tmp/subs_ok.txt

# 3. 爬虫
powershell -NoProfile -File ~/.fuck/tools/run.ps1 -- ~/.fuck/tools/katana.exe -u TARGET_URL -d 2 -nc -o /tmp/urls.txt

# 4. nuclei（关键！）
powershell -NoProfile -File ~/.fuck/tools/run.ps1 -- ~/.fuck/tools/nuclei.exe -u TARGET_URL -severity low,medium,high,critical -silent -json -o /tmp/nuclei.json

# 5. 手工验证（读 nuclei JSON 找高价值命中）
cat /tmp/nuclei.json
```

## 判定规则

1. **nuclei 命中 High/Critical** → 立即 curl 验证，确认后记 findings
2. **nuclei 命中 Medium** → 酌情验证
3. **sqlmap 确认注入** → 直接记 Critical
4. **目录爆破发现敏感路径**（.git/.env/backup/phpinfo）→ Medium 起步

## 离线环境注意事项

- 禁止 web_search / fetch_url 尝试下载字典或工具
- 所有工具已预装，路径固定
- 字典在 `~/.fuck/wordlists/` 下
- nuclei 模板已预下载，不要跑 `-update-templates`