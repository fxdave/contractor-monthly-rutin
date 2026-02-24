import { createInterface } from "node:readline";
import { NavInvoicingProvider, InvoiceService, InvoiceRepo, computeSummary } from "nav";
import { loadNavConfig, INVOICES_DIR, COUNTER_FILE } from "../config.js";

async function main() {
  const invoiceNumber = process.argv[2];
  if (!invoiceNumber) {
    console.error("Usage: npx tsx scripts/storno-invoice.ts <INVOICE_NUMBER>");
    process.exit(1);
  }

  const navConfig = loadNavConfig();
  const invoiceRepo = new InvoiceRepo(INVOICES_DIR);
  const provider = new NavInvoicingProvider(navConfig, COUNTER_FILE, invoiceRepo);
  const service = new InvoiceService(provider);

  console.log("Syncing with NAV...");
  const sync = await service.sync();
  if (sync.saved.length > 0) {
    console.log(`  Downloaded: ${sync.saved.join(", ")}`);
  }
  console.log(`  Local invoices up to date (${sync.saved.length + sync.skipped.length} recent).`);
  console.log();

  const data = await provider.getInvoiceData(invoiceNumber);

  console.log(`Original: ${data.invoiceNumber}`);
  console.log(`Issued:   ${data.issueDate}`);
  console.log(`Gross:    ${computeSummary(data.lines).grossAmount.toLocaleString("hu-HU")} HUF`);
  console.log();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) =>
    rl.question(`Storno invoice ${invoiceNumber}? [y/N] `, resolve)
  );
  rl.close();

  if (answer.trim().toLowerCase() !== "y") {
    console.log("Aborted.");
    process.exit(0);
  }

  const result = await service.stornoInvoice(invoiceNumber);
  console.log(`Success! Transaction ID: ${result.transactionId}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
