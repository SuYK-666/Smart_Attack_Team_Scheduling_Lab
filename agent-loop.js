import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { FlagCounter } from "./flag-counter.js";
import { FlagStore } from "./flag-store.js";
import { Runner } from "./runner.js";
import { StreamFlagScanner } from "./stream-flag-scanner.js";
import { ProxyServer } from "./proxy/proxy-server.js";
import { Whiteboard } from "./whiteboard.js";
import { supervise } from "./supervisor.js";
import { recommendSkills } from "./skill-router.js";
import { recommendPlaybooks } from "./vulnerability-playbooks.js";

export async function startAgent(config) {
  const whiteboard = new Whiteboard(config.workDir);
  const flagCounter = new FlagCounter(config.flagPattern);
  const flagStore = new FlagStore(config.artifactDir, config);
  const proxy = new ProxyServer(config.proxyPort);

  flagStore.write([]);
  whiteboard.setConfig("target", config.target);
  whiteboard.setConfig("artifactDir", config.artifactDir);
  whiteboard.setConfig("flagJsonPath", flagStore.jsonPath);
  whiteboard.setConfig("flagTextPath", flagStore.textPath);
  whiteboard.setConfig("maxFlags", config.maxFlags ?? "unlimited");
  whiteboard.setConfig("scopeMode", config.scopeMode);
  whiteboard.setConfig("allowPrivatePivot", config.allowPrivatePivot);
  whiteboard.setFlagCount(0, config.flagsNeeded);

  await proxy.start().catch((e) => {
    console.error(chalk.red(`[agent] proxy server failed: ${e.message}`));
  });

  console.log(chalk.green(`[system] opencode backend: ${config.attachUrl}`));
  console.log(chalk.green(`[system] artifact dir: ${config.artifactDir}`));
  console.log(chalk.green(`[system] estimated max flags: ${config.maxFlags ?? "unknown"}; stop still depends on leads, stale-stop, and max-loops`));

  let loopIndex = 0;
  let staleLoops = 0;
  let prevSummary = null;
  let continueBeyondMaxFlags = false;
  const runner = new Runner(config);
  const streamScanner = new StreamFlagScanner(flagCounter);

  while (loopIndex < config.maxLoops) {
    loopIndex++;
    const loopPlan = buildLoopPlan(loopIndex, {
      flagsFound: flagCounter.count(),
      staleLoops,
      lastSummary: prevSummary,
    });
    const skillRecommendations = recommendSkills({
      loopPlan,
      iterations: whiteboard.iterations,
      whiteboardSummary: whiteboard.summary(),
      lastOutput: prevSummary,
    });
    const playbookRecommendations = recommendPlaybooks({
      loopPlan,
      iterations: whiteboard.iterations,
      whiteboardSummary: whiteboard.summary(),
      lastOutput: prevSummary,
    });

    const flagTarget = config.maxFlags ? `${config.flagsNeeded}-${config.maxFlags}` : `${config.flagsNeeded}+`;
    console.log(chalk.yellow(`\n=== loop ${loopIndex}/${config.maxLoops} | flags: ${flagCounter.count()}/${flagTarget} | stale: ${staleLoops}/${config.stopAfterStale} ===`));
    console.log(chalk.yellow(`[loop plan] ${loopPlan.title}`));
    for (const item of loopPlan.goals) console.log(chalk.yellow(`  - ${item}`));
    console.log(chalk.yellow(`[skill hints] ${skillRecommendations.map((item) => item.name).join(", ")}`));
    if (playbookRecommendations.length) {
      console.log(chalk.yellow(`[playbooks] ${playbookRecommendations.map((item) => item.id).join(", ")}`));
    }

    const context = {
      isFirstRun: loopIndex === 1,
      loopIndex,
      loopPlan,
      skillRecommendations,
      playbookRecommendations,
      flagsFound: flagCounter.count(),
      flagsNeeded: config.flagsNeeded,
      maxFlags: config.maxFlags,
      foundFlags: flagCounter.all(),
      whiteboardSummary: whiteboard.summary(),
      lastOutput: prevSummary,
    };

    const result = await runner.run(context, {
      onOutput: (chunk) => {
        const newFlags = streamScanner.scan(chunk);
        if (newFlags.length === 0) return;

        console.log(chalk.green(`\n[finding] streamed flags: ${newFlags.length}`));
        for (const f of newFlags) console.log(chalk.green(`  ${f}`));
        whiteboard.setFlagCount(flagCounter.count(), config.flagsNeeded);
        flagStore.write(flagCounter.all(), { loopsUsed: loopIndex });
      },
    });
    const output = (result.output || "") + (result.stderr ? "\n" + result.stderr : "");

    console.log(chalk.gray("[supervisor] extracting structured findings from raw output..."));
    const findings = await supervise(output, config);

    whiteboard.recordIteration(findings);
    prevSummary = findings.summary;

    const beforeFlags = flagCounter.count();
    flagCounter.scan(output);
    for (const f of findings.newFlags) flagCounter.scan(f);
    const allNewFlags = flagCounter.all().slice(beforeFlags);

    if (allNewFlags.length > 0) {
      console.log(chalk.green(`[finding] post-run flags: ${allNewFlags.length}`));
      for (const f of allNewFlags) console.log(chalk.green(`  ${f}`));
      whiteboard.setFlagCount(flagCounter.count(), config.flagsNeeded);
      flagStore.write(flagCounter.all(), { loopsUsed: loopIndex });
    }

    printFindings(findings);

    const hasNewNonFlagFindings = hasMeaningfulFindings(findings);
    const hasNewFlags = allNewFlags.length > 0;
    if (hasNewFlags || hasNewNonFlagFindings) {
      staleLoops = 0;
    } else {
      staleLoops++;
      console.log(chalk.gray(`[agent] no new structured findings this loop; stale=${staleLoops}/${config.stopAfterStale}`));
    }

    if (!result.success) {
      console.log(chalk.red(`[error] runner failed: ${(result.error || "unknown").slice(0, 200)}`));
    }

    if (config.maxFlags && !continueBeyondMaxFlags && flagCounter.count() >= config.maxFlags) {
      const hasExtraLead = hasPossibleExtraFlagLead(findings);
      if (hasExtraLead) {
        const shouldContinue = await askContinueAfterMaxFlags(config.maxFlags, flagCounter.count(), findings);
        if (shouldContinue) {
          continueBeyondMaxFlags = true;
          console.log(chalk.yellow("[agent] continuing beyond estimated --max-flags; future stop depends on stale-stop or max-loops."));
        } else {
          console.log(chalk.green(`\n[complete] estimated max flags (${config.maxFlags}) reached. User chose to stop. Flags found: ${flagCounter.count()}`));
          break;
        }
      } else {
        console.log(chalk.green(`\n[complete] estimated max flags (${config.maxFlags}) reached. No extra flag lead detected. Flags found: ${flagCounter.count()}`));
        break;
      }
    }

    const minLoopsReached = loopIndex >= config.minLoops;
    const staleStopReached = staleLoops >= config.stopAfterStale;
    if (minLoopsReached && staleStopReached) {
      console.log(chalk.green(`\n[complete] exhaustive stop: ${staleLoops} stale loops after minimum ${config.minLoops} loops.`));
      break;
    }

    await sleep(2000);
  }

  if (loopIndex >= config.maxLoops) {
    console.log(chalk.red(`\n[complete] max loops (${config.maxLoops}) reached. Flags found: ${flagCounter.count()}`));
  }

  proxy.stop();
  flagStore.write(flagCounter.all(), { loopsUsed: loopIndex });

  return {
    flagsFound: flagCounter.all(),
    loopsUsed: loopIndex,
    whiteboardPath: whiteboard.statePath,
    flagJsonPath: flagStore.jsonPath,
    flagTextPath: flagStore.textPath,
  };
}

