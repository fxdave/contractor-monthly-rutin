import { createInterface } from "node:readline";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  NavInvoicingProvider,
  InvoiceService,
  InvoiceRepo,
  type InvoiceModifications,
} from "nav";
import {
  loadNavConfig,
  INVOICES_DIR,
  COUNTER_FILE,
  CONFIG_DIR,
} from "../config.js";

interface Partner {
  id: string;
  name: string;
  vatStatus: string;
  taxNumber?: { taxpayerId: string; vatCode: string; countyCode: string };
  address: {
    countryCode: string;
    postalCode: string;
    city: string;
    streetAddress: string;
  };
}

interface Product {
  id: string;
  description: string;
  unitPrice: number;
  vatRate: number;
  paymentDays?: number;
  unitOfMeasure?: string;
  unitOfMeasureOwn?: string;
}

function loadProducts(): Product[] {
  const path = join(CONFIG_DIR, "products.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadPartners(): Partner[] {
  const path = join(CONFIG_DIR, "partners.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) =>
    rl.question(prompt, (answer) => resolve(answer.trim())),
  );
}

async function askDefault(
  prompt: string,
  defaultValue: string,
): Promise<string> {
  const answer = await ask(`${prompt} [${defaultValue}]: `);
  return answer || defaultValue;
}

async function choose<T extends string>(
  message: string,
  options: { label: string; value: T }[],
): Promise<T> {
  console.log(`\n${message}`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${i + 1}) ${options[i].label}`);
  }
  while (true) {
    const answer = await ask(`Choose [1-${options.length}]: `);
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < options.length) return options[idx].value;
    console.log("Invalid choice.");
  }
}

async function main() {
  const products = loadProducts();
  const partners = loadPartners();

  if (products.length === 0) {
    console.error(
      "No products configured. Add products to data/config/products.json",
    );
    process.exit(1);
  }

  const navConfig = loadNavConfig();
  const invoiceRepo = new InvoiceRepo(INVOICES_DIR);
  const provider = new NavInvoicingProvider(
    navConfig,
    COUNTER_FILE,
    invoiceRepo,
  );
  const service = new InvoiceService(provider);

  console.log("Syncing with NAV...");
  const sync = await service.sync();
  if (sync.saved.length > 0)
    console.log(`  Downloaded: ${sync.saved.join(", ")}`);
  console.log(
    `  Local invoices up to date (${sync.saved.length + sync.skipped.length} recent).\n`,
  );

  let unitPrice: number;
  let vatRate: number;
  let description: string;
  let paymentDays = 30;
  let unitOfMeasureOwn: string | undefined;

  if (products.length > 1) {
    const productOptions = products.map((p) => ({
      label: `${p.description} (${p.unitPrice.toLocaleString("hu-HU")} HUF/${p.unitOfMeasureOwn ?? "pc"})`,
      value: p.id,
    }));
    const productId = await choose("Product:", productOptions);
    const product = products.find((p) => p.id === productId)!;
    unitPrice = product.unitPrice;
    vatRate = product.vatRate;
    description = product.description;
    unitOfMeasureOwn = product.unitOfMeasureOwn;
    if (product.paymentDays != null) paymentDays = product.paymentDays;
  } else {
    const product = products[0];
    unitPrice = product.unitPrice;
    vatRate = product.vatRate;
    description = product.description;
    unitOfMeasureOwn = product.unitOfMeasureOwn;
    if (product.paymentDays != null) paymentDays = product.paymentDays;
  }

  let customerOverride: Partner | undefined;
  if (partners.length > 0) {
    const partnerOptions = [
      { label: "From template (no change)", value: "__template" as string },
      ...partners.map((p) => ({ label: p.name, value: p.id })),
    ];
    const partnerId = await choose("Partner:", partnerOptions);
    if (partnerId !== "__template") {
      customerOverride = partners.find((p) => p.id === partnerId)!;
    }
  }

  const quantityArg = process.argv[2];
  let quantity: number;
  if (quantityArg) {
    quantity = parseFloat(quantityArg);
  } else {
    const quantityStr = await ask("Quantity: ");
    quantity = parseFloat(quantityStr);
  }
  if (isNaN(quantity) || quantity <= 0) {
    console.error("Invalid quantity.");
    process.exit(1);
  }

  const { templateNumber, nextNumber } = await service.getNextInvoiceNumber();
  const {
    netAmount,
    vatAmount,
    grossAmount,
    issueDate,
    deliveryDate,
    paymentDate,
  } = service.calculateInvoice(quantity, unitPrice, vatRate, paymentDays);

  console.log();
  console.log(`Template:      ${templateNumber}`);
  console.log(`Invoice:       ${nextNumber}`);
  console.log(`Issue date:    ${issueDate}`);
  console.log(`Delivery date: ${deliveryDate}`);
  console.log(`Payment due:   ${paymentDate}`);
  console.log(`Quantity:      ${quantity} ${unitOfMeasureOwn ?? "pc"}`);
  console.log(`Unit price:    ${unitPrice.toLocaleString("hu-HU")} HUF`);
  console.log(`Net:           ${netAmount.toLocaleString("hu-HU")} HUF`);
  console.log(
    `VAT (${Math.round(vatRate * 100)}%):      ${vatAmount.toLocaleString("hu-HU")} HUF`,
  );
  console.log(`Gross:         ${grossAmount.toLocaleString("hu-HU")} HUF`);
  console.log();

  const templateData = await provider.getInvoiceData(templateNumber);
  const mods: InvoiceModifications = {
    invoiceNumber: nextNumber,
    issueDate,
    deliveryDate,
    paymentDate,
    lines: [
      {
        lineNumber: 1,
        quantity,
        unitPrice,
        description,
        unitOfMeasureOwn,
        vatRate,
      },
    ],
  };
  if (customerOverride) {
    mods.customer = {
      name: customerOverride.name,
      vatStatus: customerOverride.vatStatus,
      taxNumber: customerOverride.taxNumber,
      address: customerOverride.address,
    };
  }

  provider.buildInvoice(templateData, mods);
  console.log(`XML saved locally: ${nextNumber}`);
  console.log(
    "Use 'make nav-lastXml-review make nav-lastXml-send' to submit to NAV.",
  );

  rl.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
