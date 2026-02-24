import { parseStringPromise } from "xml2js";
import type { InvoiceData, TaxNumber, SimpleAddress, InvoiceLine, InvoiceReference } from "../../../InvoicingProvider.js";

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function parseTaxNumber(t: Record<string, string>): TaxNumber {
  return {
    taxpayerId: String(t.taxpayerId),
    vatCode: String(t.vatCode),
    countyCode: String(t.countyCode),
  };
}

function parseSimpleAddress(a: Record<string, string>): SimpleAddress {
  return {
    countryCode: String(a.countryCode ?? ""),
    postalCode: String(a.postalCode ?? ""),
    city: String(a.city ?? ""),
    streetAddress: String(a.additionalAddressDetail ?? ""),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseLine(l: any): InvoiceLine {
  const vatPercentage = l.lineAmountsNormal?.lineVatRate?.vatPercentage;
  const vatRate = vatPercentage != null ? parseFloat(vatPercentage) : null;

  return {
    lineNumber: parseInt(String(l.lineNumber), 10),
    description: String(l.lineDescription ?? ""),
    quantity: parseFloat(String(l.quantity ?? "0")),
    unitOfMeasure: l.unitOfMeasure ? String(l.unitOfMeasure) : undefined,
    unitOfMeasureOwn: l.unitOfMeasureOwn ? String(l.unitOfMeasureOwn) : undefined,
    unitPrice: parseFloat(String(l.unitPrice ?? "0")),
    vatRate,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseInvoiceReference(ref: any): InvoiceReference | undefined {
  if (!ref) return undefined;
  return {
    originalInvoiceNumber: String(ref.originalInvoiceNumber),
    modifyWithoutMaster: ref.modifyWithoutMaster === "true",
    modificationIndex: parseInt(String(ref.modificationIndex ?? "1"), 10),
  };
}

export async function parseNavXml(xml: string): Promise<InvoiceData> {
  const parsed = await parseStringPromise(xml, {
    tagNameProcessors: [(n: string) => n.replace(/^[^:]+:/, "")],
    explicitArray: false,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const root: any = parsed.InvoiceData;
  const inv = root.invoiceMain.invoice;
  const head = inv.invoiceHead;
  const sup = head.supplierInfo;
  const cust = head.customerInfo;
  const detail = head.invoiceDetail;
  const lines = ensureArray(inv.invoiceLines?.line);

  return {
    invoiceNumber: String(root.invoiceNumber),
    issueDate: String(root.invoiceIssueDate),
    deliveryDate: String(detail.invoiceDeliveryDate ?? ""),
    paymentDate: detail.paymentDate ? String(detail.paymentDate) : undefined,
    paymentMethod: String(detail.paymentMethod ?? ""),
    currencyCode: String(detail.currencyCode ?? "HUF"),
    exchangeRate: detail.exchangeRate != null ? parseFloat(detail.exchangeRate) : undefined,
    invoiceAppearance: String(detail.invoiceAppearance ?? ""),
    invoiceReference: parseInvoiceReference(inv.invoiceReference),
    supplier: {
      name: String(sup.supplierName),
      taxNumber: parseTaxNumber(sup.supplierTaxNumber),
      address: parseSimpleAddress(sup.supplierAddress?.simpleAddress ?? {}),
    },
    customer: {
      name: String(cust.customerName),
      vatStatus: String(cust.customerVatStatus ?? cust.customerVatData?.customerVatStatus ?? ""),
      taxNumber: cust.customerVatData?.customerTaxNumber
        ? parseTaxNumber(cust.customerVatData.customerTaxNumber)
        : undefined,
      address: parseSimpleAddress(cust.customerAddress?.simpleAddress ?? {}),
    },
    lines: lines.map(parseLine),
  };
}