function buildLoopPlan(loopIndex, state) {
  const plans = [
    {
      title: "第 1 轮：信息收集与攻击面建模",
      goals: [
        "只做入口可达性、HTTP 指纹、页面/目录/参数/静态资源收集。",
        "记录每个工具、命令、URL、状态码、响应差异和保存路径。",
        "本轮结束时输出资产清单、疑似漏洞点、下一轮验证优先级；不要进入深度利用。",
      ],
    },
    {
      title: "第 2 轮：漏洞假设验证",
      goals: [
        "基于上一轮证据验证 2-4 个最高价值入口，例如注入、上传、鉴权、文件读取、框架漏洞。",
        "每个方向保留成功/失败证据，失败时说明调整依据。",
        "本轮结束时形成可利用路径候选，不做长时间穷举。",
      ],
    },
    {
      title: "第 3 轮：可利用路径打通与取证",
      goals: [
        "选择已验证可能性最高的路径做最小必要利用，获取 flag、凭据、源码、配置或访问权限。",
        "脚本、payload、下载内容必须写入 artifacts 对应子目录。",
        "本轮结束时汇总利用链、证据和仍可扩展的入口。",
      ],
    },
    {
      title: "第 4 轮：权限扩展、内网探测与横向机会",
      goals: [
        "在已获得访问的前提下，谨慎枚举权限、配置、内网地址、服务和凭据复用机会。",
        "不要无目标地爆破；优先使用已发现证据驱动下一步。",
        "本轮结束时给出横向移动结果、边界和未覆盖风险。",
      ],
    },
    {
      title: "第 5 轮及以后：复核补漏与收尾",
      goals: [
        "复核前几轮遗漏的高价值点，补充证据链和日志可读性。",
        "寻找额外 flag 或漏洞，但避免重复扫描已确认无效的方向。",
        "如果没有新增发现，明确输出收尾判断和下一轮是否还有必要。",
      ],
    },
  ];

  if (loopIndex <= plans.length) return plans[loopIndex - 1];
  if (state.flagsFound > 0 || state.staleLoops > 0) return plans[4];
  return {
    title: `第 ${loopIndex} 轮：证据驱动的补充验证`,
    goals: [
      "根据白板中尚未验证的最高优先级方向，只选择少量目标验证。",
      "完成本轮计划后立即停止并交接，不展开新的大范围扫描。",
      "输出新增证据、失败原因、下一轮建议和奖励判断。",
    ],
  };
}

