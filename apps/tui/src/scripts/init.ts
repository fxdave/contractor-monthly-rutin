import { NavInvoicingProvider, InvoiceRepo } from "nav";
import { loadNavConfig, INVOICES_DIR, COUNTER_FILE } from "../config.js";

async function main() {
  const navConfig = loadNavConfig();
  const invoiceRepo = new InvoiceRepo(INVOICES_DIR);
  const provider = new NavInvoicingProvider(navConfig, COUNTER_FILE, invoiceRepo);

  console.log("Downloading recent invoices from NAV...");
  const { saved, skipped } = await provider.syncRecentInvoices();
  if (saved.length > 0) {
    console.log(`  Downloaded: ${saved.join(", ")}`);
  }
  console.log(`  Total: ${saved.length + skipped.length} invoices (${saved.length} new, ${skipped.length} existing).`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
