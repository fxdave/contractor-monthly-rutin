// Domain types
export type {
  TaxNumber,
  SimpleAddress,
  InvoiceLine,
  InvoiceReference,
  InvoiceData,
  InvoiceSummary,
  InvoiceModifications,
  CreateInvoiceResult,
} from "./InvoicingProvider.js";
export { lineAmounts, computeSummary } from "./InvoicingProvider.js";

// Config types
export type { NavConfig, SupplierExtras } from "./providers/nav/config.js";

// Service classes
export { NavInvoicingProvider } from "./providers/nav/NavInvoicingProvider.js";
export { InvoiceService } from "./InvoiceService.js";
export { InvoiceRepo } from "./providers/nav/repo/InvoiceRepo.js";
