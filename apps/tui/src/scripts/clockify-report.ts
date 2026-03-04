import { createInterface } from "node:readline";
import { ClockifyService } from "clockify";
import { loadClockifyConfig } from "../config.js";

function formatHMS(decimalHours: number): string {
  const totalSeconds = Math.floor(decimalHours * 3600);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function main() {
  const config = loadClockifyConfig();
  const clockify = new ClockifyService(config);

  const now = new Date();
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const defaultMonth = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => process.exit(130));
  const month = await new Promise<string>((resolve) =>
    rl.question(`Month (YYYY-MM) [${defaultMonth}]: `, (answer) =>
      resolve(answer.trim() || defaultMonth)
    )
  );
  rl.close();

  console.log(`\nFetching hours: ${month}...`);
  const report = await clockify.getMonthlyHours(month);

  console.log("\n=== Hours by project ===");
  for (const { projectName, hours } of report.hours) {
    console.log(`${projectName}: ${hours.toFixed(2)} hours (${formatHMS(hours)})`);
  }

  const summary = clockify.getBillingSummary(report, month);

  console.log("\n=== Billing summary ===");
  for (const cat of summary.categories) {
    console.log(`${cat.name}: ${cat.hours.toFixed(2)}h @ ${cat.rate} HUF/h = ${cat.price.toFixed(0)} HUF`);
  }
  console.log(`\nTotal: ${summary.totalPrice.toFixed(0)} HUF (${summary.totalHours.toFixed(1)}h)`);
  console.log(`\nReport: ${summary.reportUrl}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
