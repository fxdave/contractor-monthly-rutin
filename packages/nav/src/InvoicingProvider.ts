export interface TaxNumber {
  taxpayerId: string;
  vatCode: string;
  countyCode: string;
}

export interface SimpleAddress {
  countryCode: string;
  postalCode: string;
  city: string;
  streetAddress: string;
}

export interface InvoiceLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unitOfMeasure?: string;
  unitOfMeasureOwn?: string;
  unitPrice: number;
  vatRate: number | null;
}

export function lineAmounts(line: InvoiceLine): { netAmount: number; vatAmount: number; grossAmount: number } {
  const netAmount = Math.round(line.quantity * line.unitPrice);
  const vatAmount = line.vatRate !== null ? Math.round(netAmount * line.vatRate) : 0;
  return { netAmount, vatAmount, grossAmount: netAmount + vatAmount };
}

export interface InvoiceReference {
  originalInvoiceNumber: string;
  modifyWithoutMaster: boolean;
  modificationIndex: number;
}

export interface InvoiceData {
  invoiceNumber: string;
  issueDate: string;
  deliveryDate: string;
  paymentDate?: string;
  paymentMethod: string;
  currencyCode: string;
  exchangeRate?: number;
  invoiceAppearance: string;
  invoiceReference?: InvoiceReference;
  supplier: {
    name: string;
    taxNumber: TaxNumber;
    address: SimpleAddress;
    euVatNumber?: string;
  };
  customer: {
    name: string;
    vatStatus: string;
    taxNumber?: TaxNumber;
    address: SimpleAddress;
  };
  lines: InvoiceLine[];
}

export interface InvoiceSummary {
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  byVatRate: Array<{
    vatRate: number | null;
    netAmount: number;
    vatAmount: number;
    grossAmount: number;
  }>;
}

export function computeSummary(lines: InvoiceLine[]): InvoiceSummary {
  const byVatRateMap = new Map<number | null, { netAmount: number; vatAmount: number; grossAmount: number }>();
  for (const line of lines) {
    const amounts = lineAmounts(line);
    const existing = byVatRateMap.get(line.vatRate) ?? { netAmount: 0, vatAmount: 0, grossAmount: 0 };
    byVatRateMap.set(line.vatRate, {
      netAmount: existing.netAmount + amounts.netAmount,
      vatAmount: existing.vatAmount + amounts.vatAmount,
      grossAmount: existing.grossAmount + amounts.grossAmount,
    });
  }
  const totals = lines.reduce(
    (s, l) => {
      const a = lineAmounts(l);
      return { netAmount: s.netAmount + a.netAmount, vatAmount: s.vatAmount + a.vatAmount, grossAmount: s.grossAmount + a.grossAmount };
    },
    { netAmount: 0, vatAmount: 0, grossAmount: 0 }
  );
  return {
    ...totals,
    byVatRate: Array.from(byVatRateMap.entries()).map(([vatRate, amounts]) => ({
      vatRate,
      ...amounts,
    })),
  };
}

export interface InvoiceModifications {
  invoiceNumber?: string;
  issueDate?: string;
  deliveryDate?: string;
  paymentDate?: string | null;
  customer?: InvoiceData["customer"];
  lines?: Array<{
    lineNumber: number;
    description?: string;
    quantity?: number;
    unitPrice?: number;
    unitOfMeasure?: string;
    unitOfMeasureOwn?: string;
    vatRate?: number;
  }>;
}

export interface CreateInvoiceResult {
  transactionId: string;
  invoiceNumber: string;
}
