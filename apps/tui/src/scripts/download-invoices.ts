import { NavInvoicingProvider, InvoiceService, InvoiceRepo } from "nav";
import { loadNavConfig, INVOICES_DIR, COUNTER_FILE } from "../config.js";

async function main() {
  const navConfig = loadNavConfig();
  const invoiceRepo = new InvoiceRepo(INVOICES_DIR);
  const provider = new NavInvoicingProvider(navConfig, COUNTER_FILE, invoiceRepo);
  const service = new InvoiceService(provider);

  const fromYear = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;
  const toYear = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;
  const { saved, skipped, failed } = await service.downloadAllInvoices(fromYear, toYear);
  console.log(`\nDone. Saved: ${saved}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
