import { readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const API_URL = "https://api.deepseek.com/v1/chat/completions";

function getApiKey() {
  try {
    const auth = JSON.parse(readFileSync(
      join(os.homedir(), ".local", "share", "opencode", "auth.json"), "utf-8"
    ));
    return auth.deepseek?.key || "";
  } catch {
    return "";
  }
}

const SYSTEM = `You are a supervisor agent reviewing raw output from an authorized CTF penetration test.

Return ONLY valid JSON. All human-readable values must be written in Chinese.

Schema:
{
  "summary": "Chinese 300-600 chars: what happened, key path, evidence, result",
  "newFlags": ["flag strings"],
  "newHosts": ["new IPs or hostnames"],
  "newServices": [{"host":"ip","port":80,"name":"http"}],
  "newCredentials": [{"username":"","password":"","host":"","service":""}],
  "keyActions": ["Chinese key actions"],
  "toolCalls": [{"tool":"curl/nmap/gobuster/bash/python/netcat/skill/etc","command":"full command or HTTP request","purpose":"why it was run","result":"status/output/discovery/failure summary","impact":"how it affected next step"}],
  "analysisTrail": [{"phase":"信息收集|扫描判断|攻击尝试|权限扩展|横向移动|回传取证|失败排查|验证收尾","hypothesis":"evidence-based reasoning summary in Chinese","action":"specific action","evidence":"observable evidence","decision":"next decision or why abandoned"}],
  "problems": [{"symptom":"failure symptom","cause":"likely cause from output","resolution":"adjustment or next recommendation"}],
  "nextSteps": ["Chinese concrete follow-up actions"],
  "rewardEvaluation": {"level":"无奖励|基础奖励|额外奖励","reason":"Chinese reason based on round scope, evidence quality, discoveries, and handoff clarity"},
  "position": "Chinese current position/access level",
  "newAccess": ["new access gained"],
  "intel": ["valuable tactical intel"]
}

Rules:
- Extract visible commands, HTTP requests, tool names, parameters, outputs, errors, and how they influenced the next step.
- Do not invent hidden chain-of-thought. Use observable evidence and concise decision summaries.
- Include failed attempts when visible.
- Filter noise, but preserve important command evidence, URLs, credentials, upload paths, sessions, callbacks, and flags.`;

export async function supervise(output) {
  if (!output || output.trim().length < 50) {
    return emptyFindings(output?.slice(0, 200) || "(empty)");
  }

  const cleaned = cleanOutput(output);
  const fallback = basicExtract(cleaned);
  const key = getApiKey();
  if (!key) {
    return fallback;
  }

  const prompt = `${SYSTEM}

RAW OUTPUT:
\`\`\`
${cleaned.slice(-18000)}
\`\`\`

Return ONLY valid JSON (no markdown, no code fences):`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2600,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) throw new Error(`API ${res.status}`);

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(jsonMatch[0]);
    return mergeWithFallback(parsed, fallback);
  } catch (err) {
    console.error(`[supervisor] LLM call failed: ${err.message}, falling back to local extraction`);
    return fallback;
  }
}

