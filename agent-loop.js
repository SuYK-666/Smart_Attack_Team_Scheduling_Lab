import chalk from "chalk";
import { FlagCounter } from "./flag-counter.js";
import { Runner } from "./runner.js";
import { ProxyServer } from "./proxy/proxy-server.js";
import { Whiteboard } from "./whiteboard.js";
import { supervise } from "./supervisor.js";

export async function startAgent(config) {
  const whiteboard = new Whiteboard(config.workDir);
  const flagCounter = new FlagCounter(config.flagPattern);
  const proxy = new ProxyServer(config.proxyPort);

  whiteboard.setConfig("target", config.target);
  whiteboard.setFlagCount(0, config.flagsNeeded);

  await proxy.start().catch((e) => {
    console.error(chalk.red(`[agent] proxy server failed: ${e.message}`));
  });

  console.log(chalk.green(`[agent] opencode backend: ${config.attachUrl}`));
  console.log(chalk.green("[agent] skills auto-loaded by opencode"));

  let loopIndex = 0;
  let prevSummary = null;

  while (loopIndex < config.maxLoops) {
    loopIndex++;

    if (flagCounter.count() >= config.flagsNeeded) {
      console.log(chalk.green(`\n[agent] all ${config.flagsNeeded} flags found after ${loopIndex - 1} iterations`));
      break;
    }

    console.log(chalk.yellow(`\n=== loop ${loopIndex}/${config.maxLoops} | flags: ${flagCounter.count()}/${config.flagsNeeded} ===`));

    const context = {
      isFirstRun: loopIndex === 1,
      flagsFound: flagCounter.count(),
      flagsNeeded: config.flagsNeeded,
      foundFlags: flagCounter.all(),
      whiteboardSummary: whiteboard.summary(),
      lastOutput: prevSummary,
    };

    const runner = new Runner(config);
    const result = await runner.run(context);
    const output = (result.output || "") + (result.stderr ? "\n" + result.stderr : "");

    console.log(chalk.gray(`[agent] supervisor extracting findings...`));
    const findings = await supervise(output);

    whiteboard.recordIteration(findings);
    prevSummary = findings.summary;

    const newFlags = flagCounter.scan(output);
    for (const f of findings.newFlags) {
      flagCounter.scan(f);
    }
    const allNew = flagCounter.all().filter((f) => !context.foundFlags.includes(f));

    if (allNew.length > 0) {
      console.log(chalk.green(`[agent] found ${allNew.length} new flag(s):`));
      for (const f of allNew) {
        console.log(chalk.green(`  ${f}`));
      }
      whiteboard.setFlagCount(flagCounter.count(), config.flagsNeeded);
    }

    console.log(chalk.cyan(`[agent] position: ${findings.position || "?"}`));
    console.log(chalk.gray(`[agent] summary: ${findings.summary?.slice(0, 120) || "(none)"}`));
    if (findings.intel?.length) {
      console.log(chalk.yellow(`[agent] intel: ${findings.intel.join(" | ")}`));
    }

    if (!result.success) {
      console.log(chalk.red(`[agent] runner failed: ${(result.error || "unknown").slice(0, 200)}`));
    }

    await _sleep(2000);
  }

  if (flagCounter.count() < config.flagsNeeded) {
    console.log(chalk.red(`\n[agent] max loops (${config.maxLoops}) reached. Found ${flagCounter.count()}/${config.flagsNeeded} flags.`));
  }

  proxy.stop();

  return {
    flagsFound: flagCounter.all(),
    loopsUsed: loopIndex,
    whiteboardPath: whiteboard.statePath,
  };
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
