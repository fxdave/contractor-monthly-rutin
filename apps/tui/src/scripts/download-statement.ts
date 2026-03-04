import { createInterface } from "node:readline";
import { OtpService } from "otp";
import { loadOtpConfig } from "../config.js";

async function main() {
  const config = loadOtpConfig();
  const otp = new OtpService(config);

  const defaultMonth = OtpService.getLastMonthString();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => process.exit(130));
  const month = await new Promise<string>((resolve) =>
    rl.question(`Month (YYYY-MM) [${defaultMonth}]: `, (answer) =>
      resolve(answer.trim() || defaultMonth)
    )
  );
  rl.close();

  console.log(`\nDownloading: ${month}...`);
  const filePath = await otp.downloadStatement(month);
  console.log(`Saved: ${filePath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
