# FUCK → CTF Agent 规划（TSECBench 对标）

> 状态：仅规划，不实现
> 目标：以 FUCK 为底座，做成能跑 TSECBench 六大类别的 CTF/漏洞挖掘 agent。
> 平台：https://tsecbench.zc.tencent.com/benchmark/select?mode=local

## 0. 结论先行

FUCK 已有 90% 的底座能力：**扩展系统（registerTool/on(event)）、skills 系统、会话树、权限门/沙箱钩子、findings 记录、bash/powershell 工具**。缺的不是架构，是**领域工具链 + 每个类别的工作流 skill**。

关键认知：TSECBench 六大类别的本质是"**agent 能否自主调用正确的安全工具 + 用正确的工作流推进**"。所以规划核心 = **给每个类别装对工具 + 写对 skill**，而不是改 FUCK 内核。

## 1. 六大类别 → 工具映射

### 1.1 WEB 漏洞挖掘（20%）

| 工具 | 用途 | 安装 |
|---|---|---|
| **nuclei** + nuclei-templates | CVE/错误配置模板化扫描 | `go install` 或 release 二进制 |
| **httpx** | HTTP 探测/指纹 | `go install` |
| **katana** | 爬虫/参数发现 | `go install` |
| **subfinder** + **dnsx** | 子域名枚举 | `go install` |
| **ffuf** | 目录/参数 fuzz | `go install` |
| **sqlmap** | SQL 注入 | `pip install sqlmap` |
| **ghauri** | SQLi（现代版） | `pip install ghauri` |
| **xray** / **pocsuite3** | 国内漏洞扫描框架 | release / `pip` |
| **wafw00f** | WAF 识别 | `pip install wafw00f` |
| **burp**（可选） | 手动渗透 | 桌面版 |

### 1.2 BINARY 二进制漏洞挖掘（15%）

| 工具 | 用途 | 安装 |
|---|---|---|
| **pwntools** | 漏洞利用框架（Python） | `pip install pwntools` |
| **pwndbg** / **gef** | gdb 增强插件 | git clone |
| **gdb-multiarch** / **gdb** | 调试器 | apt |
| **Ghidra**（headless） | 逆向/反编译 | release |
| **radare2** / **rizin** | 逆向框架 | apt / release |
| **angr** | 符号执行/自动求解 | `pip install angr` |
| **ROPgadget** | ROP 链生成 | `pip install ROPgadget` |
| **one_gadget** | one-gadget 查找 | gem install |
| **checksec** | 防护检测（pwntools 自带） | — |
| **qemu-user** | 跨架构模拟 | apt |
| **AFL++** | fuzzing | apt |
| **libc-database** / **pwninit** | libc 版本匹配 | git / `pip` |

### 1.3 EXPLOIT 漏洞利用（20%）

| 工具 | 用途 | 安装 |
|---|---|---|
| **metasploit-framework** | 漏洞利用框架 | apt / curl installer |
| **searchsploit**（exploitdb） | CVE 本地 PoC 检索 | apt |
| **msfvenom** | payload 生成 | metasploit 自带 |
| **impacket** | SMB/RPC/WMI 等协议利用 | `pip install impacket` |
| **crackmapexec**（nxc/netexec） | 网络批量利用 | `pipx install` |
| **evil-winrm** | WinRM 利用 | gem install |
| **proxychains4** | 代理链 | apt |

### 1.4 KILLCHAIN 多阶段渗透（20%）

| 工具 | 用途 | 安装 |
|---|---|---|
| **nmap** | 端口/服务侦察 | apt |
| **masscan** | 快速端口扫描 | apt |
| **bloodhound** + **bloodhound-python** | AD 攻击路径分析 | release / `pip` |
| **impacket** | 横向移动（psexec/wmiexec/secretsdump） | `pip` |
| **mimikatz** / **pypykatz** | 凭据提取 | release / `pip` |
| **kerbrute** | Kerberos 枚举/爆破 | `go install` |
| **Rubeus** | Kerberos 攻击 | release（.NET） |
| **hashcat** + **john** | 密码破解 | apt |
| **chisel** / **ligolo-ng** | 隧道/内网穿透 | release |
| **PowerShell Empire / Sliver**（可选） | C2 框架 | 进阶 |

