import { createInterface } from "node:readline";
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  NavInvoicingProvider,
  InvoiceService,
  InvoiceRepo,
  computeSummary,
  type InvoiceData,
  type InvoiceModifications,
} from "nav";
import { ClockifyService } from "clockify";
import { OtpService } from "otp";
import {
  loadNavConfig,
  loadClockifyConfig,
  loadOtpConfig,
  INVOICES_DIR,
  COUNTER_FILE,
  CONFIG_DIR,
  TEMPLATES_DIR,
} from "./config.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("SIGINT", () => process.exit(130));

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer.trim())));
}

async function askDefault(prompt: string, defaultValue: string): Promise<string> {
  const answer = await ask(`${prompt} [${defaultValue}]: `);
  return answer || defaultValue;
}

async function choose<T extends string>(message: string, options: { label: string; value: T }[]): Promise<T> {
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

async function askConfirm(message: string): Promise<boolean> {
  const answer = await ask(`${message} (y/N): `);
  return answer.toLowerCase() === "y";
}

function listLocalInvoices(): string[] {
  if (!existsSync(INVOICES_DIR)) return [];
  return readdirSync(INVOICES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{6}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
}

async function pickInvoice(message: string): Promise<string> {
  const invoices = listLocalInvoices();
  if (invoices.length === 0) {
    return await ask(`${message} (no local invoices found): `);
  }
  return await choose(message, invoices.map((n) => ({ label: n, value: n })));
}

interface Partner {
  id: string;
  name: string;
  vatStatus: string;
  taxNumber?: { taxpayerId: string; vatCode: string; countyCode: string };
  address: { countryCode: string; postalCode: string; city: string; streetAddress: string };
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

function loadPartners(): Partner[] {
  const path = join(CONFIG_DIR, "partners.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadProducts(): Product[] {
  const path = join(CONFIG_DIR, "products.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

function createNavService(): { provider: NavInvoicingProvider; service: InvoiceService } {
  const navConfig = loadNavConfig();
  const invoiceRepo = new InvoiceRepo(INVOICES_DIR);
  const provider = new NavInvoicingProvider(navConfig, COUNTER_FILE, invoiceRepo);
  const service = new InvoiceService(provider);
  return { provider, service };
}

function formatHMS(decimalHours: number): string {
  const totalSeconds = Math.floor(decimalHours * 3600);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function handleCreateInvoice() {
  const { provider, service } = createNavService();
  const products = loadProducts();
  const partners = loadPartners();

  console.log("Syncing with NAV...");
  const sync = await service.sync();
  if (sync.saved.length > 0) console.log(`  Downloaded: ${sync.saved.join(", ")}`);
  console.log(`  Local invoices up to date (${sync.saved.length + sync.skipped.length} recent).\n`);

  let unitPrice: number;
  let vatRate: number;
  let description: string;
  let paymentDays = 30;
  let unitOfMeasureOwn: string | undefined;

  if (products.length > 0) {
    const productOptions = [
      ...products.map((p) => ({
        label: `${p.description} (${p.unitPrice.toLocaleString("hu-HU")} HUF/${p.unitOfMeasureOwn ?? "pc"})`,
        value: p.id,
      })),
      { label: "Custom...", value: "__custom" as string },
    ];

    const productId = await choose("Product:", productOptions);

    if (productId === "__custom") {
      description = await ask("Description: ");
      unitPrice = parseFloat(await ask("Net unit price (HUF): "));
      vatRate = parseFloat(await ask("VAT rate (e.g. 0.27): "));
      unitOfMeasureOwn = await askDefault("Unit of measure", "hour");
    } else {
      const product = products.find((p) => p.id === productId)!;
      unitPrice = product.unitPrice;
      vatRate = product.vatRate;
      description = product.description;
      unitOfMeasureOwn = product.unitOfMeasureOwn;
      if (product.paymentDays != null) paymentDays = product.paymentDays;
    }
  } else {
    description = await ask("Description: ");
    unitPrice = parseFloat(await ask("Net unit price (HUF): "));
    vatRate = parseFloat(await ask("VAT rate (e.g. 0.27): "));
    unitOfMeasureOwn = await askDefault("Unit of measure", "hour");
  }

  let customerOverride: InvoiceData["customer"] | undefined;
  if (partners.length > 0) {
    const partnerOptions = [
      { label: "From template (no change)", value: "__template" as string },
      ...partners.map((p) => ({ label: p.name, value: p.id })),
    ];

    const partnerId = await choose("Partner:", partnerOptions);

    if (partnerId !== "__template") {
      const partner = partners.find((p) => p.id === partnerId)!;
      customerOverride = {
        name: partner.name,
        vatStatus: partner.vatStatus,
        taxNumber: partner.taxNumber,
        address: partner.address,
      };
    }
  }

  const quantityStr = await ask("Quantity: ");
  const quantity = parseFloat(quantityStr);
  if (isNaN(quantity) || quantity <= 0) {
    console.error("Invalid quantity.");
    return;
  }

  const { templateNumber, nextNumber } = await service.getNextInvoiceNumber();
  const { netAmount, vatAmount, grossAmount, issueDate, deliveryDate, paymentDate } =
    service.calculateInvoice(quantity, unitPrice, vatRate, paymentDays);

  console.log();
  console.log(`Template:      ${templateNumber}`);
  console.log(`Invoice:       ${nextNumber}`);
  console.log(`Issue date:    ${issueDate}`);
  console.log(`Delivery date: ${deliveryDate}`);
  console.log(`Payment due:   ${paymentDate}`);
  console.log(`Quantity:      ${quantity} ${unitOfMeasureOwn ?? "pc"}`);
  console.log(`Unit price:    ${unitPrice.toLocaleString("hu-HU")} HUF`);
  console.log(`Net:           ${netAmount.toLocaleString("hu-HU")} HUF`);
  console.log(`VAT (${Math.round(vatRate * 100)}%):      ${vatAmount.toLocaleString("hu-HU")} HUF`);
  console.log(`Gross:         ${grossAmount.toLocaleString("hu-HU")} HUF`);
  console.log();

  const ok = await askConfirm("Submit to NAV?");
  if (!ok) {
    console.log("Cancelled.");
    return;
  }

  const templateData = await provider.getInvoiceData(templateNumber);
  const mods: InvoiceModifications = {
    invoiceNumber: nextNumber,
    issueDate,
    deliveryDate,
    paymentDate,
    lines: [{
      lineNumber: 1,
      quantity,
      unitPrice,
      description,
      unitOfMeasureOwn,
      vatRate,
    }],
  };
  if (customerOverride) mods.customer = customerOverride;

  const result = await provider.createInvoice(templateData, mods);
  console.log(`Success! Transaction ID: ${result.transactionId}`);
}

async function handleStorno() {
  const { service } = createNavService();

  console.log("Syncing with NAV...");
  const sync = await service.sync();
  if (sync.saved.length > 0) console.log(`  Downloaded: ${sync.saved.join(", ")}`);

  const invoiceNumber = await pickInvoice("Select invoice to storno:");
  const invoiceRepo = new InvoiceRepo(INVOICES_DIR);
  const provider = new NavInvoicingProvider(loadNavConfig(), COUNTER_FILE, invoiceRepo);
  const data = await provider.getInvoiceData(invoiceNumber);

  console.log(`\nOriginal: ${data.invoiceNumber}`);
  console.log(`Issued:   ${data.issueDate}`);
  console.log(`Gross:    ${computeSummary(data.lines).grossAmount.toLocaleString("hu-HU")} HUF\n`);

  const ok = await askConfirm(`Storno: ${invoiceNumber}?`);
  if (!ok) {
    console.log("Cancelled.");
    return;
  }

  const result = await service.stornoInvoice(invoiceNumber);
  console.log(`Success! Transaction ID: ${result.transactionId}`);
}

async function handleDownload() {
  const { service } = createNavService();

  const fromStr = await askDefault("From year", "2019");
  const toStr = await ask("To year (empty = current): ");

  const fromYear = parseInt(fromStr, 10);
  const toYear = toStr ? parseInt(toStr, 10) : undefined;

  console.log("Downloading...");
  const { saved, skipped, failed } = await service.downloadAllInvoices(fromYear, toYear);
  console.log(`\nDone. Saved: ${saved}, Skipped: ${skipped}, Failed: ${failed}`);
}

async function handleRender() {
  const { service } = createNavService();

  const invoiceNumber = await pickInvoice("Select invoice to render:");

  const { htmlPath } = await service.renderInvoice(invoiceNumber);
  console.log(`HTML: ${htmlPath}`);

  const { pdfPath, error } = service.renderPdf(invoiceNumber);
  if (error) {
    console.error(error);
  } else {
    console.log(`PDF: ${pdfPath}`);
  }
}

async function handleGenerateTemplate() {
  const { provider } = createNavService();
  const templatePath = join(TEMPLATES_DIR, "default.json");
  console.log("Generating template from latest invoice...");
  await provider.generateTemplate(templatePath);
  console.log(`Saved: ${templatePath}`);
}

async function handleClockify() {
  let config;
  try {
    config = loadClockifyConfig();
  } catch {
    console.error("Clockify config missing (.env: CLOCKIFY_API_KEY + data/config/clockify.json)");
    return;
  }

  const clockify = new ClockifyService(config);

  const now = new Date();
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const defaultMonth = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;

  const month = await askDefault("Month (YYYY-MM)", defaultMonth);

  console.log(`\nFetching hours: ${month}...`);
  const report = await clockify.getMonthlyHours(month);

  console.log("\n=== Hours by project ===");
  for (const { projectName, hours } of report.hours) {
    console.log(`${projectName}: ${hours.toFixed(2)} hours (${formatHMS(hours)})`);
  }

  const summary = clockify.getBillingSummary(report, month);

  console.log("\n=== Billing summary ===");
  for (const cat of summary.categories) {
    console.log(`${cat.name}: ${cat.hours.toFixed(2)}h @ ${cat.rate} HUF/h = ${cat.price.toFixed(0)} HUF`);
  }
  console.log(`\nTotal: ${summary.totalPrice.toFixed(0)} HUF (${summary.totalHours.toFixed(1)}h)`);
  console.log(`\nReport: ${summary.reportUrl}`);
}

async function handleSetupClockify() {
  const configPath = join(CONFIG_DIR, "clockify.json");
  let current: { defaultRate: number; rateOverrides: Array<{ keywords: string[]; rate: number }> };
  if (existsSync(configPath)) {
    current = JSON.parse(readFileSync(configPath, "utf8"));
  } else {
    current = { defaultRate: 0, rateOverrides: [] };
  }

  console.log("\n=== Current Clockify config ===");
  console.log(`Default rate: ${current.defaultRate} HUF/h`);
  if (current.rateOverrides.length > 0) {
    console.log("Rate overrides:");
    for (const o of current.rateOverrides) {
      console.log(`  ${o.keywords.join(", ")} -> ${o.rate} HUF/h`);
    }
  } else {
    console.log("Rate overrides: none");
  }

  const newDefault = await askDefault("Default rate (HUF/h)", String(current.defaultRate));
  current.defaultRate = parseFloat(newDefault);

  const editOverrides = await askConfirm("Edit rate overrides?");
  if (editOverrides) {
    current.rateOverrides = [];
    console.log("Enter rate overrides (empty keywords to stop):");
    while (true) {
      const keywords = await ask("  Keywords (comma-separated, empty to finish): ");
      if (!keywords) break;
      const rate = parseFloat(await ask("  Rate (HUF/h): "));
      if (isNaN(rate)) {
        console.log("  Invalid rate, skipping.");
        continue;
      }
      current.rateOverrides.push({
        keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
        rate,
      });
    }
  }

  writeFileSync(configPath, JSON.stringify(current, null, 2) + "\n", "utf8");
  console.log(`Saved: ${configPath}`);
}

async function handleOtp() {
  let config;
  try {
    config = loadOtpConfig();
  } catch {
    console.error("OTP config missing.");
    return;
  }

  const otp = new OtpService(config);
  const defaultMonth = OtpService.getLastMonthString();
  const month = await askDefault("Month (YYYY-MM)", defaultMonth);

  console.log(`\nDownloading: ${month}...`);
  const filePath = await otp.downloadStatement(month);
  console.log(`Saved: ${filePath}`);
}

async function main() {
  console.log("Invoice Manager");
  console.log("═══════════════\n");

  const action = await choose("Action:", [
    { label: "Create invoice", value: "create" },
    { label: "Storno invoice", value: "storno" },
    { label: "Render invoice", value: "render" },
    { label: "Download invoices from NAV", value: "download" },
    { label: "Generate default template", value: "template" },
    { label: "Clockify hours", value: "clockify" },
    { label: "Setup Clockify", value: "setup-clockify" },
    { label: "OTP statement", value: "otp" },
  ]);

  switch (action) {
    case "create": await handleCreateInvoice(); break;
    case "storno": await handleStorno(); break;
    case "render": await handleRender(); break;
    case "download": await handleDownload(); break;
    case "template": await handleGenerateTemplate(); break;
    case "clockify": await handleClockify(); break;
    case "setup-clockify": await handleSetupClockify(); break;
    case "otp": await handleOtp(); break;
  }

  rl.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
