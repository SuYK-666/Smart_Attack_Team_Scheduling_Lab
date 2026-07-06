const DEFAULT_FLAG_PATTERN = /flag\{[^}]+\}|Flag\{[^}]+\}|CTF\{[^}]+\}/g;

export class FlagCounter {
  constructor(pattern) {
    this.pattern = new RegExp(pattern.source, pattern.flags + (pattern.flags.includes("g") ? "" : "g"));
    this.found = new Set();
  }

  scan(text) {
    const matches = text.matchAll(this.pattern);
    const newlyFound = [];
    for (const m of matches) {
      const flag = m[0];
      const inner = flag.slice(5, -1);
      if (inner.length < 3) continue;
      if (/[\[\]\\^$]/.test(inner)) continue;
      if (!this.found.has(flag)) {
        this.found.add(flag);
        newlyFound.push(flag);
      }
    }
    return newlyFound;
  }

  count() {
    return this.found.size;
  }

  all() {
    return [...this.found];
  }

  reset() {
    this.found.clear();
  }
}