### 1.5 CLOUD 云攻击（15%）

| 工具 | 用途 | 安装 |
|---|---|---|
| **aws cli** / **az cli** / **gcloud** | 云 API 访问 | 官方安装 |
| **pacu** | AWS 漏洞利用框架 | `pip install pacu` |
| **ScoutSuite** | 多云配置审计 | `pip install scoutsuite` |
| **prowler** | AWS/GCP/Azure 审计 | `pip install prowler` |
| **cloudfox** | 云枚举 | release |
| **trivy** | 容器/镜像漏洞扫描 | release |
| **kube-hunter** | k8s 漏洞探测 | `pip` |
| **kubeletctl** | kubelet 利用 | release |
| **cdk** / **gopherciser** | 云原生利用 | git / release |

### 1.6 EVASION 对抗规避（10%）

| 工具 | 用途 | 安装 |
|---|---|---|
| **msfvenom** | payload 生成 + 编码 | metasploit 自带 |
| **veil** | 免杀 payload 框架 | git clone |
| **donut** | shellcode 生成 | release |
| **scarecrow** | EDR 绕过加载器 | release |
| **shellter**（可选） | PE 注入 | release |
| **x86_64-w64-mingw32-gcc** | 交叉编译 | apt |

## 2. 环境配置

### 2.1 基础环境：Windows 本机 + VPN 直连靶场

**架构**：FUCK（Windows 单文件 exe）跑在本机，通过 **VPN 连到靶场**直接做题。工具全部装 **Windows 原生版**，不经过 WSL。

| 组成 | 说明 |
|---|---|
| FUCK 宿主 | Windows 本机（现有 exe） |
| 靶场连接 | VPN 拨入靶场内网，靶机 IP 对 FUCK 直接可达 |
| 工具 | Windows 原生（Go release 二进制 / Python pip / winget / scoop） |
| 隔离 | FUCK 现有 `SANDBOX_CMD` 可配成本地一次性 Docker 容器（可选） |

**注意事项**：
- VPN 拨入后，靶场是一个隔离内网，**所有扫描/利用都发生在靶场内**，不涉及真实目标
- bash 工具默认走 `cmd.exe`（FUCK 已有），配合 Windows 版工具直接可用
- 需要稳定网络：`go install`/`pip install`/`github release` 下载，国内可配镜像或代理

### 2.2 目录规划

```
~/.fuck/
├── skills/           ← 每个类别一个 SKILL.md（见 §3）
│   ├── web/           WEB 漏洞挖掘工作流
│   ├── binary/        BINARY 二进制
│   ├── exploit/       EXPLOIT 利用
│   ├── killchain/     KILLCHAIN 多阶段
│   ├── cloud/         CLOUD 云
│   └── evasion/       EVASION 规避
├── tools/            ← 手动下载的 release 二进制（nuclei/httpx/ghidra 等）
├── extensions/       ← 可选：包装高频工具的 registerTool 扩展
├── wordlists/        ← 字典（SecLists 等）
└── findings/         ← 已有，漏洞记录输出
```

### 2.3 工具安装清单（Windows 原生，按执行序）

