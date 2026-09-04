---
name: killchain
description: triggers: KILLCHAIN, 多阶段渗透, 渗透测试, 攻击链, 横向移动, 提权, 域渗透, AD攻击, kill chain, pivoting, lateral movement, privilege escalation
---

# KILLCHAIN 多阶段渗透 — CTF 自动化工作流

**运行环境: 离线靶场，禁止外网。所有工具本地安装。**

## 工具清单

| 工具 | 安装 | 用途 |
|---|---|---|
| nmap | `scoop install nmap`（已装） | 端口/服务侦察 |
| Python | `D:/Scoop/apps/python/current/python.exe` | 脚本执行 |
| curl | 系统自带 | HTTP 请求 |
| nc | 系统自带 | 端口监听/连接 |

> 注：impacket/crackmapexec/bloodhound/masscan 未预装。优先用 nmap + curl + 手工。

## 工作流：五阶段推进

### 阶段 1: 侦察 Recon

```bash
# 1a. 全端口扫描
nmap -p- -T4 -oN /tmp/nmap_full.txt <target_ip>

# 1b. 服务版本
nmap -sV -sC -p <open_ports> -oN /tmp/nmap_svc.txt <target_ip>

# 1c. SMB 枚举（Windows 靶场）
nmap -p 445 --script smb-os-discovery,smb-enum-shares <target_ip>
nmap -p 139,445 --script smb-enum-users <target_ip>

# 1d. HTTP 枚举（复用 web skill）
# 连接靶场提供的 HTTP 服务
curl -v <target_url>
```

### 阶段 2: 初始突破 Initial Access

```bash
# 2a. 弱口令尝试（SMB）
# 用 nmap 脚本
nmap -p 445 --script smb-brute <target_ip>

# 2b. 弱口令尝试（HTTP/SSH/FTP）
# 手工尝试常见组合
# admin/admin, root/root, admin/password, guest/guest

# 2c. 已知漏洞利用（复用 exploit skill）
# 从 nuclei 扫描结果找 CVE
# 用 sqlmap 测注入点
```

### 阶段 3: 信息收集与提权 Privesc

```bash
# 3a. 拿到 shell 后收集信息
whoami
hostname
uname -a
ipconfig /all  # Windows
ifconfig       # Linux

# 3b. 找敏感文件
# Linux
find / -name "*flag*" -o -name "*secret*" -o -name "*password*" 2>/dev/null
cat /etc/passwd; cat /etc/shadow 2>/dev/null
# Windows
dir /s /b *flag* *secret* *password* 2>nul
type C:\Windows\System32\drivers\etc\hosts

# 3c. 凭据收集
# Linux: .bash_history, .ssh/id_rsa, /etc/shadow
# Windows: 注册表, SAM, 计划任务
dir /s /b *.kdbx *.rdp *.ovpn 2>nul
```

### 阶段 4: 横向移动 Lateral

```bash
# 4a. 内网探测
# 从已有 shell 扫描内网
for /L %i in (1,1,254) do @ping -n 1 -w 100 192.168.1.%i | find "Reply"  # Windows
for i in {1..254}; do ping -c 1 -W 1 192.168.1.$i | grep "bytes from"; done  # Linux

# 4b. 跳板
# 使用 nc 转发
# 或 chisel 隧道（如果目标有 chisel 二进制）

# 4c. 凭据重用
# 用找到的密码尝试其他主机
```

### 阶段 5: 目标达成 Objective

```bash
# 5a. 找 flag
# 靶场 flag 通常在 /root/flag.txt, /home/*/flag.txt, C:\flag.txt 等

# 5b. 证据收集
whoami && hostname && ipconfig /all > /tmp/evidence.txt
```

## 命令模板速查

### nmap 侦察命令集

```bash
# 快速全端口
nmap -p- --min-rate 1000 -T4 <target_ip>

# 服务版本 + 默认脚本
nmap -sV -sC -p <ports> <target_ip>

# SMB 枚举
nmap -p 445 --script smb-os-discovery,smb-enum-shares,smb-enum-users <target_ip>

# 漏洞扫描
nmap -p <ports> --script vuln <target_ip>
```

### 无 impacket 时的 SMB 操作

```bash
# Windows 本机 SMB
net view \\<target_ip>
net use \\<target_ip>\share <password> /u:<user>
dir \\<target_ip>\share
```

## 判定规则

1. **弱口令登录成功** → 直接突破，Critical
2. **匿名 SMB 可读** → 信息泄露，High
3. **提权成功** → 记录提权方式
4. **找到 flag** → 记录最终结果
5. **每阶段都记录 findings**

## 离线环境

- 禁止 web_search/fetch_url
- 无 impacket/crackmapexec/bloodhound
- 主要靠 nmap + curl + 手工 shell 操作