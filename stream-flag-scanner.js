const TAIL_CHARS = 512;

export class StreamFlagScanner {
  constructor(flagCounter) {
    this.flagCounter = flagCounter;
    this.tail = "";
  }

  scan(chunk) {
    const text = this.tail + chunk;
    const found = this.flagCounter.scan(text);
    this.tail = text.slice(-TAIL_CHARS);
    return found;
  }
}
