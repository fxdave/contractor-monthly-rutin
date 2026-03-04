import { spawnSync } from "node:child_process";
import { lineAmounts } from "./InvoicingProvider.js";
import type { NavInvoicingProvider } from "./providers/nav/NavInvoicingProvider.js";

export class InvoiceService {
  private _provider: NavInvoicingProvider;

  constructor(provider: NavInvoicingProvider) {
    this._provider = provider;
  }

  async sync(): Promise<{ saved: string[]; skipped: string[] }> {
    return this._provider.syncRecentInvoices();
  }

  async getNextInvoiceNumber(): Promise<{
    templateNumber: string;
    nextNumber: string;
  }> {
    const lastFile = await this._provider.getLastInvoiceFile();
    const nextNumber = await this._provider.getNextInvoiceNumber(lastFile.number);
    return {
      templateNumber: lastFile.number,
      nextNumber,
    };
  }

  calculateInvoice(
    quantity: number,
    unitPrice: number,
    vatRate: number,
    paymentDays: number = 30,
  ): {
    netAmount: number;
    vatAmount: number;
    grossAmount: number;
    issueDate: string;
    deliveryDate: string;
    paymentDate: string;
  } {
    const { netAmount, vatAmount, grossAmount } = lineAmounts({
      lineNumber: 1, description: "", quantity, unitPrice, vatRate,
    });
    const today = new Date();
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const issueDate = fmt(today);
    const deliveryDate = fmt(new Date(today.getFullYear(), today.getMonth(), 0));
    const paymentDeadline = new Date(today);
    paymentDeadline.setDate(paymentDeadline.getDate() + paymentDays);
    const paymentDate = fmt(paymentDeadline);
    return { netAmount, vatAmount, grossAmount, issueDate, deliveryDate, paymentDate };
  }

  async createInvoice(opts: {
    quantity: number;
    unitPrice: number;
    invoiceNumber: string;
    issueDate: string;
    deliveryDate: string;
    paymentDate: string;
    templateNumber: string;
  }): Promise<{ transactionId: string; invoiceNumber: string }> {
    const templateData = await this._provider.getInvoiceData(opts.templateNumber);
    return this._provider.createInvoice(templateData, {
      invoiceNumber: opts.invoiceNumber,
      issueDate: opts.issueDate,
      deliveryDate: opts.deliveryDate,
      paymentDate: opts.paymentDate,
      lines: [{ lineNumber: 1, quantity: opts.quantity, unitPrice: opts.unitPrice }],
    });
  }

  async buildInvoice(opts: {
    quantity: number;
    unitPrice: number;
    invoiceNumber: string;
    issueDate: string;
    deliveryDate: string;
    paymentDate: string;
    templateNumber: string;
  }): Promise<{ invoiceNumber: string }> {
    const templateData = await this._provider.getInvoiceData(opts.templateNumber);
    return this._provider.buildInvoice(templateData, {
      invoiceNumber: opts.invoiceNumber,
      issueDate: opts.issueDate,
      deliveryDate: opts.deliveryDate,
      paymentDate: opts.paymentDate,
      lines: [{ lineNumber: 1, quantity: opts.quantity, unitPrice: opts.unitPrice }],
    });
  }

  async sendInvoice(invoiceNumber: string): Promise<{ transactionId: string }> {
    return this._provider.sendInvoice(invoiceNumber);
  }

  async buildStornoInvoice(invoiceNumber: string): Promise<{ stornoNumber: string }> {
    return this._provider.buildStornoInvoice(invoiceNumber);
  }

  async stornoInvoice(
    invoiceNumber: string
  ): Promise<{ transactionId: string; invoiceNumber: string }> {
    return this._provider.stornoInvoice(invoiceNumber);
  }

  async downloadAllInvoices(
    fromYear: number = 2019,
    toYear?: number
  ): Promise<{ saved: number; skipped: number; failed: number }> {
    return this._provider.downloadAllInvoices(fromYear, toYear);
  }

  async renderInvoice(invoiceNumber: string): Promise<{ htmlPath: string; xmlPath: string }> {
    return this._provider.renderInvoiceToFile(invoiceNumber);
  }

  renderPdf(invoiceNumber: string): { pdfPath: string; error?: string } {
    const htmlPath = this._provider.invoiceFilePath(invoiceNumber, "html");
    const pdfPath = this._provider.invoiceFilePath(invoiceNumber, "pdf");

    const result = spawnSync(
      "weasyprint",
      [
        "--encoding", "utf-8",
        htmlPath,
        pdfPath
      ],
      { stdio: "inherit" }
    );

    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { pdfPath, error: "pdf generator not found" };
      }
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`pdf generator exited with status ${result.status}`);
    }

    return { pdfPath };
  }
}
