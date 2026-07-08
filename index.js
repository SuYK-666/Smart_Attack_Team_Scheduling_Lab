#!/usr/bin/env node

import chalk from "chalk";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import os from "node:os";
import { config, validate, dump, __dirname } from "./config.js";
import { startAgent } from "./agent-loop.js";

async function main() {
  if (config.showStatus) {
    showStatus();
    return;
  }

  if (!validate(config)) {
    process.exit(1);
  }

  // auto-clean previous run data
  const penDir = join(__dirname, ".pen-agent");
  if (existsSync(penDir)) {
    rmSync(penDir, { recursive: true, force: true });
    console.log(chalk.gray("[agent] cleaned previous .pen-agent data"));
  }
  if (existsSync(config.artifactDir)) {
    rmSync(config.artifactDir, { recursive: true, force: true });
    console.log(chalk.gray(`[agent] cleaned previous artifact data: ${config.artifactDir}`));
  }
  mkdirSync(config.artifactDir, { recursive: true });
  mkdirSync(join(config.artifactDir, "scripts"), { recursive: true });
  mkdirSync(join(config.artifactDir, "payloads"), { recursive: true });
  mkdirSync(join(config.artifactDir, "downloads"), { recursive: true });
  mkdirSync(join(config.artifactDir, "notes"), { recursive: true });

  if (config.apiKey) {
    const authDir = join(os.homedir(), ".local", "share", "opencode");
    const authFile = join(authDir, "auth.json");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(authFile, JSON.stringify({
      deepseek: { type: "api", key: config.apiKey },
    }, null, 2));
    console.log(chalk.green(`[agent] API key written to ${authFile}`));
  }
  console.log(chalk.bold.blue("  pen-agent — automated penetration testing agent"));
  console.log(chalk.gray("  powered by opencode\n"));
  dump(config);

  const startTime = Date.now();

  const result = await startAgent(config);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(chalk.bold.green("\n=== DONE ==="));
  console.log(`  Time elapsed: ${elapsed}s`);
  console.log(`  Loops used:   ${result.loopsUsed}`);
  console.log(`  Flags found:  ${result.flagsFound.length}/${config.flagsNeeded}`);
  console.log(`  Log:          ${result.whiteboardPath}`);
  console.log(`  Flags JSON:   ${result.flagJsonPath}`);
  console.log(`  Flags text:   ${result.flagTextPath}`);

  if (result.flagsFound.length > 0) {
    console.log(chalk.green("\n  Flags:"));
    for (const f of result.flagsFound) {
      console.log(chalk.green(`    ${f}`));
    }
  }

  process.exit(result.flagsFound.length >= config.flagsNeeded ? 0 : 1);
}

function showStatus() {
  const dir = join(__dirname, ".pen-agent");
  const statusFile = join(dir, "status.json");
  const stateFile = join(dir, "state.json");
  const streamFile = join(dir, "stream.log");

  console.log(chalk.bold.blue("  pen-agent — status"));
  console.log();

  if (existsSync(statusFile)) {
    const status = JSON.parse(readFileSync(statusFile, "utf-8"));
    console.log(chalk.cyan("  === Runner Status ==="));
    console.log(`  Phase:     ${status.phase}`);
    console.log(`  Iteration: ${status.iter || "?"}`);
    if (status.bytes !== undefined) console.log(`  Output:    ${status.bytes} bytes so far`);
    if (status.error) console.log(chalk.red(`  Error:     ${status.error}`));
    console.log(`  Updated:   ${status.time}`);
    console.log();
  } else {
    console.log(chalk.gray("  No runner status — agent not running."));
    console.log();
  }

  if (existsSync(stateFile)) {
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    console.log(chalk.cyan("  === Whiteboard State ==="));
    console.log(`  Target:     ${state._config?.target || "?"}`);
    console.log(`  Flags:      ${state._flagsFound || 0}/${state._flagsNeeded || "?"}`);
    console.log(`  Iteration:  ${state.iteration || 0}`);
    console.log(`  Hosts:      ${(state.knownHosts || []).join(", ") || "(none)"}`);
    console.log(`  Credentials: ${(state.credentials || []).map((c) => `${c.password || "?"}@${c.host || "?"}`).join(", ") || "(none)"}`);
    if (state.keyPath?.length) {
      console.log(`  Key Steps:`);
      for (const s of state.keyPath) {
        console.log(`    [${s.iter}] ${s.step}`);
      }
    }
    console.log();
  }

  if (existsSync(streamFile)) {
    const out = spawnSync("tail", ["-30", streamFile], { encoding: "utf-8" });
    console.log(chalk.cyan("  === Stream Log (last 30 lines) ==="));
    console.log(out.stdout || "(empty)");
  }
}

main().catch((err) => {
  console.error(chalk.red(`Fatal: ${err.message}`));
  console.error(err.stack);
  process.exit(2);
});