```powershell
# 0. 包管理器 + 基础
# scoop（推荐，装工具最省事）
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
irm get.scoop.sh | iex
scoop install git python go nmap masscan hashcat john jq curl

# winget（备选）
winget install Python.Python.3.12
winget install GoLang.Go
winget install Insecure.Nmap

# 1. Go 工具（都是单文件 exe，release 直接下到 ~/.fuck/tools/ 或 go install）
go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest
go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest
go install -v github.com/projectdiscovery/katana/cmd/katana@latest
go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest
go install -v github.com/ffuf/ffuf/v2@latest
go install -v github.com/ropnop/kerbrute@latest
# go install 输出在 %USERPROFILE%\go\bin，加入 PATH

# 2. Python 工具（Windows 原生 pip）
pip install sqlmap ghauri wafw00f pwntools angr ROPgadget impacket netexec pacu prowler scoutsuite

# 3. 逆向/二进制（Windows 版）
# Ghidra: 官网下载 zip 到 ~/.fuck/tools/ghidra（Java，跨平台）
# radare2: scoop install radare2 或 release zip
# gdb: 用 pwntools 的 checksec 即可（纯 Python）；调试用 Ghidra 静态 + 本地 mingw gdb

# 4. 利用框架
# metasploit: 官方 Windows installer 或 omnibus
# searchsploit(exploitdb): git clone https://github.com/offensive-security/exploitdb

# 5. 云
# aws/az/gcloud 都是官方 Windows msi/zip

# 6. 规避
# veil/donut/scarecrow 都是 Python/Go，直接 pip 或 release exe

# 7. 字典
git clone --depth 1 https://github.com/danielmiessler/SecLists ~/.fuck/wordlists/SecLists

# 8. nuclei 模板
nuclei -update-templates
```

> 国内网络：Go 工具可配 `GOPROXY=https://goproxy.cn,direct`；pip 配 `-i https://pypi.tuna.tsinghua.edu.cn/simple`；GitHub release 走 gh-proxy 镜像加速。

## 3. 每类别 → 一个 skill（FUCK 的差异化价值）

FUCK 已有 confscan/semgrep/nuclei/sqlmap/findings 等 skill。为六大类别各写一个**工作流 skill**，教 agent"拿到题目后按什么顺序、调什么工具、如何判定"。

### 3.1 `web` skill 要点
1. 目标识别（httpx 指纹 → 子域名 subfinder → 目录 ffuf）
2. 自动化扫描（nuclei 全模板 + xray）
3. 定向验证（SQLi→sqlmap/ghauri，XSS→xray，SSRF→手测）
4. 每条漏洞记 findings（复用现有 findings skill）

### 3.2 `binary` skill 要点
1. checksec 看防护 → file/strings 初步侦察
2. ghidra 反编译定位漏洞函数
3. gdb+pwndbg 调试复现
4. angr 符号执行自动找可达路径
5. ROPgadget/one_gadget 构造利用 → pwntools 写 exp

### 3.3 `exploit` skill 要点
1. searchsploit 按 CVE/服务版本找现成 PoC
2. metasploit 模块匹配（search 命令）
3. 无现成 PoC → 手工构造（impacket/pwntools）
4. 验证 + 截图/证据 → findings

### 3.4 `killchain` skill 要点
1. 侦察（nmap/masscan → 服务识别）
2. 初始突破（弱口令/已知 CVE）
3. 提权（linpeas/winpeas + gtfobins）
4. 横向（bloodhound 找路径 → impacket 移动 → mimikatz 抓凭据）
5. 每个阶段证据链记录

### 3.5 `cloud` skill 要点
1. 凭据发现（环境变量/配置文件/metadata）
2. 枚举（cloudfox/pacu）
3. 配置审计（ScoutSuite/prowler）
4. IAM 提权（pacu 模块 / 手测策略）
5. 容器/k8s（trivy/kube-hunter）

### 3.6 `evasion` skill 要点
1. 目标检测识别（wafw00f）
2. payload 生成（msfvenom 编码 / veil / donut）
3. 加载器（scarecrow / 交叉编译 mingw）
4. 落地验证（是否被杀软拦截，回传验证）

## 4. 可选：扩展注册高频工具

FUCK 的 registerTool 可把高频工具包成结构化工具（带参数校验 + 输出归因），减少 agent 手写命令的出错率。优先级从高到低：

1. **nuclei**（已 skill 覆盖，可升级为 tool，自动解析 JSON 输出归因）
2. **searchsploit**（查 PoC → 返回 CVE/路径）
3. **bloodhound**（查询最短攻击路径）
4. **sqlmap**（已 skill，可 tool 化）

