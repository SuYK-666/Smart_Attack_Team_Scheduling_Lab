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

  scan(text, options = {}) {
    const matches = text.matchAll(this.pattern);
    const newlyFound = [];
    for (const m of matches) {
      const flag = normalizeFlag(m[0]);
      if (!isCommonFlag(flag)) continue;
      if (options.rejectMatch?.(flag, text, m.index || 0)) continue;
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

  delete(flag) {
    return this.found.delete(flag);
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
  if (/[*?]/.test(inner)) return false;
  if (/\b(?:your|example|sample|placeholder|expected|format|todo|redacted)\b/i.test(inner)) return false;
  if (/^x{3,}$/i.test(inner)) return false;
  if (/^\.+$/.test(inner)) return false;

  return true;
}

function normalizeFlag(raw) {
  const match = raw.match(COMMON_FLAG_FORMAT);
  if (!match) return raw;

  const prefix = match[1];
  const inner = match[2];
  if (!/(ctf|flag)/i.test(prefix)) return raw;

  // strip a single leading lowercase letter before FLAG/CTF (artifact from \n, \r, etc.)
  // e.g. "nFLAG" → "FLAG", "rCTF" → "CTF", but keep "FLAG_XXX" and "SOME_FLAG" as-is
  const cleaned = prefix.replace(/^[a-z](FLAG|CTF)$/i, "$1");

  return `${cleaned}{${inner}}`;
}
