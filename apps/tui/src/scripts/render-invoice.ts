import { NavInvoicingProvider, InvoiceService, InvoiceRepo } from "nav";
import { loadNavConfig, INVOICES_DIR, COUNTER_FILE } from "../config.js";

async function main() {
  const navConfig = loadNavConfig();
  const invoiceRepo = new InvoiceRepo(INVOICES_DIR);
  const provider = new NavInvoicingProvider(navConfig, COUNTER_FILE, invoiceRepo);
  const service = new InvoiceService(provider);

  const invoiceNumber = process.argv[2] ?? (await provider.getLastInvoiceFile()).number;

  const { htmlPath } = await service.renderInvoice(invoiceNumber);
  console.log(`HTML: ${htmlPath}`);

  const { pdfPath, error } = service.renderPdf(invoiceNumber);
  if (error) {
    console.error(error);
  } else {
    console.log(`PDF: ${pdfPath}`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
