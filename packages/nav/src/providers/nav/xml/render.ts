import { computeSummary, lineAmounts, type InvoiceData } from "../../../InvoicingProvider.js";
import type { SupplierExtras } from "../config.js";

const COUNTRY_NAMES: Record<string, string> = {
  HU: "Magyarország",
};

const PAYMENT_LABELS: Record<string, string> = {
  TRANSFER: "Átutalás",
  CASH: "Készpénz",
  CARD: "Bankkártya",
  OTHER: "Egyéb",
};

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function huf(n: number): string {
  return n.toLocaleString("hu-HU") + " Ft";
}

function fmtTaxNumber(t: { taxpayerId: string; vatCode: string; countyCode: string }): string {
  return `${t.taxpayerId}-${t.vatCode}-${t.countyCode}`;
}

function addrLines(a: { countryCode: string; postalCode: string; city: string; streetAddress: string }): string[] {
  return [
    a.city,
    a.streetAddress,
    a.postalCode,
    COUNTRY_NAMES[a.countryCode] ?? a.countryCode,
  ].filter(Boolean);
}

function fmtDate(d: string): string {
  return esc(d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1. $2. $3."));
}

function buildSummaryRows(summary: ReturnType<typeof computeSummary>): string {
  const rows: string[] = [];

  if (summary.byVatRate.length > 1) {
    for (const r of summary.byVatRate) {
      const label = r.vatRate !== null ? `${Math.round(r.vatRate * 100)}%` : "AAM";
      rows.push(`<tr class="sub"><td>Nettó alap (${label})</td><td class="r">${huf(r.netAmount)}</td></tr>`);
      rows.push(`<tr class="sub"><td>${label} ÁFA</td><td class="r">${huf(r.vatAmount)}</td></tr>`);
    }
    rows.push(`<tr><td>Nettó összeg</td><td class="r">${huf(summary.netAmount)}</td></tr>`);
    rows.push(`<tr><td>ÁFA összeg</td><td class="r">${huf(summary.vatAmount)}</td></tr>`);
  } else {
    const r = summary.byVatRate[0];
    const vatLabel =
      r?.vatRate != null ? `${Math.round(r.vatRate * 100)}% ÁFA` : "ÁFA";
    rows.push(`<tr><td>Nettó összeg</td><td class="r">${huf(summary.netAmount)}</td></tr>`);
    rows.push(`<tr><td>${vatLabel}</td><td class="r">${huf(summary.vatAmount)}</td></tr>`);
  }

  rows.push(
    `<tr class="gross"><td>Fizetendő bruttó végösszeg</td><td class="r">${huf(summary.grossAmount)}</td></tr>`
  );
  return rows.join("\n");
}

export function renderInvoiceHtml(data: InvoiceData, extras: SupplierExtras): string {
  const isStorno = !!data.invoiceReference;
  const title = isStorno ? "Sztornó számla" : "Számla";

  // For storno display: show negative unit prices with positive quantities
  const displayLines = isStorno
    ? data.lines.map((l) => ({
        ...l,
        quantity: Math.abs(l.quantity),
        unitPrice: -Math.abs(l.unitPrice),
      }))
    : data.lines;

  const supplierAddr = addrLines(data.supplier.address).map(esc).join("<br>");
  const customerAddr = addrLines(data.customer.address).map(esc).join("<br>");

  const lineRows = displayLines
    .map((l) => {
      const unit = l.unitOfMeasureOwn ?? l.unitOfMeasure ?? "";
      const vatLabel = l.vatRate !== null ? `${Math.round(l.vatRate * 100)}%` : "AAM";
      const amounts = lineAmounts(l);
      return `
      <tr>
        <td class="c num">${l.lineNumber}</td>
        <td>${esc(l.description)}</td>
        <td class="r">${l.quantity.toLocaleString("hu-HU")} ${esc(unit)}</td>
        <td class="r">${huf(l.unitPrice)}</td>
        <td class="r">${huf(amounts.netAmount)}</td>
        <td class="c">${esc(vatLabel)}</td>
        <td class="r">${huf(amounts.grossAmount)}</td>
      </tr>`;
    })
    .join("\n");

  const summary = computeSummary(displayLines);
  const summaryRows = buildSummaryRows(summary);

  const supplierTax = fmtTaxNumber(data.supplier.taxNumber);
  const customerTax = data.customer.taxNumber ? fmtTaxNumber(data.customer.taxNumber) : null;

  const euVatLine = extras.euVatNumber
    ? `<span class="meta-label">Közösségi adószám:</span> ${esc(extras.euVatNumber)}<br>`
    : "";
  const bankLine = extras.bankAccountNumber
    ? `<span class="meta-label">Bankszámlaszám:</span> ${esc(extras.bankAccountNumber)}<br>`
    : "";
  const ibanLine = extras.iban
    ? `<span class="meta-label">IBAN:</span> ${esc(extras.iban)}<br>`
    : "";
  const bankNameLine = extras.bankName
    ? `<span class="meta-label">Bank neve:</span> ${esc(extras.bankName)}<br>`
    : "";
  const swiftLine = extras.swift
    ? `<span class="meta-label">SWIFT/BIC:</span> ${esc(extras.swift)}`
    : "";

  const paymentDateHtml = data.paymentDate
    ? `<div class="date-item">
        <div class="date-label">Fizetési határidő</div>
        <div class="date-value">${fmtDate(data.paymentDate)}</div>
      </div>`
    : "";

  const referenceNote = isStorno
    ? `<p class="reference-note">MEGJEGYZÉS: Hivatkozási számlaszám: ${esc(data.invoiceReference!.originalInvoiceNumber)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="UTF-8">
<title>${esc(title)} – ${esc(data.invoiceNumber)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: A4 portrait; margin: 14mm 18mm; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #1a1a1a; background: #fff; }

h1.title { font-size: 26pt; font-weight: 300; margin-bottom: 0; }
.invoice-id { font-size: 14pt; color: #555; margin-bottom: 7mm; }

hr.rule-thick { border: none; border-top: 1.5px solid #1a1a1a; margin-bottom: 6mm; }
hr.rule-thin  { border: none; border-top: 1px solid #ddd; margin: 5mm 0; }

table.parties { width: 100%; border-collapse: collapse; margin-bottom: 0; }
table.parties td { width: 50%; vertical-align: top; padding-bottom: 5mm; }
table.parties td:last-child { padding-left: 8mm; }
.party-label { font-size: 7pt; text-transform: uppercase; letter-spacing: 2px; color: #999; margin-bottom: 2mm; }
.party-name  { font-size: 13pt; font-weight: bold; margin-bottom: 1.5mm; }
.party-info  { font-size: 9pt; color: #444; line-height: 1.7; }
.party-info .meta-label {
  font-size: 6.5pt; text-transform: uppercase; letter-spacing: 1px;
  color: #999; font-weight: bold;
}

table.dates-row { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
table.dates-row td { vertical-align: top; font-size: 8.5pt; }
table.dates-row td:last-child { text-align: right; }
.date-item { margin-bottom: 1mm; }
.date-label { font-size: 7pt; text-transform: uppercase; letter-spacing: 1px; color: #999; }
.date-value { font-weight: bold; }

.gross-hero { text-align: right; margin-bottom: 5mm; }
.gross-hero-label { font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; color: #999; }
.gross-hero-amount { font-size: 22pt; font-weight: bold; }

table.lines { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
table.lines thead tr { background: #f5f5f5; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; }
table.lines thead th {
  padding: 2mm 3mm; font-size: 8pt; font-weight: bold; text-transform: uppercase;
  letter-spacing: 0.5px; text-align: left; white-space: nowrap; color: #555;
}
table.lines tbody td {
  padding: 2.5mm 3mm; border-bottom: 1px solid #f0f0f0;
  font-size: 9.5pt; vertical-align: middle;
}
table.lines tbody tr:last-child td { border-bottom: none; }
.r { text-align: right; }
.c { text-align: center; }
.num { color: #999; font-size: 9pt; }

.summary-outer { width: 100%; border-collapse: collapse; margin-bottom: 7mm; }
.summary-spacer { width: 52%; }
table.summary { width: 100%; border-collapse: collapse; }
table.summary td { padding: 1.5mm 3mm; font-size: 10pt; }
table.summary td:last-child { text-align: right; min-width: 42mm; }
table.summary tr.sub td { font-size: 9pt; color: #777; }
table.summary tr.gross { border-top: 1.5px solid #1a1a1a; font-weight: bold; font-size: 11pt; }
table.summary tr.gross td { padding-top: 2.5mm; }

.reference-note { margin-top: 7mm; font-size: 9pt; font-weight: bold; color: #333; }
.no-sig { margin-top: 14mm; font-size: 7.5pt; color: #bbb; text-align: center; }
</style>
</head>
<body>

<h1 class="title">${esc(title)}</h1>
<p class="invoice-id">${esc(data.invoiceNumber)}</p>

<hr class="rule-thick">

<table class="parties">
  <tr>
    <td>
      <div class="party-label">Eladó</div>
      <div class="party-name">${esc(data.supplier.name)}</div>
      <div class="party-info">
        ${supplierAddr}<br>
        <br>
        <span class="meta-label">Adószám:</span> ${esc(supplierTax)}<br>
        ${euVatLine}
        ${bankLine}
        ${ibanLine}
        ${bankNameLine}
        ${swiftLine}
      </div>
    </td>
    <td>
      <div class="party-label">Vevő</div>
      <div class="party-name">${esc(data.customer.name)}</div>
      <div class="party-info">
        ${customerAddr}<br>
        ${customerTax ? `<br><span class="meta-label">Adószám:</span> ${esc(customerTax)}` : ""}
      </div>
    </td>
  </tr>
</table>

<hr class="rule-thin">

<table class="dates-row">
  <tr>
    <td>
      <div class="date-item">
        <div class="date-label">Számla kelte</div>
        <div class="date-value">${fmtDate(data.issueDate)}</div>
      </div>
      <div class="date-item">
        <div class="date-label">Teljesítés kelte</div>
        <div class="date-value">${fmtDate(data.deliveryDate)}</div>
      </div>
    </td>
    <td>
      ${paymentDateHtml}
      <div class="date-item">
        <div class="date-label">Fizetési mód</div>
        <div class="date-value">${esc(PAYMENT_LABELS[data.paymentMethod] ?? data.paymentMethod)}</div>
      </div>
    </td>
  </tr>
</table>

<div class="gross-hero">
  <div class="gross-hero-label">Fizetendő bruttó végösszeg:</div>
  <div class="gross-hero-amount">${huf(summary.grossAmount)}</div>
</div>

<table class="lines">
  <thead>
    <tr>
      <th class="c" style="width:4%">#</th>
      <th style="width:34%">Megnevezés</th>
      <th class="r" style="width:12%">Mennyiség</th>
      <th class="r" style="width:13%">Nettó egységár</th>
      <th class="r" style="width:13%">Nettó ár</th>
      <th class="c" style="width:6%">ÁFA</th>
      <th class="r" style="width:18%">Bruttó ár</th>
    </tr>
  </thead>
  <tbody>
    ${lineRows}
  </tbody>
</table>

<table class="summary-outer">
  <tr>
    <td class="summary-spacer"></td>
    <td>
      <table class="summary">
        ${summaryRows}
      </table>
    </td>
  </tr>
</table>

${referenceNote}

<p class="no-sig">A számla aláírás és bélyegző nélkül is érvényes.</p>

</body>
</html>`;
}
