import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseTimesheet, type Timesheet } from "./flight.js";

export interface SheetHappensConfig {
  baseUrl?: string;
  email: string;
  password: string;
  /** Resolved on demand — TOTP codes are only valid for one 30s window. */
  getTotp: () => string | Promise<string>;
  /** Where the signed-in cookies are cached between runs. */
  sessionFile: string;
}

const DEFAULT_BASE_URL = "https://team.rolloutit.net";

/**
 * The timesheets page is a React Server Component route — there is no JSON API.
 * Asking for the page with these headers returns the flight payload of the page
 * segment alone (~7 KB gzipped instead of ~190 KB of HTML).
 */
const ROUTER_STATE_TREE =
  "%5B%22%22%2C%7B%22children%22%3A%5B%22timesheets%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2C%22refetch%22%2C4096%5D%7D%2Cnull%2Cnull%2C4096%5D%7D%2Cnull%2Cnull%2C4112%5D";

export class SheetHappensService {
  private _cookies: Record<string, string>;

  constructor(private _config: SheetHappensConfig) {
    this._cookies = this._readSession();
  }

  static getPreviousMonthString(): string {
    const now = new Date();
    const previous = new Date(now.getFullYear(), now.getMonth() - 1);
    const month = (previous.getMonth() + 1).toString().padStart(2, "0");
    return `${previous.getFullYear()}-${month}`;
  }

  /** Signs in if the cached session is gone or rejected. */
  async getTimesheet(month: string): Promise<Timesheet> {
    let timesheet = await this._fetchTimesheet(month);
    if (!timesheet) {
      await this.signIn();
      timesheet = await this._fetchTimesheet(month);
    }
    if (!timesheet) {
      throw new Error(`Timesheet ${month} unavailable — sign-in succeeded but the page came back empty`);
    }
    return timesheet;
  }

  async signIn(): Promise<void> {
    this._cookies = {};

    const signIn = await this._post("/api/auth/sign-in/email", {
      email: this._config.email,
      password: this._config.password,
      rememberMe: true,
    });

    // With 2FA on, sign-in only sets a pending cookie; the session is created by
    // the second-factor step.
    if (signIn.twoFactorRedirect) await this._verifySecondFactor();

    if (!this._cookies["__Secure-better-auth.session_token"] && !this._cookies["better-auth.session_token"]) {
      throw new Error("Sign-in produced no session cookie");
    }
    this._writeSession();
  }

  /**
   * The second factor is not the plain better-auth endpoint: the app gates every
   * page on its own `sheet_happens_2fa` cookie, which only the `verifySecondFactorAction`
   * server action sets. Its id is baked into the /two-factor page bundle and changes
   * on redeploy, so look it up instead of hardcoding it.
   */
  private async _verifySecondFactor(): Promise<void> {
    const actionId = await this._findVerifyActionId();
    const code = await this._config.getTotp();

    const res = await this._request("/two-factor", {
      method: "POST",
      headers: {
        "Next-Action": actionId,
        "content-type": "text/plain;charset=UTF-8",
        origin: this._baseUrl,
        referer: `${this._baseUrl}/two-factor`,
      },
      body: JSON.stringify([{ method: "totp", code, trustDevice: true }]),
      redirect: "manual",
    });

    if (!this._cookies["sheet_happens_2fa"]) {
      throw new Error(`Second factor rejected (${res.status}) — check the TOTP command output`);
    }
  }

  private async _findVerifyActionId(): Promise<string> {
    const page = await (await this._request("/two-factor", {})).text();
    const chunks = [...new Set(page.match(/\/_next\/static\/chunks\/[\w.-]+\.js/g) ?? [])];

    for (const chunk of chunks) {
      const source = await (await fetch(`${this._baseUrl}${chunk}`)).text();
      const match = source.match(/createServerReference\)?\(\s*"([0-9a-f]+)"[^;]*?"verifySecondFactorAction"/);
      if (match) return match[1];
    }
    throw new Error("Could not find verifySecondFactorAction in the /two-factor bundle");
  }

  private get _baseUrl(): string {
    return this._config.baseUrl ?? DEFAULT_BASE_URL;
  }

  private async _post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await this._request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: this._baseUrl,
        referer: `${this._baseUrl}/login`,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`POST ${path} failed (${res.status}): ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /** Returns null when the response is the signed-out page rather than a timesheet. */
  private async _fetchTimesheet(month: string): Promise<Timesheet | null> {
    if (Object.keys(this._cookies).length === 0) return null;

    // `_rsc` is a cache key derived from the RSC headers; a wrong value 307s to
    // the right one, which fetch follows.
    const res = await this._request(`/timesheets?month=${month}&_rsc=1`, {
      headers: {
        RSC: "1",
        "next-url": "/timesheets",
        "next-router-state-tree": ROUTER_STATE_TREE,
      },
    });
    if (!res.ok) throw new Error(`Timesheet request failed (${res.status})`);
    return parseTimesheet(await res.text(), month);
  }

  private async _request(path: string, init: RequestInit): Promise<Response> {
    // Pinned to English: the page is localised, and the parser reads the tile
    // labels ("Hours", "Amount", "Entries") and dot-decimal numbers.
    const cookie = Object.entries({ "sheet-happens-locale": "en", ...this._cookies })
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");

    const res = await fetch(`${this._baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, ...(cookie ? { cookie } : {}) },
    });

    for (const setCookie of res.headers.getSetCookie()) {
      const [pair] = setCookie.split(";");
      const separator = pair.indexOf("=");
      if (separator < 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (value) this._cookies[name] = value;
      else delete this._cookies[name];
    }
    return res;
  }

  private _readSession(): Record<string, string> {
    if (!existsSync(this._config.sessionFile)) return {};
    try {
      return JSON.parse(readFileSync(this._config.sessionFile, "utf8")).cookies ?? {};
    } catch {
      return {};
    }
  }

  private _writeSession(): void {
    mkdirSync(dirname(this._config.sessionFile), { recursive: true });
    writeFileSync(
      this._config.sessionFile,
      JSON.stringify({ savedAt: new Date().toISOString(), cookies: this._cookies }, null, 2) + "\n",
      { encoding: "utf8", mode: 0o600 },
    );
  }
}
