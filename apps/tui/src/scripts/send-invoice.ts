import { createInterface } from "node:readline";
import { NavInvoicingProvider, InvoiceRepo, parseNavXml } from "nav";
import { loadNavConfig, INVOICES_DIR, COUNTER_FILE } from "../config.js";

async function main() {
  const navConfig = loadNavConfig();
  const invoiceRepo = new InvoiceRepo(INVOICES_DIR);
  const provider = new NavInvoicingProvider(navConfig, COUNTER_FILE, invoiceRepo);

  const hasDraft = invoiceRepo.hasInvoice("draft");
  const defaultNumber = hasDraft
    ? "draft"
    : (await provider.getLastInvoiceFile()).number;

  const invoiceNumber = process.argv[2] || defaultNumber;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => process.exit(130));

  // Show real invoice number when sending a draft
  let displayNumber = invoiceNumber;
  if (invoiceNumber === "draft") {
    const xml = invoiceRepo.readInvoice("draft");
    const data = await parseNavXml(xml);
    displayNumber = data.invoiceNumber;
    console.log(`Draft contains invoice ${displayNumber}`);
  } else {
    const previousNumber = await invoiceRepo.getPreviousInvoiceNumber(invoiceNumber);
    if (previousNumber && !invoiceRepo.isSent(previousNumber)) {
      console.log(`⚠ Warning: Previous invoice ${previousNumber} has not been sent to NAV yet!`);
    }
  }

  const confirm = await new Promise<string>((resolve) =>
    rl.question(`Submit ${displayNumber} to NAV? [y/N] `, resolve)
  );
  rl.close();

  if (confirm.trim().toLowerCase() !== "y") {
    console.log("Aborted.");
    process.exit(0);
  }

  console.log(`Sending ${displayNumber} to NAV...`);
  const result = await provider.sendInvoice(invoiceNumber);
  console.log(`Success! Invoice ${result.invoiceNumber}, Transaction ID: ${result.transactionId}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
