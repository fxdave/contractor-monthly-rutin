import { Builder } from "xml2js";
import { computeSummary, lineAmounts, type InvoiceData, type InvoiceModifications, type InvoiceLine } from "../../../InvoicingProvider.js";

const builder = new Builder({
  xmldec: { version: "1.0", encoding: "UTF-8" },
  renderOpts: { pretty: true, indent: "  ", newline: "\n" },
});

function taxNumberObj(t: { taxpayerId: string; vatCode: string; countyCode: string }) {
  return {
    "base:taxpayerId": t.taxpayerId,
    "base:vatCode": t.vatCode,
    "base:countyCode": t.countyCode,
  };
}

function addressObj(a: { countryCode: string; postalCode: string; city: string; streetAddress: string }) {
  return {
    "base:simpleAddress": {
      "base:countryCode": a.countryCode,
      "base:postalCode": a.postalCode,
      "base:city": a.city,
      "base:additionalAddressDetail": a.streetAddress,
    },
  };
}

function vatRateObj(vatRate: number | null) {
  return vatRate !== null
    ? { vatPercentage: vatRate }
    : { aamFlag: "AAMK" };
}

interface LineObjOptions {
  lineModificationReference?: { lineNumberReference: number; lineOperation: string };
}

function lineObj(l: InvoiceLine, opts?: LineObjOptions) {
  const unit: Record<string, string> = l.unitOfMeasureOwn != null
    ? { unitOfMeasureOwn: l.unitOfMeasureOwn }
    : { unitOfMeasure: l.unitOfMeasure ?? "OWN" };

  const obj: Record<string, unknown> = {
    lineNumber: l.lineNumber,
  };

  if (opts?.lineModificationReference) {
    obj.lineModificationReference = opts.lineModificationReference;
  }

  obj.lineExpressionIndicator = false;
  obj.lineDescription = l.description;
  obj.quantity = l.quantity;
  Object.assign(obj, unit);
  obj.unitPrice = l.unitPrice;
  const amounts = lineAmounts(l);
  obj.lineAmountsNormal = {
    lineNetAmountData: {
      lineNetAmount: amounts.netAmount,
      lineNetAmountHUF: amounts.netAmount,
    },
    lineVatRate: vatRateObj(l.vatRate),
  };

  return obj;
}

function summaryByVatRateObj(r: { vatRate: number | null; netAmount: number; vatAmount: number; grossAmount: number }) {
  return {
    vatRate: vatRateObj(r.vatRate),
    vatRateNetData: {
      vatRateNetAmount: r.netAmount,
      vatRateNetAmountHUF: r.netAmount,
    },
    vatRateVatData: {
      vatRateVatAmount: r.vatAmount,
      vatRateVatAmountHUF: r.vatAmount,
    },
    vatRateGrossData: {
      vatRateGrossAmount: r.grossAmount,
      vatRateGrossAmountHUF: r.grossAmount,
    },
  };
}

function customerInfoObj(customer: InvoiceData["customer"]) {
  const info: Record<string, unknown> = {
    customerVatStatus: customer.vatStatus,
  };

  if (customer.taxNumber) {
    info.customerVatData = {
      customerTaxNumber: taxNumberObj(customer.taxNumber),
    };
  }

  info.customerName = customer.name;
  info.customerAddress = addressObj(customer.address);

  return info;
}

function invoiceDetailObj(data: InvoiceData) {
  const detail: Record<string, unknown> = {
    invoiceCategory: "NORMAL",
    invoiceDeliveryDate: data.deliveryDate,
    currencyCode: data.currencyCode,
  };

  if (data.exchangeRate != null) {
    detail.exchangeRate = data.exchangeRate;
  }

  detail.paymentMethod = data.paymentMethod;

  if (data.paymentDate) {
    detail.paymentDate = data.paymentDate;
  }

  detail.invoiceAppearance = data.invoiceAppearance;

  return detail;
}

interface InvoiceObjOptions {
  invoiceReference?: Record<string, unknown>;
  isStorno?: boolean;
}

