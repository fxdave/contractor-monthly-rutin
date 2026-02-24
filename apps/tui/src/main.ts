import { select, input, confirm } from "@inquirer/prompts";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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

  // Select product
  let unitPrice: number;
  let vatRate: number;
  let description: string;
  let paymentDays = 30;
  let unitOfMeasureOwn: string | undefined;

  if (products.length > 0) {
    const productChoices = products.map((p) => ({
      name: `${p.description} (${p.unitPrice.toLocaleString("hu-HU")} HUF/${p.unitOfMeasureOwn ?? "db"})`,
      value: p.id,
    }));
    productChoices.push({ name: "Egyéni...", value: "__custom" });

    const productId = await select({ message: "Termék:", choices: productChoices });

    if (productId === "__custom") {
      description = await input({ message: "Megnevezés:" });
      unitPrice = parseFloat(await input({ message: "Nettó egységár (HUF):" }));
      vatRate = parseFloat(await input({ message: "ÁFA kulcs (pl. 0.27):" }));
      unitOfMeasureOwn = await input({ message: "Mértékegység:", default: "óra" });
    } else {
      const product = products.find((p) => p.id === productId)!;
      unitPrice = product.unitPrice;
      vatRate = product.vatRate;
      description = product.description;
      unitOfMeasureOwn = product.unitOfMeasureOwn;
      if (product.paymentDays != null) paymentDays = product.paymentDays;
    }
  } else {
    description = await input({ message: "Megnevezés:" });
    unitPrice = parseFloat(await input({ message: "Nettó egységár (HUF):" }));
    vatRate = parseFloat(await input({ message: "ÁFA kulcs (pl. 0.27):" }));
    unitOfMeasureOwn = await input({ message: "Mértékegység:", default: "óra" });
  }

  // Select partner (optional)
  let customerOverride: InvoiceData["customer"] | undefined;
  if (partners.length > 0) {
    const partnerChoices = partners.map((p) => ({
      name: p.name,
      value: p.id,
    }));
    partnerChoices.push({ name: "Sablonból (nem változtat)", value: "__template" });

    const partnerId = await select({ message: "Partner:", choices: partnerChoices });

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

  const quantityStr = await input({ message: "Mennyiség:" });
  const quantity = parseFloat(quantityStr);
  if (isNaN(quantity) || quantity <= 0) {
    console.error("Érvénytelen mennyiség.");
    return;
  }

  const { templateNumber, nextNumber } = await service.getNextInvoiceNumber();
  const { netAmount, vatAmount, grossAmount, issueDate, deliveryDate, paymentDate } =
    service.calculateInvoice(quantity, unitPrice, vatRate, paymentDays);

  console.log();
  console.log(`Sablon:        ${templateNumber}`);
  console.log(`Számla:        ${nextNumber}`);
  console.log(`Kelte:         ${issueDate}`);
  console.log(`Teljesítés:    ${deliveryDate}`);
  console.log(`Fiz. határidő: ${paymentDate}`);
  console.log(`Mennyiség:     ${quantity} ${unitOfMeasureOwn ?? "db"}`);
  console.log(`Egységár:      ${unitPrice.toLocaleString("hu-HU")} HUF`);
  console.log(`Nettó:         ${netAmount.toLocaleString("hu-HU")} HUF`);
  console.log(`ÁFA (${Math.round(vatRate * 100)}%):     ${vatAmount.toLocaleString("hu-HU")} HUF`);
  console.log(`Bruttó:        ${grossAmount.toLocaleString("hu-HU")} HUF`);
  console.log();

  const ok = await confirm({ message: "Beküldés a NAV-nak?", default: false });
  if (!ok) {
    console.log("Megszakítva.");
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
  console.log(`Sikeres! Tranzakció ID: ${result.transactionId}`);
}

async function handleStorno() {
  const { provider, service } = createNavService();

  console.log("Syncing with NAV...");
  const sync = await service.sync();
  if (sync.saved.length > 0) console.log(`  Downloaded: ${sync.saved.join(", ")}`);
  console.log();

  const invoiceNumber = await input({ message: "Számlaszám (pl. 2026-000005):" });
  const data = await provider.getInvoiceData(invoiceNumber);

  console.log(`\nEredeti:  ${data.invoiceNumber}`);
  console.log(`Kelte:    ${data.issueDate}`);
  console.log(`Bruttó:   ${computeSummary(data.lines).grossAmount.toLocaleString("hu-HU")} HUF\n`);

  const ok = await confirm({ message: `Sztornó: ${invoiceNumber}?`, default: false });
  if (!ok) {
    console.log("Megszakítva.");
    return;
  }

  const result = await service.stornoInvoice(invoiceNumber);
  console.log(`Sikeres! Tranzakció ID: ${result.transactionId}`);
}

async function handleDownload() {
  const { service } = createNavService();

  const fromStr = await input({ message: "Kezdő év:", default: "2019" });
  const toStr = await input({ message: "Vég év (üres = jelenlegi):", default: "" });

  const fromYear = parseInt(fromStr, 10);
  const toYear = toStr ? parseInt(toStr, 10) : undefined;

  console.log("Letöltés...");
  const { saved, skipped, failed } = await service.downloadAllInvoices(fromYear, toYear);
  console.log(`\nKész. Mentett: ${saved}, Kihagyott: ${skipped}, Hibás: ${failed}`);
}

async function handleRender() {
  const { provider, service } = createNavService();

  const invoiceNumber = await input({ message: "Számlaszám:" });

  const { htmlPath } = await service.renderInvoice(invoiceNumber);
  console.log(`HTML: ${htmlPath}`);

  const { pdfPath, error } = service.renderPdf(invoiceNumber);
  if (error) {
    console.error(error);
  } else {
    console.log(`PDF: ${pdfPath}`);
  }
}

async function handleAdatszolgaltatas() {
  const { service } = createNavService();

  const fromStr = await input({ message: "Kezdő év:", default: "2019" });
  const fromYear = parseInt(fromStr, 10);

  console.log("Teljes letöltés indítása...");
  const { saved, skipped, failed } = await service.downloadAllInvoices(fromYear);
  console.log(`\nAdatszolgáltatás kész. Mentett: ${saved}, Kihagyott: ${skipped}, Hibás: ${failed}`);
}

async function handleTemplates() {
  const { provider } = createNavService();

  const action = await select({
    message: "Sablon művelet:",
    choices: [
      { name: "Sablon generálás (legutóbbi számlából)", value: "generate" },
      { name: "Sablonok listázása", value: "list" },
      { name: "Vissza", value: "back" },
    ],
  });

  if (action === "back") return;

  if (action === "list") {
    if (!existsSync(TEMPLATES_DIR)) {
      console.log("Nincs templates/ mappa.");
      return;
    }
    const files = readdirSync(TEMPLATES_DIR);
    if (files.length === 0) {
      console.log("Nincsenek sablonok.");
    } else {
      files.forEach((f) => console.log(`  ${f}`));
    }
    return;
  }

  if (action === "generate") {
    const templatePath = join(TEMPLATES_DIR, "default.json");
    console.log("Sablon generálás...");
    await provider.generateTemplate(templatePath);
    console.log(`  Mentve: ${templatePath}`);
  }
}

async function handleClockify() {
  let config;
  try {
    config = loadClockifyConfig();
  } catch {
    console.error("Clockify config hiányzik (.env: CLOCKIFY_API_KEY + data/config/clockify.json)");
    return;
  }

  const clockify = new ClockifyService(config);

  const now = new Date();
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const defaultMonth = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;

  const month = await input({ message: "Hónap (YYYY-MM):", default: defaultMonth });

  console.log(`\nÓrák lekérése: ${month}...`);
  const report = await clockify.getMonthlyHours(month);

  console.log("\n=== Órák projektenként ===");
  for (const { projectName, hours } of report.hours) {
    console.log(`${projectName}: ${hours.toFixed(2)} óra (${formatHMS(hours)})`);
  }

  const summary = clockify.getBillingSummary(report, month);

  console.log("\n=== Számlázási összesítő ===");
  for (const cat of summary.categories) {
    console.log(`${cat.name}: ${cat.hours.toFixed(2)}h @ ${cat.rate} HUF/h = ${cat.price.toFixed(0)} HUF`);
  }
  console.log(`\nÖsszesen: ${summary.totalPrice.toFixed(0)} HUF (${summary.totalHours.toFixed(1)}h)`);
  console.log(`\nRiport: ${summary.reportUrl}`);
}

async function handleOtp() {
  let config;
  try {
    config = loadOtpConfig();
  } catch {
    console.error("OTP config hiányzik.");
    return;
  }

  const otp = new OtpService(config);
  const defaultMonth = OtpService.getLastMonthString();
  const month = await input({ message: "Hónap (YYYY-MM):", default: defaultMonth });

  console.log("OTP kivonat letöltéshez szükséges adatok:");
  const azonosito = await input({ message: "Azonosító:" });
  const szamlaszam = await input({ message: "Számlaszám (117 nélkül):" });
  const jelszo = await input({ message: "Jelszó:" });

  console.log(`\nLetöltés: ${month}...`);
  const filePath = await otp.downloadStatement(month, { azonosito, szamlaszam, jelszo });
  console.log(`Mentve: ${filePath}`);
}

async function main() {
  console.log("Számla Kezelő");
  console.log("═════════════\n");

  while (true) {
    const action = await select({
      message: "Művelet:",
      choices: [
        { name: "Számla készítés", value: "create" },
        { name: "Sztornó", value: "storno" },
        { name: "Letöltés", value: "download" },
        { name: "Megjelenítés", value: "render" },
        { name: "Adatszolgáltatás", value: "adatszolgaltatas" },
        { name: "Sablon kezelés", value: "templates" },
        { name: "Clockify órák", value: "clockify" },
        { name: "OTP kivonat", value: "otp" },
        { name: "Kilépés", value: "exit" },
      ],
    });

    if (action === "exit") break;

    try {
      switch (action) {
        case "create": await handleCreateInvoice(); break;
        case "storno": await handleStorno(); break;
        case "download": await handleDownload(); break;
        case "render": await handleRender(); break;
        case "adatszolgaltatas": await handleAdatszolgaltatas(); break;
        case "templates": await handleTemplates(); break;
        case "clockify": await handleClockify(); break;
        case "otp": await handleOtp(); break;
      }
    } catch (err) {
      console.error("Hiba:", err);
    }

    console.log();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
