import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const LOG_DIR = ".pen-agent";
const STATE_FILE = "state.json";

export class Whiteboard {
  constructor(workDir) {
    this.workDir = workDir;
    this.logDir = join(workDir, LOG_DIR);
    this.statePath = join(this.logDir, STATE_FILE);

    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    this.state = this._load();
    this.iterations = this.state.iterations || [];
    this.iteration = this.state.iteration || 0;
  }

  _load() {
    try {
      if (existsSync(this.statePath)) {
        return JSON.parse(readFileSync(this.statePath, "utf-8"));
      }
    } catch {}
    return {};
  }

  _save() {
    this.state.iteration = this.iteration;
    this.state.iterations = this.iterations;
    writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  recordIteration(findings) {
    this.iteration++;

    const entry = {
      iter: this.iteration,
      time: new Date().toISOString(),
      summary: findings.summary || "",
      flags: findings.newFlags || [],
      hosts: findings.newHosts || [],
      services: findings.newServices || [],
      credentials: findings.newCredentials || [],
      skillsUsed: findings.skillsUsed || [],
      playbooksUsed: findings.playbooksUsed || [],
      actions: findings.keyActions || [],
      toolCalls: findings.toolCalls || [],
      analysisTrail: findings.analysisTrail || [],
      problems: findings.problems || [],
      nextSteps: findings.nextSteps || [],
      rewardEvaluation: findings.rewardEvaluation || null,
      position: findings.position || "unknown",
      access: findings.newAccess || [],
      intel: findings.intel || [],
    };

    this.iterations.push(entry);
    this._save();
    return entry;
  }

  allFlags() {
    const flags = [];
    for (const iter of this.iterations) {
      for (const f of iter.flags) {
        if (!flags.includes(f)) flags.push(f);
      }
    }
    return flags;
  }

  allHosts() {
    const hosts = [];
    for (const iter of this.iterations) {
      for (const h of iter.hosts) {
        if (h && !hosts.includes(h)) hosts.push(h);
      }
    }
    return hosts;
  }

  allServices() {
    const seen = new Set();
    const svcs = [];
    for (const iter of this.iterations) {
      for (const s of iter.services) {
        const key = `${s.host}:${s.port}`;
        if (!seen.has(key)) { seen.add(key); svcs.push(s); }
      }
    }
    return svcs;
  }

  allCredentials() {
    const seen = new Set();
    const creds = [];
    for (const iter of this.iterations) {
      for (const c of iter.credentials) {
        const key = `${c.username || ""}:${c.password || ""}@${c.host || ""}`;
        if (!seen.has(key)) { seen.add(key); creds.push(c); }
      }
    }
    return creds;
  }

  summary() {
    const lines = [];
    lines.push(`Target: ${this.state._config?.target || "?"}`);
    lines.push(`Flags: ${this.state._flagsFound || 0}/${this.state._flagsNeeded || "?"}`);

    for (const iter of this.iterations) {
      lines.push(`\n── iter ${iter.iter} ──`);
      if (iter.summary) lines.push(`  Summary: ${iter.summary}`);
      if (iter.position && iter.position !== "unknown") {
        lines.push(`  Position: ${iter.position}`);
      }
      if (iter.flags.length) lines.push(`  Flags: ${iter.flags.join(", ")}`);
      if (iter.hosts.length) lines.push(`  Hosts: ${iter.hosts.join(", ")}`);
      if (iter.services.length) {
        lines.push(`  Services: ${iter.services.map((s) => `${s.host}:${s.port}`).join(", ")}`);
      }
      if (iter.credentials.length) {
        lines.push(`  Credentials: ${iter.credentials.map((c) => `${c.username || "?"}:${c.password || "?"}@${c.host || "?"}`).join(", ")}`);
      }
      if (iter.skillsUsed?.length) {
        lines.push(`  Skills: ${iter.skillsUsed.map((s) => `${s.name || "?"}: ${s.result || s.reason || ""}`).join("; ")}`);
      }
      if (iter.playbooksUsed?.length) {
        lines.push(`  Playbooks: ${iter.playbooksUsed.map((p) => `${p.id || "?"}: ${p.result || p.step || ""}`).join("; ")}`);
      }
      if (iter.access.length) lines.push(`  Access: ${iter.access.join("; ")}`);
      if (iter.intel.length) lines.push(`  Intel: ${iter.intel.join("; ")}`);
      if (iter.toolCalls?.length) {
        lines.push(`  Tools: ${iter.toolCalls.map((t) => `${t.tool || "tool"}: ${t.command || ""} => ${t.result || ""}`).join("; ")}`);
      }
      if (iter.analysisTrail?.length) {
        lines.push(`  Analysis: ${iter.analysisTrail.map((a) => `[${a.phase || "?"}] ${a.action || ""} -> ${a.evidence || ""}`).join("; ")}`);
      }
      if (iter.problems?.length) {
        lines.push(`  Problems: ${iter.problems.map((p) => `${p.symptom || "?"}: ${p.resolution || ""}`).join("; ")}`);
      }
      if (iter.rewardEvaluation) {
        lines.push(`  Reward: ${iter.rewardEvaluation.level || "?"}: ${iter.rewardEvaluation.reason || ""}`);
      }
      if (iter.nextSteps?.length) lines.push(`  Next: ${iter.nextSteps.join("; ")}`);
    }
    return lines.join("\n");
  }

  setConfig(key, value) {
    if (!this.state._config) this.state._config = {};
    this.state._config[key] = value;
    this._save();
  }

  setFlagCount(found, needed) {
    this.state._flagsFound = found;
    this.state._flagsNeeded = needed;
    this._save();
  }

  getFlagsFound() {
    return this.state._flagsFound || 0;
  }

  getFlagsNeeded() {
    return this.state._flagsNeeded || 0;
  }
}
