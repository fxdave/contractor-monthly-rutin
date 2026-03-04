import { createInterface } from "node:readline";
import { NavInvoicingProvider, InvoiceRepo } from "nav";
import { loadNavConfig, INVOICES_DIR, COUNTER_FILE } from "../config.js";

async function main() {
  const navConfig = loadNavConfig();
  const invoiceRepo = new InvoiceRepo(INVOICES_DIR);
  const provider = new NavInvoicingProvider(navConfig, COUNTER_FILE, invoiceRepo);

  const lastInvoice = await provider.getLastInvoiceFile();
  const defaultNumber = lastInvoice.number;

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let invoiceNumber = process.argv[2];
  if (!invoiceNumber) {
    invoiceNumber = await new Promise<string>((resolve) =>
      rl.question(`Invoice [${defaultNumber}]: `, (answer) =>
        resolve(answer.trim() || defaultNumber)
      )
    );
  }

  const previousNumber = await invoiceRepo.getPreviousInvoiceNumber(invoiceNumber);
  if (previousNumber && !invoiceRepo.isSent(previousNumber)) {
    console.log(`⚠ Warning: Previous invoice ${previousNumber} has not been sent to NAV yet!`);
  }

  const confirm = await new Promise<string>((resolve) =>
    rl.question(`Submit ${invoiceNumber} to NAV? [y/N] `, resolve)
  );
  rl.close();

  if (confirm.trim().toLowerCase() !== "y") {
    console.log("Aborted.");
    process.exit(0);
  }

  console.log(`Sending ${invoiceNumber} to NAV...`);
  const { transactionId } = await provider.sendInvoice(invoiceNumber);
  console.log(`Success! Transaction ID: ${transactionId}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
