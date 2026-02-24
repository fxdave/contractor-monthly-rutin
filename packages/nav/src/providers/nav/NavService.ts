import crypto from "node:crypto";
import zlib from "node:zlib";
import { parseStringPromise } from "xml2js";
import { renderXml as renderDigestXml } from "./proto/QueryInvoiceDigest.js";
import { renderXml as renderDataXml } from "./proto/QueryInvoiceData.js";
import { renderXml as renderTokenExchangeXml } from "./proto/TokenExchange.js";
import { renderXml as renderManageInvoiceXml } from "./proto/ManageInvoice.js";
import type { QueryInvoiceDigestResponse, InvoiceDigest } from "./proto/QueryInvoiceDigest.js";
import type { QueryInvoiceDataResponse } from "./proto/QueryInvoiceData.js";
import type { TokenExchangeResponse } from "./proto/TokenExchange.js";
import type { ManageInvoiceResponse } from "./proto/ManageInvoice.js";
import type { RequestIdRepo } from "./repo/RequestIdRepo.js";
import {
  passwordHash,
  requestSignature,
  invoiceHash,
  toTimestamp14,
  toIsoTimestamp,
} from "./crypto.js";

export type { InvoiceDigest };

async function parseNavResponse<T>(xmlText: string): Promise<T> {
  const parsed = await parseStringPromise(xmlText, {
    tagNameProcessors: [(name: string) => name.replace(/^[^:]+:/, "")],
    explicitArray: false,
    mergeAttrs: false,
  });

  const root = parsed as Record<string, unknown>;
  const keys = Object.keys(root);
  if (keys.length !== 1) throw new Error(`Unexpected root keys: ${keys.join(", ")}`);
  return root[keys[0]] as T;
}

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

export type NavServiceConfig = {
  taxNumber: string;
  technicalUserName: string;
  technicalUserPass: string;
  signKey: string;
  exchangeKey: string;
  baseUrl: string;
  software: {
    softwareId: string;
    softwareName: string;
    softwareOperation: string;
    softwareMainVersion: string;
    softwareDevName: string;
    softwareDevContact: string;
    softwareCountryCode: string;
    softwareTaxNumber: string;
  };
};

export class NavService {
  constructor(private _cfg: NavServiceConfig, private _repo: RequestIdRepo) {}

  private get _passHash() {
    return passwordHash(this._cfg.technicalUserPass);
  }

