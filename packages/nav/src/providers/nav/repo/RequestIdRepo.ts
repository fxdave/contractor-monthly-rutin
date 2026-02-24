import { readFileSync, writeFileSync, existsSync } from "node:fs";

export class RequestIdRepo {
  constructor(private _taxNumber: string, private _storePath: string) {}

  next(): string {
    const counter = (this._readCounter() + 1) % 10000;
    this._writeCounter(counter);
    const unixSecs = Math.floor(Date.now() / 1000);
    const paddedCounter = String(counter).padStart(4, "0");
    const taxNumber8 = this._taxNumber.slice(0, 8);
    // format: {8-digit taxNumber}{unix seconds}{4-digit counter} — max 30 chars
    return `${taxNumber8}${unixSecs}${paddedCounter}`;
  }

  private _readCounter(): number {
    if (!existsSync(this._storePath)) return 0;
    const data = JSON.parse(readFileSync(this._storePath, "utf8"));
    return data.counter ?? 0;
  }

  private _writeCounter(counter: number): void {
    writeFileSync(this._storePath, JSON.stringify({ counter }), "utf8");
  }
}
