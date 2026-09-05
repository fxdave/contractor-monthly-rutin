import { createInterface } from "node:readline";
import { SheetHappensService } from "sheethappens";
import { loadSheetHappensConfig } from "../config.js";

function formatHuf(amount: number): string {
  return amount.toLocaleString("en-US");
}

async function main() {
  const config = loadSheetHappensConfig();
  const sheetHappens = new SheetHappensService(config);

  const defaultMonth = SheetHappensService.getPreviousMonthString();
  const argMonth = process.argv[2];

  let month = argMonth;
  if (!month) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on("SIGINT", () => process.exit(130));
    month = await new Promise<string>((resolve) =>
      rl.question(`Month (YYYY-MM) [${defaultMonth}]: `, (answer) => resolve(answer.trim() || defaultMonth))
    );
    rl.close();
  }

  console.log(`\nFetching timesheet: ${month}...`);
  const timesheet = await sheetHappens.getTimesheet(month);

  console.log(`\n=== ${timesheet.label} (${timesheet.status}) ===`);
  for (const project of timesheet.projects) {
    console.log(
      `${project.name}: ${project.hours.toFixed(2)}h @ ${formatHuf(project.rate)} ${timesheet.currency}/h ` +
        `= ${formatHuf(project.amount)} ${timesheet.currency} (${project.entries} entries)`
    );
  }
  console.log(
    `\nTotal: ${formatHuf(timesheet.amount)} ${timesheet.currency} ` +
      `(${timesheet.hours.toFixed(2)}h, ${timesheet.entries} entries)`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
