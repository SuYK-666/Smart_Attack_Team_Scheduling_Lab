const TAIL_CHARS = 2048;

export class StreamFlagScanner {
  constructor(flagCounter, options = {}) {
    this.flagCounter = flagCounter;
    this.rejectMatch = options.rejectMatch;
    this.tail = "";
  }

  scan(chunk) {
    const text = this.tail + chunk;
    const found = this.flagCounter.scan(text, { rejectMatch: this.rejectMatch });
    this.tail = text.slice(-TAIL_CHARS);
    return found;
  }
}