function cleanOutput(output) {
  return output
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

function mergeWithFallback(parsed, fallback) {
  return {
    summary: parsed.summary || fallback.summary,
    newFlags: mergeUnique(parsed.newFlags, fallback.newFlags),
    newHosts: mergeUnique(parsed.newHosts, fallback.newHosts),
    newServices: parsed.newServices?.length ? parsed.newServices : fallback.newServices,
    newCredentials: parsed.newCredentials?.length ? parsed.newCredentials : fallback.newCredentials,
    keyActions: parsed.keyActions?.length ? parsed.keyActions : fallback.keyActions,
    toolCalls: parsed.toolCalls?.length ? parsed.toolCalls : fallback.toolCalls,
    analysisTrail: parsed.analysisTrail?.length ? parsed.analysisTrail : fallback.analysisTrail,
    problems: mergeProblems(parsed.problems, fallback.problems),
    nextSteps: mergeUnique(parsed.nextSteps, fallback.nextSteps),
    rewardEvaluation: parsed.rewardEvaluation || fallback.rewardEvaluation,
    position: parsed.position || fallback.position,
    newAccess: parsed.newAccess?.length ? parsed.newAccess : fallback.newAccess,
    intel: parsed.intel?.length ? parsed.intel : fallback.intel,
  };
}

function basicExtract(output) {
  const flags = [...new Set([...output.matchAll(/(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]{2,32}\{)(?=[A-Za-z0-9_]*(?:ctf|flag))[A-Za-z0-9_]+\{[^}\s]{3,128}\}/gi)].map((m) => m[0]))];
  const hosts = [];
  for (const m of output.matchAll(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g)) {
    if (!hosts.includes(m[1]) && !m[1].startsWith("0.") && !m[1].startsWith("127.0.0.1")) hosts.push(m[1]);
  }

  const creds = [];
  for (const m of output.matchAll(/([A-Za-z0-9_.-]{2,32}):([a-f0-9]{16,64}|[^\s<>"']{3,64})/g)) {
    creds.push({ username: m[1], password: m[2] });
  }

  const toolCalls = extractToolCalls(output);
  const keyActions = toolCalls.slice(0, 12).map((c) => `${c.tool}: ${c.purpose || c.command}`);
  const problems = extractProblems(output);

  return {
    summary: summarizeLocally(output, flags, toolCalls),
    newFlags: flags,
    newHosts: hosts,
    newServices: [],
    newCredentials: dedupeCreds(creds),
    keyActions,
    toolCalls,
    analysisTrail: toolCalls.slice(0, 12).map((c) => ({
      phase: inferPhase(c.command),
      hypothesis: c.purpose,
      action: c.command,
      evidence: c.result,
      decision: c.impact,
    })),
    problems,
    nextSteps: inferNextSteps(flags, problems),
    rewardEvaluation: flags.length
      ? { level: "额外奖励", reason: "本轮输出中出现 flag，属于高价值发现；仍需结合日志确认是否遵守本轮边界。" }
      : { level: toolCalls.length ? "基础奖励" : "无奖励", reason: toolCalls.length ? "本轮存在可见工具调用和证据输出。" : "未解析到明确工具调用或有效证据。" },
    position: flags.length ? "已获得目标 flag，处于验证收尾阶段" : "正在自动化探测目标服务",
    newAccess: [],
    intel: extractIntel(output),
  };
}

function inferNextSteps(flags, problems) {
  const steps = [];
  if (flags.length) steps.push("已找到 flag，可复核日志中的利用路径和证据链。");
  if (problems.some((p) => /SMB|smbclient|协议客户端/.test(`${p.symptom} ${p.cause} ${p.resolution}`))) {
    steps.push("对 SMB/files01 停止重复裸 TCP 或 curl 尝试，优先寻找具备 smbclient/impacket 的跳板节点。");
    steps.push("如果存在 jump/dev/workstation 节点，验证是否可在该节点运行 smbclient，或建立 TCP 隧道后在本机枚举 SMB 共享。");
  }
  if (!steps.length) steps.push("继续根据已发现服务逐一验证漏洞面。");
  return steps;
}

function extractToolCalls(output) {
  const calls = [];
  const lines = output.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const command = line.startsWith("$ ") ? line.slice(2).trim() : "";
    if (!command) continue;
    const resultLines = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
      const next = lines[j].trim();
      if (next.startsWith("$ ") || next.startsWith("# ")) break;
      if (next) resultLines.push(next);
    }
    const tool = inferTool(command);
    const result = resultLines.join(" ").slice(0, 500);
    calls.push({
      tool,
      command,
      purpose: inferPurpose(command),
      result,
      impact: inferImpact(command, result),
    });
  }
  return calls;
}

function inferTool(command) {
  const first = command.split(/\s+/)[0].replace(/\.exe$/i, "");
  if (/^curl/i.test(first)) return "curl";
  if (/^nmap/i.test(first)) return "nmap";
  if (/^gobuster/i.test(first)) return "gobuster";
  if (/^hydra/i.test(first)) return "hydra";
  if (/^python/i.test(first)) return "python";
  if (/^nc|netcat/i.test(first)) return "netcat";
  if (/^Get-|^Write-|^\$/i.test(first)) return "powershell";
  return first || "shell";
}

function inferPurpose(command) {
  if (/nmap|Test-NetConnection|TcpClient/i.test(command)) return "枚举端口或验证服务连通性";
  if (/smbclient|mount\.cifs|impacket-smbclient|psexec\.py|smbexec\.py/i.test(command)) return "验证 SMB 共享、认证或文件读取能力";
  if (/ORDER%20BY|UNION|sqlite_master|database\(|sqlite_version/i.test(command)) return "验证并利用 SQL 注入";
  if (/\/login|username=|password=/i.test(command)) return "使用发现的凭据登录验证权限";
  if (/-F|multipart|upload|filename=/i.test(command)) return "测试文件上传与绕过";
  if (/gobuster|dirb|dirsearch/i.test(command)) return "目录和文件枚举";
  if (/cat |ls|id|whoami/i.test(command)) return "验证命令执行或读取目标文件";
  return "执行自动化测试步骤并收集证据";
}

function inferImpact(command, result) {
  if (/flag\{[^}]+\}/i.test(result)) return "结果中出现 flag，进入验证收尾";
  if (/smbclient: not found|mount\.cifs: not found|impacket.*not found|No module named ['"]?impacket/i.test(result)) return "SMB 客户端或库缺失，应寻找具备工具的跳板节点或建立 TCP 隧道";
  if (/(445|139).*(open|OPEN)|smb|samba/i.test(command + " " + result) && /timed out|timeout|fread|无响应|failed|无法|not supported/i.test(result)) return "SMB 端口可能可达，但当前方式无法完成协议级交互";
  if (/数据库错误|SQL|sqlite|users|CREATE TABLE|UNION/i.test(result + command)) return "结果支持继续沿 SQL 注入路径枚举数据库";
  if (/登录失败|Invalid|Forbidden|404|timed out|error/i.test(result)) return "该尝试失败，需要更换 payload、参数或攻击面";
  if (/Upload Success|Stored in/i.test(result)) return "上传成功，可继续验证访问路径和执行可能性";
  return "保留输出作为下一步判断依据";
}

function inferPhase(command) {
  if (/nmap|TcpClient|Get-Command|curl.*http:\/\/[^/"]+["\s]?$/i.test(command)) return "信息收集";
  if (/smbclient|mount\.cifs|impacket-smbclient|445|139|smb|samba/i.test(command)) return "横向移动";
  if (/ORDER%20BY|UNION|sqlite_master|\/login/i.test(command)) return "攻击尝试";
  if (/-F|upload|filename=/i.test(command)) return "攻击尝试";
  if (/cat |ls|id|whoami/i.test(command)) return "回传取证";
  return "扫描判断";
}

function extractProblems(output) {
  const problems = [];
  if (/timed out/i.test(output)) problems.push({ symptom: "命令或连接超时", cause: "目标服务无响应或交互协议不匹配", resolution: "切换请求方式、延长超时或更换攻击面" });
  if (/Invalid File|You was catched|Forbidden|404 Not Found/i.test(output)) problems.push({ symptom: "上传、访问或目录探测被拒绝", cause: "服务端存在后缀、内容或路径限制", resolution: "尝试 MIME、后缀、内容魔术头、路径和解析差异绕过" });
  if (/数据库错误/i.test(output)) problems.push({ symptom: "数据库错误页面", cause: "SQL payload 触发异常或列数/函数不匹配", resolution: "调整列数、函数和数据库方言继续验证" });
  problems.push(...extractProtocolBlockers(output));
  return problems;
}

function extractProtocolBlockers(output) {
  const blockers = [];
  const lower = output.toLowerCase();
  const mentionsSmb = /files01|smb|samba|netbios|445|139/.test(lower);
  if (!mentionsSmb) return blockers;

  if (/smbclient:\s*not found|which smbclient.*not found|mount\.cifs:\s*not found|no module named ['"]?impacket|impacket.*not found/i.test(output)) {
    blockers.push({
      symptom: "SMB 目标可见但协议客户端缺失",
      cause: "当前执行环境缺少 smbclient、mount.cifs 或 python3+impacket，无法枚举共享或读取 SMB 文件",
      resolution: "停止重复裸 TCP/HTTP 尝试，寻找具备 SMB 工具的内网跳板节点，或建立 TCP 隧道后在本机使用 smbclient/impacket",
    });
  }

  if (/(fsockopen|fread|stream_set_timeout|nc|curl smb:\/\/|raw smb|原始 smb|裸 tcp)/i.test(output) && /(timed out|timeout|阻塞|无响应|无法获取有效响应|protocol.*not supported|not supported|failed)/i.test(output)) {
    blockers.push({
      symptom: "SMB 裸 TCP 或伪 banner 探测失败",
      cause: "SMB 是二进制状态协议，需要 negotiate、session setup、tree connect 和文件读取流程，不能依赖简单 fread、curl 或随机 nc 发包完成",
      resolution: "将该节点标记为 TCP 可达但协议交互受阻，下一步改用 smbclient/impacket 或通过 dev/workstation/bastion 建立访问路径",
    });
  }

  return blockers;
}

function extractIntel(output) {
  const intel = [];
  if (/sqlite_version\(\).*?3\./is.test(output) || /sqlite_master/i.test(output)) intel.push("数据库类型疑似 SQLite，可通过 sqlite_master 枚举表结构。");
  if (/users,articles/i.test(output)) intel.push("发现 users 和 articles 表。");
  if (/CREATE TABLE users/i.test(output)) intel.push("users 表包含 id、username、password 字段。");
  if (/管理员面板|Flag:/i.test(output)) intel.push("管理员面板会直接显示 flag。");
  if (/files01|10\.80\.30\.40|samba|smb/i.test(output)) intel.push("发现或验证了 files01/SMB 攻击面，后续需要 SMB 客户端、impacket 或 TCP 隧道完成共享枚举。");
  return intel;
}

function summarizeLocally(output, flags, toolCalls) {
  const flagText = flags.length ? `发现 flag：${flags.join(", ")}。` : "尚未提取到 flag。";
  const toolText = toolCalls.length ? `本轮记录到 ${toolCalls.length} 次命令/工具调用，关键路径包括端口/服务探测、SQL 注入验证、表结构枚举、凭据提取和登录验证。` : "本轮未解析到明确工具调用。";
  return `${toolText}${flagText}`;
}

function mergeUnique(a = [], b = []) {
  return [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
}

function mergeProblems(a = [], b = []) {
  const seen = new Set();
  const merged = [];
  for (const problem of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!problem) continue;
    const key = `${problem.symptom || ""}:${problem.cause || ""}:${problem.resolution || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(problem);
  }
  return merged;
}

function dedupeCreds(creds) {
  const seen = new Set();
  return creds.filter((c) => {
    const key = `${c.username || ""}:${c.password || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emptyFindings(summary) {
  return {
    summary,
    newFlags: [],
    newHosts: [],
    newServices: [],
    newCredentials: [],
    keyActions: [],
    toolCalls: [],
    analysisTrail: [],
    problems: [],
    nextSteps: [],
    rewardEvaluation: { level: "无奖励", reason: "本轮输出不足，无法确认计划完成度或证据质量。" },
    position: "",
    newAccess: [],
    intel: [],
  };
}
