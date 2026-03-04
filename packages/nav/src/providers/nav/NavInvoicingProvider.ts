import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { InvoiceData, InvoiceModifications, CreateInvoiceResult } from "../../InvoicingProvider.js";
import type { NavConfig } from "./config.js";
import { NavService } from "./NavService.js";
import { RequestIdRepo } from "./repo/RequestIdRepo.js";
import type { InvoiceRepo } from "./repo/InvoiceRepo.js";
import { parseNavXml } from "./xml/parse.js";
import { buildNavXml, buildStornoXml, applyModifications } from "./xml/build.js";
import { renderInvoiceHtml } from "./xml/render.js";

function monthRange(year: number, month: number): { dateFrom: string; dateTo: string } {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  return {
    dateFrom: first.toISOString().slice(0, 10),
    dateTo: last.toISOString().slice(0, 10),
  };
}

export class NavInvoicingProvider {
  private _nav: NavService;
  private _config: NavConfig;

  constructor(config: NavConfig, requestIdStorePath: string, private _invoiceRepo: InvoiceRepo) {
    this._config = config;
    const repo = new RequestIdRepo(config.taxNumber, requestIdStorePath);
    this._nav = new NavService(config, repo);
  }

  invoiceFilePath(invoiceNumber: string, ext: string): string {
    return this._invoiceRepo.filePath(invoiceNumber, ext);
  }

  async getLastInvoiceFile(): Promise<{ number: string; path: string }> {
    return this._invoiceRepo.getLastInvoiceFile();
  }

  async getNextInvoiceNumber(lastNumber?: string): Promise<string> {
    return this._invoiceRepo.getNextInvoiceNumber(lastNumber);
  }

  async ensureInvoiceDownloaded(invoiceNumber: string): Promise<void> {
    if (!this._invoiceRepo.hasInvoice(invoiceNumber)) {
      const rawXml = await this._nav.queryInvoiceData(invoiceNumber);
      this._invoiceRepo.saveInvoice(invoiceNumber, rawXml);
      this._invoiceRepo.markSent(invoiceNumber, "downloaded");
    }
  }

  async getInvoiceData(invoiceNumber: string): Promise<InvoiceData> {
    await this.ensureInvoiceDownloaded(invoiceNumber);
    return parseNavXml(this._invoiceRepo.readInvoice(invoiceNumber));
  }

  async generateTemplate(outputPath: string): Promise<void> {
    const { number } = await this._invoiceRepo.getLastInvoiceFile();
    const data = await this.getInvoiceData(number);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
  }

  async renderInvoiceToFile(invoiceNumber: string): Promise<{ htmlPath: string; xmlPath: string }> {
    const data = await this.getInvoiceData(invoiceNumber);
    const html = renderInvoiceHtml(data, this._config.supplierExtras);
    this._invoiceRepo.saveFile(invoiceNumber, "html", html);
    return {
      htmlPath: this._invoiceRepo.filePath(invoiceNumber, "html"),
      xmlPath: this._invoiceRepo.filePath(invoiceNumber, "xml"),
    };
  }

  async createInvoice(
    template: InvoiceData,
    mods: InvoiceModifications
  ): Promise<CreateInvoiceResult> {
    const data = applyModifications(template, mods);
    const xml = buildNavXml(data);
    const transactionId = await this._nav.manageInvoice(xml, "CREATE");
    this._invoiceRepo.saveInvoice(data.invoiceNumber, xml);
    return { transactionId, invoiceNumber: data.invoiceNumber };
  }

  buildInvoice(
    template: InvoiceData,
    mods: InvoiceModifications
  ): { invoiceNumber: string } {
    const data = applyModifications(template, mods);
    const xml = buildNavXml(data);
    this._invoiceRepo.saveInvoice(data.invoiceNumber, xml);
    return { invoiceNumber: data.invoiceNumber };
  }