function invoiceObj(data: InvoiceData, opts?: InvoiceObjOptions) {
  const invoice: Record<string, unknown> = {};

  if (opts?.invoiceReference) {
    invoice.invoiceReference = opts.invoiceReference;
  }

  invoice.invoiceHead = {
    supplierInfo: {
      supplierTaxNumber: taxNumberObj(data.supplier.taxNumber),
      supplierName: data.supplier.name,
      supplierAddress: addressObj(data.supplier.address),
    },
    customerInfo: customerInfoObj(data.customer),
    invoiceDetail: invoiceDetailObj(data),
  };

  const maxOriginalLine = Math.max(...data.lines.map((l) => l.lineNumber));

  const lines = opts?.isStorno
    ? data.lines.map((l) => ({ ...l, quantity: -l.quantity }))
    : data.lines;

  invoice.invoiceLines = {
    mergedItemIndicator: false,
    line: lines.map((l, i) =>
      lineObj(l, opts?.isStorno ? {
        lineModificationReference: {
          lineNumberReference: maxOriginalLine + i + 1,
          lineOperation: "CREATE",
        },
      } : undefined)
    ),
  };

  const summary = computeSummary(lines);
  invoice.invoiceSummary = {
    summaryNormal: {
      summaryByVatRate: summary.byVatRate.map((r) => summaryByVatRateObj(r)),
      invoiceNetAmount: summary.netAmount,
      invoiceNetAmountHUF: summary.netAmount,
      invoiceVatAmount: summary.vatAmount,
      invoiceVatAmountHUF: summary.vatAmount,
    },
    summaryGrossData: {
      invoiceGrossAmount: summary.grossAmount,
      invoiceGrossAmountHUF: summary.grossAmount,
    },
  };

  return invoice;
}

export function buildNavXml(data: InvoiceData): string {
  const obj = {
    InvoiceData: {
      $: {
        xmlns: "http://schemas.nav.gov.hu/OSA/3.0/data",
        "xmlns:base": "http://schemas.nav.gov.hu/OSA/3.0/base",
      },
      invoiceNumber: data.invoiceNumber,
      invoiceIssueDate: data.issueDate,
      completenessIndicator: false,
      invoiceMain: {
        invoice: invoiceObj(data, {}),
      },
    },
  };

  return builder.buildObject(obj);
}

export function buildStornoXml(
  stornoInvoiceNumber: string,
  stornoIssueDate: string,
  originalData: InvoiceData,
  modificationIndex: number = 1,
): string {
  const obj = {
    InvoiceData: {
      $: {
        xmlns: "http://schemas.nav.gov.hu/OSA/3.0/data",
        "xmlns:base": "http://schemas.nav.gov.hu/OSA/3.0/base",
      },
      invoiceNumber: stornoInvoiceNumber,
      invoiceIssueDate: stornoIssueDate,
      completenessIndicator: false,
      invoiceMain: {
        invoice: invoiceObj(originalData, {
          invoiceReference: {
            originalInvoiceNumber: originalData.invoiceNumber,
            modifyWithoutMaster: false,
            modificationIndex,
          },
          isStorno: true,
        }),
      },
    },
  };

  return builder.buildObject(obj);
}

export function applyModifications(template: InvoiceData, mods: InvoiceModifications): InvoiceData {
  const result: InvoiceData = { ...template };

  if (mods.invoiceNumber != null) result.invoiceNumber = mods.invoiceNumber;
  if (mods.issueDate != null) result.issueDate = mods.issueDate;
  if (mods.deliveryDate != null) result.deliveryDate = mods.deliveryDate;

  if ("paymentDate" in mods) {
    if (mods.paymentDate === null) {
      delete result.paymentDate;
    } else if (mods.paymentDate != null) {
      result.paymentDate = mods.paymentDate;
    }
  }

  if (mods.customer) {
    result.customer = mods.customer;
  }

  if (mods.lines && mods.lines.length > 0) {
    result.lines = template.lines.map((line) => {
      const mod = mods.lines!.find((m) => m.lineNumber === line.lineNumber);
      if (!mod) return line;
      return {
        ...line,
        description: mod.description ?? line.description,
        quantity: mod.quantity ?? line.quantity,
        unitPrice: mod.unitPrice ?? line.unitPrice,
        unitOfMeasure: mod.unitOfMeasure ?? line.unitOfMeasure,
        unitOfMeasureOwn: mod.unitOfMeasureOwn ?? line.unitOfMeasureOwn,
        vatRate: mod.vatRate ?? line.vatRate,
      };
    });
  }

  return result;
}