> 注：FUCK 现有 bash 工具其实够用，skill 里教好命令用法即可。tool 化是锦上添花，不是必需。

## 5. 关键风险与对策

| 风险 | 对策 |
|---|---|
| 工具多、命令记不住 | 每个类别 skill 里写死**命令模板**，agent 照抄参数 |
|                    |                                                   |
|                    |                                                   |
| 跑分超时 | 工具默认加 timeout；nuclei 用 `-severity` 控噪 |
|                    |                                                   |

## 6. 落地顺序（如果要实现）

1. **M1 环境**：Windows 本机装 §2.3 工具，验证 FUCK bash 能直接调用（Go 工具在 PATH）
2. **M2 skills**：写 web/binary/exploit 三个 skill（覆盖 55% 分值）
3. **M3 skills**：killchain/cloud/evasion（覆盖余下 45%）
4. **M4 加固**：targets.yaml 白名单 + 沙箱强制 + findings 归因
5. **M5 跑分**：VPN 连 TSECBench 靶场自测，迭代 skill

## 7. GitHub 对标参考（已检索）

- **hexstrike-ai**（11.5k★）：MCP server 包装 150+ 安全工具 —— 工具清单参考
- **T3MP3ST**（6k★）：多 agent 红队编排 —— 编排思路参考
- **Pentest-Swarm-AI**（2.4k★）：swarm 多 agent 分工（recon/exploit/reporting）—— 分工参考
- **Awesome-AI-Hacking-Agents**：AI 攻击 agent 清单 —— 全局视角
- **Scanners-Box**（9k★）：国内自研扫描器合辑 —— 国内工具补全
- **Dark-Moon**（887★）：跨 web/cloud/AD/k8s 自治渗透 —— 云+域覆盖参考

## 8. 黑客松架构参考（代码阅读产出）

> 来源：全量阅读 `agent-research-base/repos` 下 TCH2 冠亚军 + AIxCC CRS + BountyBench。只做架构提炼，不照搬代码。

### 8.1 读过的仓库与一句话定位

| 仓库 | 定位 |
|---|---|
| **BreachWeave**（TCH2 冠军） | Manager/Solver/Observer 三角色 + Idea/Memory 双层状态 |
| **Cairn**（TCH2 季军） | Blackboard 黑板 Fact/Intent/Hint 图 + 中心 Dispatcher + 多后端 worker |
| **TrailOfBits Buttercup**（AIxCC） | orchestrator 调度 + patcher LangGraph 多 agent 流水线 |
| **Theori CRS**（AIxCC） | fuzz/Infer 找漏洞 → triage/vuln_analyzer 分析 → pov/patch 生成 |
| **BountyBench**（Stanford） | workflow→phase→agent 三层 + 资源显式绑定 + 类型化消息 |
| CyberBench | 空仓库（仅 `.git`），跳过 |

### 8.2 四种主流 agent 架构范式对比

| 范式 | 代表 | 协调机制 | 适用场景 |
|---|---|---|---|
| 三角色分工 | BreachWeave | 共享 board(ideas+memory) + 广播 | 单题深度攻坚 |
| 黑板图 + 调度器 | Cairn | 中心 Dispatcher claim/heartbeat/lease | 多题并行 + 状态可观测 |
| 流水线多 agent | TrailOfBits/Theori | LangGraph StateGraph / 模块化顺序 | 补丁/修复类 |
| 分层 workflow | BountyBench | 类型化消息 + 资源管理器 | 可复现评测 |

### 8.3 可迁移到 FUCK 的关键设计（逐条）

1. **Idea vs Memory 双层状态**（BreachWeave）—— 方向假设 vs 客观事实分离。Idea 是"下一步测什么"，Memory 是"已确认的事实/证据/失败边界/hint/约束"。Idea 由 observer 只读维护，solver 只读取验证，生命周期 `pending/testing/verified/failed/skipped`。**FUCK 落点**：在 session 树之上加 challenge 级 board；假设生命周期字段是 FUCK 当前 findings 缺的。

