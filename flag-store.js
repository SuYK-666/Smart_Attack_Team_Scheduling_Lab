import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class FlagStore {
  constructor(artifactDir, config) {
    this.artifactDir = artifactDir;
    this.jsonPath = join(artifactDir, "flags.json");
    this.textPath = join(artifactDir, "flags.txt");
    this.config = config;
  }

  write(flags, meta = {}) {
    mkdirSync(this.artifactDir, { recursive: true });

    const now = new Date().toISOString();
    const uniqueFlags = [...new Set(flags)];
    const data = {
      target: this.config.target,
      targetHost: this.config.targetHost,
      targetPort: this.config.targetPort,
      flagsNeeded: this.config.flagsNeeded,
      maxFlags: this.config.maxFlags,
      count: uniqueFlags.length,
      updatedAt: now,
      loopsUsed: meta.loopsUsed ?? null,
      flags: uniqueFlags.map((value, index) => ({
        index: index + 1,
        value,
      })),
    };

    writeFileSync(this.jsonPath, JSON.stringify(data, null, 2));
    writeFileSync(this.textPath, uniqueFlags.length ? `${uniqueFlags.join("\n")}\n` : "");
  }
}
