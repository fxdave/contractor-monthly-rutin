import { createInterface } from "node:readline";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NavInvoicingProvider, InvoiceService, InvoiceRepo } from "nav";
import { loadNavConfig, INVOICES_DIR, COUNTER_FILE, CONFIG_DIR } from "../config.js";

interface Product {
  id: string;
  description: string;
  unitPrice: number;
  vatRate: number;
  unitOfMeasure?: string;
  unitOfMeasureOwn?: string;
}

function loadProducts(): Product[] {
  const path = join(CONFIG_DIR, "products.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  const quantityArg = process.argv[2];
  const productArg = process.argv[3];

  if (!quantityArg) {
    console.error("Usage: npx tsx scripts/create-invoice.ts <quantity> [product-id]");
    process.exit(1);
  }

  const quantity = parseFloat(quantityArg);
  if (isNaN(quantity) || quantity <= 0) {
    console.error("Invalid quantity:", quantityArg);
    process.exit(1);
  }

  const products = loadProducts();
  let unitPrice: number;
  let vatRate: number;

  if (productArg && products.length > 0) {
    const product = products.find((p) => p.id === productArg);
    if (!product) {
      console.error(`Product "${productArg}" not found. Available: ${products.map((p) => p.id).join(", ")}`);
      process.exit(1);
    }
    unitPrice = product.unitPrice;
    vatRate = product.vatRate;
  } else if (products.length > 0) {
    unitPrice = products[0].unitPrice;
    vatRate = products[0].vatRate;
  } else {
    console.error("No products configured. Add products to data/config/products.json");
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

  const { templateNumber, nextNumber } = await service.getNextInvoiceNumber();
  const { netAmount, vatAmount, grossAmount, issueDate, deliveryDate, paymentDate } =
    service.calculateInvoice(quantity, unitPrice, vatRate);

  console.log(`Template:      ${templateNumber}`);
  console.log(`Invoice:       ${nextNumber}`);
  console.log(`Issue date:    ${issueDate}`);
  console.log(`Delivery date: ${deliveryDate}`);
  console.log(`Payment due:   ${paymentDate}`);
  console.log(`Quantity:      ${quantity} ora`);
  console.log(`Unit price:    ${unitPrice.toLocaleString("hu-HU")} HUF`);
  console.log(`Net:           ${netAmount.toLocaleString("hu-HU")} HUF`);
  console.log(`VAT (${Math.round(vatRate * 100)}%):     ${vatAmount.toLocaleString("hu-HU")} HUF`);
  console.log(`Gross:         ${grossAmount.toLocaleString("hu-HU")} HUF`);
  console.log();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) =>
    rl.question("Submit to NAV? [y/N] ", resolve)
  );
  rl.close();

  if (answer.trim().toLowerCase() !== "y") {
    console.log("Aborted.");
    process.exit(0);
  }

  const result = await service.createInvoice({
    quantity,
    unitPrice,
    invoiceNumber: nextNumber,
    issueDate,
    deliveryDate,
    paymentDate,
    templateNumber,
  });

  console.log(`Success! Transaction ID: ${result.transactionId}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
