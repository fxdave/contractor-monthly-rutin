import fs from "fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "path";

export class InvoiceRepo {
  constructor(private _invoicesFolderPath: string) {}

  filePath(invoiceNumber: string, ext: string): string {
    return path.join(this._invoicesFolderPath, invoiceNumber, `${invoiceNumber}.${ext}`);
  }

  hasInvoice(invoiceNumber: string): boolean {
    return existsSync(this.filePath(invoiceNumber, "xml"));
  }

  readInvoice(invoiceNumber: string): string {
    return readFileSync(this.filePath(invoiceNumber, "xml"), "utf8");
  }

  saveInvoice(invoiceNumber: string, content: Buffer | string): void {
    const filePath = this.filePath(invoiceNumber, "xml");
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  saveFile(invoiceNumber: string, ext: string, content: string): void {
    const filePath = this.filePath(invoiceNumber, ext);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
  }

  async getLastInvoiceFile(): Promise<{ number: string; path: string }> {
    const entries = await fs.readdir(this._invoicesFolderPath, { withFileTypes: true });
    const invoiceDirs = entries
      .filter((e) => e.isDirectory() && /^\d{4}-\d{6}$/.test(e.name))
      .map((e) => e.name)
      .sort();
    if (invoiceDirs.length === 0)
      throw new Error(`No invoice directories found in ${this._invoicesFolderPath}`);
    const last = invoiceDirs[invoiceDirs.length - 1];
    return {
      number: last,
      path: this.filePath(last, "xml"),
    };
  }

  async getNextInvoiceNumber(lastNumber?: string): Promise<string> {
    if (!lastNumber) lastNumber = (await this.getLastInvoiceFile()).number;
    const match = lastNumber.match(/^(\d{4})-(\d+)$/);
    if (!match)
      throw new Error(`Unexpected invoice number format: ${lastNumber}`);
    const year = parseInt(match[1], 10);
    const seq = parseInt(match[2], 10);
    const currentYear = new Date().getFullYear();
    const nextSeq = year === currentYear ? seq + 1 : 1;
    return `${currentYear}-${String(nextSeq).padStart(6, "0")}`;
  }
}
