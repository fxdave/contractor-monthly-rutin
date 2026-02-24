// Types

export interface ManageInvoiceResponse {
  header: {
    requestId: string;
    timestamp: string;
    requestVersion: string;
    headerVersion: string;
  };
  result: {
    funcCode: string;
    errorCode?: string;
    message?: string;
  };
  software: unknown;
  transactionId?: string;
}

// Schema

interface SoftwareInfo {
  softwareId: string;
  softwareName: string;
  softwareOperation: string;
  softwareMainVersion: string;
  softwareDevName: string;
  softwareDevContact: string;
  softwareCountryCode: string;
  softwareTaxNumber: string;
}

export interface InvoiceOperation {
  index: number;
  operation: "CREATE" | "MODIFY" | "STORNO";
  base64Data: string;
}

export function renderXml(params: {
  requestId: string;
  timestamp: string;
  passwordHash: string;
  requestSignature: string;
  taxNumber: string;
  technicalUserName: string;
  software: SoftwareInfo;
  exchangeToken: string;
  invoiceOperations: InvoiceOperation[];
}): string {
  const {
    requestId,
    timestamp,
    passwordHash,
    requestSignature,
    taxNumber,
    technicalUserName,
    software,
    exchangeToken,
    invoiceOperations,
  } = params;

  const operationsXml = invoiceOperations
    .map(
      (op) => `    <invoiceOperation>
      <index>${op.index}</index>
      <invoiceOperation>${op.operation}</invoiceOperation>
      <invoiceData>${op.base64Data}</invoiceData>
    </invoiceOperation>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ManageInvoiceRequest xmlns="http://schemas.nav.gov.hu/OSA/3.0/api"
                      xmlns:common="http://schemas.nav.gov.hu/NTCA/1.0/common">
  <common:header>
    <common:requestId>${requestId}</common:requestId>
    <common:timestamp>${timestamp}</common:timestamp>
    <common:requestVersion>3.0</common:requestVersion>
    <common:headerVersion>1.0</common:headerVersion>
  </common:header>
  <common:user>
    <common:login>${technicalUserName}</common:login>
    <common:passwordHash cryptoType="SHA-512">${passwordHash}</common:passwordHash>
    <common:taxNumber>${taxNumber}</common:taxNumber>
    <common:requestSignature cryptoType="SHA3-512">${requestSignature}</common:requestSignature>
  </common:user>
  <software>
    <softwareId>${software.softwareId}</softwareId>
    <softwareName>${software.softwareName}</softwareName>
    <softwareOperation>${software.softwareOperation}</softwareOperation>
    <softwareMainVersion>${software.softwareMainVersion}</softwareMainVersion>
    <softwareDevName>${software.softwareDevName}</softwareDevName>
    <softwareDevContact>${software.softwareDevContact}</softwareDevContact>
    <softwareDevCountryCode>${software.softwareCountryCode}</softwareDevCountryCode>
    <softwareDevTaxNumber>${software.softwareTaxNumber}</softwareDevTaxNumber>
  </software>
  <exchangeToken>${exchangeToken}</exchangeToken>
  <invoiceOperations>
    <compressedContent>false</compressedContent>
${operationsXml}
  </invoiceOperations>
</ManageInvoiceRequest>`;
}
