import { createInterface } from "node:readline";
import { existsSync, readdirSync } from "node:fs";
import {
  NavInvoicingProvider,
  InvoiceService,
  InvoiceRepo,
  computeSummary,
} from "nav";
import { loadNavConfig, INVOICES_DIR, COUNTER_FILE } from "../config.js";

function listLocalInvoices(): string[] {
  if (!existsSync(INVOICES_DIR)) return [];
  return readdirSync(INVOICES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{6}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("SIGINT", () => process.exit(130));

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) =>
    rl.question(prompt, (answer) => resolve(answer.trim())),
  );
}

async function choose<T extends string>(
  message: string,
  options: { label: string; value: T }[],
): Promise<T> {
  console.log(`\n${message}`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${i + 1}) ${options[i].label}`);
  }
  while (true) {
    const answer = await ask(`Choose [1-${options.length}]: `);
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < options.length) return options[idx].value;
    console.log("Invalid choice.");
  }
}

async function main() {
  const navConfig = loadNavConfig();
  const invoiceRepo = new InvoiceRepo(INVOICES_DIR);
  const provider = new NavInvoicingProvider(
    navConfig,
    COUNTER_FILE,
    invoiceRepo,
  );

  console.log("Syncing with NAV...");
  const service = new InvoiceService(provider);
  const sync = await service.sync();
  if (sync.saved.length > 0)
    console.log(`  Downloaded: ${sync.saved.join(", ")}`);
  console.log(
    `  Local invoices up to date (${sync.saved.length + sync.skipped.length} recent).\n`,
  );

  const invoices = listLocalInvoices();
  if (invoices.length === 0) {
    console.error("No local invoices found.");
    process.exit(1);
  }

  const invoiceNumber =
    process.argv[2] ??
    (await choose(
      "Select invoice to storno:",
      invoices.map((n) => ({ label: n, value: n })),
    ));

  const data = await provider.getInvoiceData(invoiceNumber);
  const summary = computeSummary(data.lines);

  console.log();
  console.log(`Original:      ${data.invoiceNumber}`);
  console.log(`Issued:        ${data.issueDate}`);
  console.log(
    `Gross:         ${summary.grossAmount.toLocaleString("hu-HU")} HUF`,
  );
  console.log();

  const { stornoNumber } = await provider.buildStornoInvoice(invoiceNumber);
  console.log(`Storno XML saved locally: ${stornoNumber}`);
  console.log(
    "Use 'make nav-lastXml-review make nav-lastXml-send' to submit to NAV.",
  );

  rl.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
