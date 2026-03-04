import { chromium, type Page } from "playwright";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import QRCode from "qrcode";

const LOGIN_URL = "https://www.otpbank.hu/portal/hu/OTPdirekt/Belepes";
const ACCOUNT_STATEMENT_URL =
  "https://www.otpbankdirekt.hu/homebank/do/hb2/menuaccess?hb2NavmenuSelection=SZAMLAKIVONAT";

export interface OtpConfig {
  downloadDir: string;
  userId: string;
  accountNumber: string;
  password: string;
}

export class OtpService {
  constructor(private _config: OtpConfig) {}

  async downloadStatement(month: string): Promise<string> {
    const browser = await chromium.launch({
      headless: true,
      slowMo: 100,
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    try {
      await page.goto(LOGIN_URL, { waitUntil: "networkidle" });
      await this._acceptCookies(page);
      await this._login(page, this._config.userId, this._config.accountNumber, this._config.password);

      const statementNumber = OtpService.getStatementNumber(month);
      const filePath = await this._downloadAccountStatement(page, statementNumber);
      await page.waitForTimeout(3000);
      return filePath;
    } finally {
      await browser.close();
    }
  }

  static getStatementNumber(month: string): string {
    const [, monthNum] = month.split("-").map(Number);
    const paddedMonth = monthNum.toString().padStart(3, "0");
    const year = parseInt(month.split("-")[0], 10);
    return `${paddedMonth}/${year}`;
  }

  static getLastMonthString(): string {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);
    const year = lastMonth.getFullYear();
    const month = (lastMonth.getMonth() + 1).toString().padStart(2, "0");
    return `${year}-${month}`;
  }

  private async _acceptCookies(page: Page): Promise<void> {
    await page.waitForSelector("text=OTPdirekt belépés", { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);
  }

  private async _login(page: Page, azonosito: string, szamlaszam: string, jelszo: string): Promise<void> {
    const azonositoField = page.locator("#account_number_identifier");
    await azonositoField.waitFor({ state: "visible", timeout: 10000 });
    await azonositoField.click();
    await page.waitForTimeout(500);
    await azonositoField.clear();
    await azonositoField.pressSequentially(azonosito, { delay: 100 });

    await page.waitForTimeout(500);
    const szamlaszamField = page.locator("#hb_account_number");
    await szamlaszamField.click();
    await page.waitForTimeout(500);
    await szamlaszamField.clear();
    await szamlaszamField.pressSequentially(szamlaszam.replace(/^117/, ""), { delay: 100 });

    await page.waitForTimeout(500);
    const jelszoField = page.locator("#account_number_password");
    await jelszoField.click();
    await page.waitForTimeout(500);
    await jelszoField.clear();
    await jelszoField.pressSequentially(jelszo, { delay: 100 });

    await page.waitForTimeout(1000);
    const loginButton = page.locator('button[type="submit"]').first();
    await loginButton.click();

    await page.waitForSelector("#qrToken", { timeout: 30000 });
    await this._showQrInTerminal(page);

    await page.waitForSelector("text=Üdvözöljük", { timeout: 120000 });
    await page.waitForTimeout(12000);
  }

  private async _showQrInTerminal(page: Page): Promise<void> {
    try {
      const qrElement = page.locator("#qrToken");
      const pngBuffer = await qrElement.screenshot();
      const png = PNG.sync.read(pngBuffer);
      const qrData = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
      if (qrData) {
        const terminalQr = await QRCode.toString(qrData.data, { type: "terminal", small: true });
        console.log("\nScan this QR code with your mobile app:\n");
        console.log(terminalQr);
      } else {
        console.log("QR code appeared! Please scan it in the browser...");
      }
    } catch {
      console.log("QR code appeared! Please scan it in the browser...");
    }
  }

  private async _downloadAccountStatement(page: Page, statementNumber: string): Promise<string> {
    await page.goto(ACCOUNT_STATEMENT_URL);
    await page.waitForSelector(
      "text=Kérjük, a kivonat lekérdezéshez adja meg az alábbi adatokat",
      { timeout: 15000 }
    );

    const radioButton = page.locator("#searchByDate_false");
    await radioButton.check();

    const kivonatSzamField = page.locator("#kivonatSzam");
    await kivonatSzamField.fill(statementNumber);

    const searchButton = page.locator("#submit\\:tovabb");
    await searchButton.click();
    await page.waitForTimeout(2000);

    const downloadLink = page.locator("#szamlakivonatLetoltes_gomb");
    await downloadLink.waitFor({ state: "visible", timeout: 10000 });

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();

    const download = await downloadPromise;
    const downloadPath = `${this._config.downloadDir}/${download.suggestedFilename()}`;
    await download.saveAs(downloadPath);
    return downloadPath;
  }
}
