export interface SupplierExtras {
  euVatNumber?: string;
  bankAccountNumber?: string;
  iban?: string;
  bankName?: string;
  swift?: string;
}

export interface NavConfig {
  taxNumber: string;
  technicalUserName: string;
  technicalUserPass: string;
  signKey: string;
  exchangeKey: string;
  baseUrl: string;
  software: {
    softwareId: string;
    softwareName: string;
    softwareOperation: "LOCAL_SOFTWARE" | "ONLINE_SERVICE";
    softwareMainVersion: string;
    softwareDevName: string;
    softwareDevContact: string;
    softwareCountryCode: string;
    softwareTaxNumber: string;
  };
  supplierExtras: SupplierExtras;
}