function hasMeaningfulFindings(findings) {
  return Boolean(
    findings.newHosts?.length ||
    findings.newServices?.length ||
    findings.newCredentials?.length ||
    findings.newAccess?.length ||
    findings.intel?.length
  );
}

function hasPossibleExtraFlagLead(findings) {
  if (!findings) return false;
  if (
    findings.newHosts?.length ||
    findings.newServices?.length ||
    findings.newCredentials?.length ||
    findings.newAccess?.length ||
    findings.intel?.length
  ) {
    return true;
  }

  const leadText = [
    findings.summary,
    ...(findings.nextSteps || []),
    ...(findings.problems || []).flatMap((p) => [p.resolution, p.cause]),
    ...(findings.analysisTrail || []).flatMap((a) => [a.decision, a.hypothesis, a.evidence]),
  ].filter(Boolean).join("\n");

  return /继续|额外|更多|另一个|其他|未验证|可扩展|下一步|补漏|入口|漏洞|路径|目录|参数|服务|凭据|权限|内网|源码|配置/i.test(leadText);
}

async function askContinueAfterMaxFlags(maxFlags, flagsFound, findings) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(chalk.yellow(`[agent] estimated max flags (${maxFlags}) reached and extra leads exist, but stdin is not interactive; stopping.`));
    return false;
  }

  console.log(chalk.yellow(`\n[agent] estimated max flags (${maxFlags}) reached. Flags found: ${flagsFound}.`));
  console.log(chalk.yellow("[agent] possible extra flag leads detected:"));
  for (const lead of summarizeExtraLeads(findings)) {
    console.log(chalk.yellow(`  - ${lead}`));
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(chalk.yellow("Continue searching for extra flags? [y/N] "));
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function summarizeExtraLeads(findings) {
  const leads = [];
  for (const value of findings.intel || []) leads.push(`intel: ${String(value).slice(0, 120)}`);
  for (const value of findings.nextSteps || []) leads.push(`next step: ${String(value).slice(0, 120)}`);
  for (const value of findings.newHosts || []) leads.push(`host: ${value}`);
  for (const value of findings.newServices || []) leads.push(`service: ${value.host || "?"}:${value.port || "?"} ${value.name || ""}`.trim());
  for (const value of findings.newCredentials || []) leads.push(`credential: ${value.username || "?"}@${value.host || value.service || "?"}`);
  for (const value of findings.newAccess || []) leads.push(`access: ${String(value).slice(0, 120)}`);
  if (leads.length === 0 && findings.summary) leads.push(`summary: ${findings.summary.slice(0, 120)}`);
  return leads.slice(0, 6);
}

function printFindings(findings) {
  console.log(chalk.cyan(`[position] ${findings.position || "?"}`));
  console.log(chalk.gray(`[summary] ${findings.summary || "(none)"}`));
  printList("key actions", findings.keyActions, chalk.gray);
  printToolCalls(findings.toolCalls);
  printAnalysisTrail(findings.analysisTrail);
  printProblems(findings.problems);
  printList("intel", findings.intel, chalk.yellow);
  printList("new access", findings.newAccess, chalk.cyan);
  printReward(findings.rewardEvaluation);
  printList("next steps", findings.nextSteps, chalk.gray);
}

function printList(label, values, color) {
  if (!values?.length) return;
  console.log(color(`[${label}]`));
  for (const value of values) console.log(color(`  - ${value}`));
}

function printToolCalls(toolCalls) {
  if (!toolCalls?.length) return;
  console.log(chalk.blue("[tool calls]"));
  for (const call of toolCalls) {
    console.log(chalk.blue(`  - tool: ${call.tool || "unknown"}`));
    if (call.command) console.log(chalk.blue(`    command/request: ${call.command}`));
    if (call.purpose) console.log(chalk.blue(`    purpose: ${call.purpose}`));
    if (call.result) console.log(chalk.blue(`    result: ${call.result}`));
    if (call.impact) console.log(chalk.blue(`    impact: ${call.impact}`));
  }
}

function printAnalysisTrail(trail) {
  if (!trail?.length) return;
  console.log(chalk.magenta("[analysis trail]"));
  for (const item of trail) {
    console.log(chalk.magenta(`  - [${item.phase || "unknown"}] ${item.action || "(no action)"}`));
    if (item.hypothesis) console.log(chalk.magenta(`    reasoning summary: ${item.hypothesis}`));
    if (item.evidence) console.log(chalk.magenta(`    evidence: ${item.evidence}`));
    if (item.decision) console.log(chalk.magenta(`    decision: ${item.decision}`));
  }
}

function printProblems(problems) {
  if (!problems?.length) return;
  console.log(chalk.red("[troubleshooting]"));
  for (const problem of problems) {
    console.log(chalk.red(`  - symptom: ${problem.symptom || "unknown"}`));
    if (problem.cause) console.log(chalk.red(`    cause: ${problem.cause}`));
    if (problem.resolution) console.log(chalk.red(`    resolution: ${problem.resolution}`));
  }
}

function printReward(reward) {
  if (!reward) return;
  console.log(chalk.green(`[reward] ${reward.level || "?"}`));
  if (reward.reason) console.log(chalk.green(`  - ${reward.reason}`));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
