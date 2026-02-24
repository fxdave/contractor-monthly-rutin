import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, copyFileSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import type { NavConfig, SupplierExtras } from "nav";
import type { ClockifyConfig } from "clockify";
import type { OtpConfig } from "otp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "../../..");

config({ path: join(ROOT_DIR, ".env") });

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} is required in .env`);
  return val;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function loadNavConfig(): NavConfig {
  const taxNumber = requireEnv("NAV_TAX_NUMBER");
  const softwareId = optionalEnv("NAV_SOFTWARE_ID") ?? `HU${taxNumber}-INV-001`;

  return {
    taxNumber,
    technicalUserName: requireEnv("NAV_TECHNICAL_USER_NAME"),
    technicalUserPass: requireEnv("NAV_TECHNICAL_USER_PASS"),
    signKey: requireEnv("NAV_XML_SIGNING_KEY"),
    exchangeKey: requireEnv("NAV_XML_EXCHANGE_KEY"),
    baseUrl: optionalEnv("NAV_MODE") === "production"
      ? "https://api.onlineszamla.nav.gov.hu/invoiceService/v3"
      : "https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3",
    software: {
      softwareId,
      softwareName: optionalEnv("NAV_SOFTWARE_NAME") ?? "Invoice Manager",
      softwareOperation: "LOCAL_SOFTWARE",
      softwareMainVersion: optionalEnv("NAV_SOFTWARE_VERSION") ?? "1.0",
      softwareDevName: requireEnv("NAV_DEV_NAME"),
      softwareDevContact: requireEnv("NAV_DEV_CONTACT"),
      softwareCountryCode: optionalEnv("NAV_DEV_COUNTRY") ?? "HU",
      softwareTaxNumber: requireEnv("NAV_DEV_TAX_NUM"),
    },
    supplierExtras: {
      euVatNumber: optionalEnv("NAV_SUPPLIER_EU_VAT"),
      bankAccountNumber: optionalEnv("NAV_SUPPLIER_BANK_ACCOUNT"),
      iban: optionalEnv("NAV_SUPPLIER_IBAN"),
      bankName: optionalEnv("NAV_SUPPLIER_BANK_NAME"),
      swift: optionalEnv("NAV_SUPPLIER_SWIFT"),
    },
  };
}

export function loadClockifyConfig(): ClockifyConfig {
  const clockifyFile = join(CONFIG_DIR, "clockify.json");
  if (!existsSync(clockifyFile)) {
    writeFileSync(clockifyFile, JSON.stringify({
      defaultRate: 0,
      rateOverrides: [],
    }, null, 2) + "\n", "utf8");
  }
  const rates = JSON.parse(readFileSync(clockifyFile, "utf8"));
  return {
    apiKey: requireEnv("CLOCKIFY_API_KEY"),
    defaultRate: rates.defaultRate,
    rateOverrides: rates.rateOverrides,
  };
}

export function loadOtpConfig(): OtpConfig {
  return {
    downloadDir: optionalEnv("OTP_DOWNLOAD_DIR") ?? join(ROOT_DIR, "downloads"),
  };
}

const DATA_DIR = join(ROOT_DIR, "data");
export const CONFIG_DIR = join(DATA_DIR, "config");
export const TEMPLATES_DIR = join(CONFIG_DIR, "templates");

const DB_DIR = join(DATA_DIR, "db");
export const INVOICES_DIR = join(DB_DIR, "invoices");
export const COUNTER_FILE = join(DB_DIR, "requestId-counter.json");

// Seed data/ directory on first run
mkdirSync(CONFIG_DIR, { recursive: true });
mkdirSync(TEMPLATES_DIR, { recursive: true });
mkdirSync(INVOICES_DIR, { recursive: true });

const PRODUCTS_FILE = join(CONFIG_DIR, "products.json");
if (!existsSync(PRODUCTS_FILE)) {
  writeFileSync(PRODUCTS_FILE, JSON.stringify([
    {
      id: "dev-hours",
      description: "Software development",
      unitPrice: 0,
      vatRate: 0.27,
      unitOfMeasure: "OWN",
      unitOfMeasureOwn: "hour",
    },
  ], null, 2) + "\n", "utf8");
}

const PARTNERS_FILE = join(CONFIG_DIR, "partners.json");
if (!existsSync(PARTNERS_FILE)) {
  writeFileSync(PARTNERS_FILE, JSON.stringify([], null, 2) + "\n", "utf8");
}

// Auto-migrate old counter file location
const OLD_COUNTER_FILE = join(ROOT_DIR, "requestId-counter.json");
if (existsSync(OLD_COUNTER_FILE) && !existsSync(COUNTER_FILE)) {
  copyFileSync(OLD_COUNTER_FILE, COUNTER_FILE);
}