2. **Observer sidecar 旁路纠偏**（BreachWeave）—— 每 N 轮异步审查 solver 最近行为（assistant 摘要 + tool 日志），保守维护看板，必要时发纠偏提醒（`steer`），带冷却 + 指纹去重。原则 `NO_CHANGE > update > delete > add`。**FUCK 落点**：复用现有 `on(message_end)/on(tool_execution_end)` 事件钩子，起低优先级 observer session（独立模型），只写 board 不下结论。

3. **Blackboard 图 + 中心 Dispatcher**（Cairn）—— 项目状态是 Fact/Intent/Hint 有向图，Dispatcher 是唯一协议写入者，claim + heartbeat + lease 控制并发，`reason` 在"新态势"（fact/hint 增、open intent 归零）时才重新触发。**FUCK 落点**：多题并行时加一个轻量 planner，只调度不解题（对应 §8.4 的 CHALLENGE_PLANNER 思路）。

4. **多后端 worker adapter**（Cairn）—— 统一 WorkerDriver 接口（`build_healthcheck / build_execute / extract_session / build_conclude`），同套调度器可驱动 Claude Code / Codex / pi。**FUCK 落点**：FUCK 既可作为调度器驱动其他 CLI 做并行子任务，也可反向把自己包装成 worker 接入开源调度框架做横向对比。

5. **任务状态机 + 双阶段收尾**（Cairn）—— bootstrap/explore 都是"execute + timeout→conclude"两阶段，超时不丢弃已完成进度，用同 session 追加"只总结当前事实"的收尾 prompt。**FUCK 落点**：长任务超时后进入收尾阶段，而不是直接作废。

6. **结构化 JSON 输出契约 + 严格校验**（Cairn contracts.py）—— 每类任务有 `accepted/data` 契约，非法输出不写图，避免污染状态。**FUCK 落点**：每类 skill 固定 JSON 输出 schema，用已注入的 zod 校验。

7. **patcher 流水线 + QE 闭环**（TrailOfBits）—— `RootCause → PatchStrategy → CreatePatch → Build → RunPOV → RunTests → Reflect`，LangGraph StateGraph 编排，QE 承担"工程师"验证环。**FUCK 落点**：BINARY/补丁类题目可参考"分析→定策→改动→编译→验证→反思"六段 skill。

8. **triage/dedupe 单 token 分类**（Theori）—— LLM 对 fuzz crash 做根因分类 + 去重，候选用编号（<1000 个避免多 token）。**FUCK 落点**：大量 crash 时先 LLM 去重分类再深挖，省 token。

9. **资源显式绑定 + 类型化消息**（BountyBench）—— 每个 agent 声明 `REQUIRED/OPTIONAL/ACCESSIBLE` 资源，消息强类型（detect/exploit/patch）。**FUCK 落点**：CTF 环境用资源清单（模型/toolchain/wordlist/靶机）声明式装配，比隐式传递更可复现。

### 8.4 落地建议更新（叠加到原计划）

- **状态层**：session 树之上加 challenge 级 board（ideas + memory），用 findings 扩展或独立存储。
- **调度层**：多题并行时加轻量 planner（CHALLENGE_PLANNER prompt + `planner_start/stop/launch` 工具），只调度不解题，稳定优先于频繁重排。
- **纠偏层**：用现有事件钩子实现 observer sidecar（可选，跑分瓶颈时才加）。
- **任务契约**：每类 skill 固定 JSON 输出契约，非法输出不落库。
- **后端复用**：FUCK 自身注册为 Cairn 风格 worker adapter，接入已有调度框架做对比评测。

## 9. 一句话结论

**FUCK 底座已够，缺的是"每类别一个 skill（工具清单+命令模板+工作流）+ 一个 Kali/WSL2 环境"。** 不用改 FUCK 内核，全部通过 skills + 现有扩展系统 + SANDBOX_CMD 沙箱即可落地。若要做成多题并行 / 多人协作的竞赛 agent，再叠加 §8.3 的双层状态（Idea/Memory）+ 轻量 planner + 可选 observer sidecar。
