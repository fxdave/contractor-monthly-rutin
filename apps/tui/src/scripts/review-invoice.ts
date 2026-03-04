import { NavInvoicingProvider, InvoiceRepo, computeSummary, lineAmounts } from "nav";
import type { InvoiceData, TaxNumber, SimpleAddress, SupplierExtras } from "nav";
import { loadNavConfig, INVOICES_DIR, COUNTER_FILE } from "../config.js";

function huf(n: number): string {
  return n.toLocaleString("hu-HU") + " HUF";
}

function formatTaxNumber(t: TaxNumber): string {
  return `${t.taxpayerId}-${t.vatCode}-${t.countyCode}`;
}

function formatAddress(a: SimpleAddress): string {
  return `${a.postalCode} ${a.city}, ${a.streetAddress} (${a.countryCode})`;
}

function vatLabel(rate: number | null): string {
  return rate !== null ? Math.round(rate * 100) + "%" : "N/A";
}

function section(title: string) {
  console.log();
  console.log(`── ${title} ${"─".repeat(Math.max(0, 50 - title.length))}`);
}

function field(label: string, value: string | undefined | null) {
  if (value === undefined || value === null) return;
  console.log(`  ${label.padEnd(20)} ${value}`);
}

function printReview(data: InvoiceData, extras: SupplierExtras) {
  const summary = computeSummary(data.lines);
  const isStorno = !!data.invoiceReference;

  // Header
  section(isStorno ? "SZTORNÓ SZÁMLA" : "SZÁMLA");
  field("Invoice number", data.invoiceNumber);
  if (data.invoiceReference) {
    field("Storno of", data.invoiceReference.originalInvoiceNumber);
    field("Modification index", String(data.invoiceReference.modificationIndex));
  }

  // Dates
  section("Dates");
  field("Issue date", data.issueDate);
  field("Delivery date", data.deliveryDate);
  field("Payment due", data.paymentDate ?? "N/A");

  // Payment & currency
  section("Payment");
  field("Payment method", data.paymentMethod);
  field("Currency", data.currencyCode);
  if (data.exchangeRate !== undefined) {
    field("Exchange rate", String(data.exchangeRate));
  }
  field("Appearance", data.invoiceAppearance);

  // Supplier
  section("Supplier");
  field("Name", data.supplier.name);
  field("Tax number", formatTaxNumber(data.supplier.taxNumber));
  if (data.supplier.euVatNumber) {
    field("EU VAT number", data.supplier.euVatNumber);
  }
  field("Address", formatAddress(data.supplier.address));

  // Customer
  section("Customer");
  field("Name", data.customer.name);
  field("VAT status", data.customer.vatStatus);
  if (data.customer.taxNumber) {
    field("Tax number", formatTaxNumber(data.customer.taxNumber));
  }
  field("Address", formatAddress(data.customer.address));

  // Lines
  section("Lines");
  for (const line of data.lines) {
    const amounts = lineAmounts(line);
    const unit = line.unitOfMeasure ?? line.unitOfMeasureOwn ?? "pc";
    console.log();
    console.log(`  ${line.lineNumber}. ${line.description}`);
    console.log(`     ${line.quantity} ${unit} × ${line.unitPrice.toLocaleString("hu-HU")} HUF`);
    console.log(`     VAT ${vatLabel(line.vatRate)}  │  Net: ${huf(amounts.netAmount)}  │  VAT: ${huf(amounts.vatAmount)}  │  Gross: ${huf(amounts.grossAmount)}`);
  }

  // VAT summary breakdown
  if (summary.byVatRate.length > 1) {
    section("VAT breakdown");
    for (const entry of summary.byVatRate) {
      console.log(`  VAT ${vatLabel(entry.vatRate).padEnd(5)}  Net: ${huf(entry.netAmount).padStart(14)}  VAT: ${huf(entry.vatAmount).padStart(14)}  Gross: ${huf(entry.grossAmount).padStart(14)}`);
    }
  }

  // Totals
  section("Totals");
  field("Net", huf(summary.netAmount));
  field("VAT", huf(summary.vatAmount));
  field("Gross", huf(summary.grossAmount));

  // PDF-only fields (from config, not in XML)
  const hasExtras = extras.bankAccountNumber || extras.iban || extras.bankName || extras.swift || extras.euVatNumber;
  if (hasExtras) {
    section("PDF-only (from config)");
    field("Bank account", extras.bankAccountNumber);
    field("IBAN", extras.iban);
    field("Bank name", extras.bankName);
    field("SWIFT/BIC", extras.swift);
    field("EU VAT number", extras.euVatNumber);
  }

  console.log();
}

async function main() {
  const navConfig = loadNavConfig();
  const invoiceRepo = new InvoiceRepo(INVOICES_DIR);
  const provider = new NavInvoicingProvider(navConfig, COUNTER_FILE, invoiceRepo);

  const hasDraft = invoiceRepo.hasInvoice("draft");
  const defaultNumber = hasDraft
    ? "draft"
    : (await provider.getLastInvoiceFile()).number;

  const invoiceNumber = process.argv[2] || defaultNumber;

  const data = await provider.getInvoiceData(invoiceNumber);
  printReview(data, navConfig.supplierExtras);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