  private async _post(path: string, xmlBody: string): Promise<string> {
    const url = `${this._cfg.baseUrl}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml;charset=UTF-8",
        Accept: "application/xml",
      },
      body: xmlBody,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`NAV API error ${response.status}: ${text}`);
    }
    return text;
  }

  async queryInvoiceDigest(
    page: number,
    dateFrom: string,
    dateTo: string
  ): Promise<{ digests: InvoiceDigest[]; currentPage: number; availablePage: number }> {
    const now = new Date();
    const requestId = this._repo.next();
    const ts14 = toTimestamp14(now);
    const timestamp = toIsoTimestamp(now);
    const sig = requestSignature(requestId, ts14, this._cfg.signKey);

    const xml = renderDigestXml({
      requestId,
      timestamp,
      passwordHash: this._passHash,
      requestSignature: sig,
      taxNumber: this._cfg.taxNumber,
      technicalUserName: this._cfg.technicalUserName,
      software: this._cfg.software,
      page,
      dateFrom,
      dateTo,
    });

    const responseText = await this._post("/queryInvoiceDigest", xml);
    const parsed = await parseNavResponse<QueryInvoiceDigestResponse>(responseText);

    if (parsed.result?.funcCode !== "OK") {
      throw new Error(
        `queryInvoiceDigest failed: ${parsed.result?.errorCode} — ${parsed.result?.message}`
      );
    }

    const result = parsed.invoiceDigestResult;
    const digests = ensureArray(result?.invoiceDigest);

    return {
      digests,
      currentPage: parseInt(result.currentPage, 10),
      availablePage: parseInt(result.availablePage, 10),
    };
  }

  async queryInvoiceData(invoiceNumber: string): Promise<Buffer> {
    const now = new Date();
    const requestId = this._repo.next();
    const ts14 = toTimestamp14(now);
    const timestamp = toIsoTimestamp(now);
    const sig = requestSignature(requestId, ts14, this._cfg.signKey);

    const xml = renderDataXml({
      requestId,
      timestamp,
      passwordHash: this._passHash,
      requestSignature: sig,
      taxNumber: this._cfg.taxNumber,
      technicalUserName: this._cfg.technicalUserName,
      software: this._cfg.software,
      invoiceNumber,
    });

    const responseText = await this._post("/queryInvoiceData", xml);
    const parsed = await parseNavResponse<QueryInvoiceDataResponse>(responseText);

    if (parsed.result?.funcCode !== "OK") {
      throw new Error(
        `queryInvoiceData failed: ${parsed.result?.errorCode} — ${parsed.result?.message}`
      );
    }

    const dataResult = parsed.invoiceDataResult;
    const raw = Buffer.from(dataResult.invoiceData, "base64");

    const isCompressed = dataResult.compressedContentIndicator === "true";
    if (isCompressed) {
      return zlib.gunzipSync(raw);
    }
    return raw;
  }

  private async _tokenExchange(): Promise<string> {
    const now = new Date();
    const requestId = this._repo.next();
    const ts14 = toTimestamp14(now);
    const timestamp = toIsoTimestamp(now);
    const sig = requestSignature(requestId, ts14, this._cfg.signKey);

    const xml = renderTokenExchangeXml({
      requestId,
      timestamp,
      passwordHash: this._passHash,
      requestSignature: sig,
      taxNumber: this._cfg.taxNumber,
      technicalUserName: this._cfg.technicalUserName,
      software: this._cfg.software,
    });

    const responseText = await this._post("/tokenExchange", xml);
    const parsed = await parseNavResponse<TokenExchangeResponse>(responseText);

    if (parsed.result?.funcCode !== "OK") {
      throw new Error(
        `tokenExchange failed: ${parsed.result?.errorCode} — ${parsed.result?.message}`
      );
    }

    const decipher = crypto.createDecipheriv(
      "aes-128-ecb",
      Buffer.from(this._cfg.exchangeKey, "utf8"),
      null
    );
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.encodedExchangeToken, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  async manageInvoice(
    invoiceXml: string,
    operation: "CREATE" | "STORNO" = "CREATE"
  ): Promise<string> {
    const base64Data = Buffer.from(invoiceXml, "utf8").toString("base64");

    console.log(`base64 length: ${base64Data.length} chars`);

    const hash = invoiceHash(operation, base64Data);

    const exchangeToken = await this._tokenExchange();

    const now = new Date();
    const requestId = this._repo.next();
    const ts14 = toTimestamp14(now);
    const timestamp = toIsoTimestamp(now);

    const sig = requestSignature(requestId, ts14, this._cfg.signKey, [hash]);

    const xml = renderManageInvoiceXml({
      requestId,
      timestamp,
      passwordHash: this._passHash,
      requestSignature: sig,
      taxNumber: this._cfg.taxNumber,
      technicalUserName: this._cfg.technicalUserName,
      software: this._cfg.software,
      exchangeToken,
      invoiceOperations: [{ index: 1, operation, base64Data }],
    });

    const responseText = await this._post("/manageInvoice", xml);
    const parsed = await parseNavResponse<ManageInvoiceResponse>(responseText);

    if (parsed.result?.funcCode !== "OK") {
      throw new Error(
        `manageInvoice failed: ${parsed.result?.errorCode} — ${parsed.result?.message}`
      );
    }

    return parsed.transactionId ?? "";
  }
}
