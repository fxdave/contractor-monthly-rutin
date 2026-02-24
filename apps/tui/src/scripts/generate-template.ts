import { join } from "node:path";
import { NavInvoicingProvider, InvoiceRepo } from "nav";
import { loadNavConfig, INVOICES_DIR, COUNTER_FILE, TEMPLATES_DIR } from "../config.js";

async function main() {
  const navConfig = loadNavConfig();
  const invoiceRepo = new InvoiceRepo(INVOICES_DIR);
  const provider = new NavInvoicingProvider(navConfig, COUNTER_FILE, invoiceRepo);

  const templatePath = join(TEMPLATES_DIR, "default.json");
  console.log("Generating default template...");
  await provider.generateTemplate(templatePath);
  console.log(`  Saved to ${templatePath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