  async sendInvoice(invoiceNumber: string): Promise<{ transactionId: string }> {
    const xml = this._invoiceRepo.readInvoice(invoiceNumber);
    const operation = xml.includes("<invoiceReference>") ? "STORNO" : "CREATE";
    const transactionId = await this._nav.manageInvoice(xml, operation);
    this._invoiceRepo.markSent(invoiceNumber, transactionId);
    return { transactionId };
  }

  async buildStornoInvoice(invoiceNumber: string): Promise<{ stornoNumber: string }> {
    const data = await this.getInvoiceData(invoiceNumber);
    const stornoNumber = await this._invoiceRepo.getNextInvoiceNumber();
    const stornoDate = new Date().toISOString().slice(0, 10);
    const xml = buildStornoXml(stornoNumber, stornoDate, data);
    this._invoiceRepo.saveInvoice(stornoNumber, xml);
    return { stornoNumber };
  }

  async stornoInvoice(invoiceNumber: string): Promise<CreateInvoiceResult> {
    const data = await this.getInvoiceData(invoiceNumber);
    const stornoNumber = await this._invoiceRepo.getNextInvoiceNumber();
    const stornoDate = new Date().toISOString().slice(0, 10);
    const xml = buildStornoXml(stornoNumber, stornoDate, data);
    const transactionId = await this._nav.manageInvoice(xml, "STORNO");
    return { transactionId, invoiceNumber: stornoNumber };
  }

  async syncRecentInvoices(): Promise<{ saved: string[]; skipped: string[] }> {
    const saved: string[] = [];
    const skipped: string[] = [];

    const now = new Date();
    const dateTo = now.toISOString().slice(0, 10);
    const dateFrom = new Date(now.getTime() - 34 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const invoiceNumbers = await this._queryInvoiceNumbers(dateFrom, dateTo);

    for (const num of invoiceNumbers) {
      if (this._invoiceRepo.hasInvoice(num)) {
        skipped.push(num);
        continue;
      }
      const rawXml = await this._nav.queryInvoiceData(num);
      this._invoiceRepo.saveInvoice(num, rawXml);
      this._invoiceRepo.markSent(num, "downloaded");
      saved.push(num);
    }

    return { saved, skipped };
  }

  async downloadAllInvoices(
    fromYear: number = 2019,
    toYear?: number
  ): Promise<{ saved: number; skipped: number; failed: number }> {
    const today = new Date();
    const endYear = toYear ?? today.getFullYear();
    let totalSaved = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (let year = fromYear; year <= endYear; year++) {
      const lastMonth = year === today.getFullYear() ? today.getMonth() + 1 : 12;

      for (let month = 1; month <= lastMonth; month++) {
        const { dateFrom, dateTo } = monthRange(year, month);

        let invoiceNumbers: string[];
        try {
          invoiceNumbers = await this._queryInvoiceNumbers(dateFrom, dateTo);
        } catch {
          totalFailed++;
          continue;
        }

        for (const num of invoiceNumbers) {
          if (this._invoiceRepo.hasInvoice(num)) {
            totalSkipped++;
            continue;
          }
          try {
            const rawXml = await this._nav.queryInvoiceData(num);
            this._invoiceRepo.saveInvoice(num, rawXml);
            this._invoiceRepo.markSent(num, "downloaded");
            totalSaved++;
          } catch {
            totalFailed++;
          }
        }
      }
    }

    return { saved: totalSaved, skipped: totalSkipped, failed: totalFailed };
  }

  private async _queryInvoiceNumbers(dateFrom: string, dateTo: string): Promise<string[]> {
    const invoiceNumbers: string[] = [];
    let currentPage = 1;
    let availablePage = 1;
    do {
      const result = await this._nav.queryInvoiceDigest(currentPage, dateFrom, dateTo);
      availablePage = result.availablePage;
      for (const digest of result.digests) {
        invoiceNumbers.push(digest.invoiceNumber);
      }
      currentPage++;
    } while (currentPage <= availablePage);
    return invoiceNumbers;
  }
}
