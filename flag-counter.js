const DEFAULT_FLAG_PATTERN = /(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]{2,32}\{)(?=[A-Za-z0-9_]*(?:ctf|flag))[A-Za-z0-9_]+\{[^}\s]{3,128}\}/gi;
const COMMON_FLAG_FORMAT = /^([A-Za-z0-9_]{2,32})\{([A-Za-z0-9][A-Za-z0-9_\-+=/@:.,!?#$%&*]{2,127})\}$/i;
const PLACEHOLDER_VALUES = new Set([
  "flag",
  "yourflag",
  "your_flag",
  "example",
  "test",
  "placeholder",
  "redacted",
  "todo",
]);

export class FlagCounter {
  constructor(pattern = DEFAULT_FLAG_PATTERN) {
    this.pattern = new RegExp(pattern.source, pattern.flags + (pattern.flags.includes("g") ? "" : "g"));
    this.found = new Set();
  }

  scan(text) {
    const matches = text.matchAll(this.pattern);
    const newlyFound = [];
    for (const m of matches) {
      const flag = m[0];
      if (!isCommonFlag(flag)) continue;
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

function isCommonFlag(flag) {
  const match = flag.match(COMMON_FLAG_FORMAT);
  if (!match) return false;

  const prefix = match[1];
  const inner = match[2];
  const normalized = inner.toLowerCase();
  if (!/(ctf|flag)/i.test(prefix)) return false;
  if (/^\d+$/.test(prefix)) return false;
  if (PLACEHOLDER_VALUES.has(normalized)) return false;
  if (/^x{3,}$/i.test(inner)) return false;
  if (/^\.+$/.test(inner)) return false;

  return true;
}
