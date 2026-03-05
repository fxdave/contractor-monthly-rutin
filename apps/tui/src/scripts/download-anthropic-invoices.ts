import { MailService } from "mail";
import { loadMailConfig } from "../config.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "../../../..");

async function main() {
  const config = loadMailConfig();
  const mail = new MailService(config);

  const downloadDir = join(ROOT_DIR, "data/db/downloads/anthropic");

  console.log("Searching for Anthropic invoices...");
  const files = await mail.downloadAttachments({
    from: "invoice+statements@mail.anthropic.com",
    attachmentPrefix: "Invoice-",
    downloadDir,
  });

  if (files.length === 0) {
    console.log("No new invoices found.");
  } else {
    console.log(`Downloaded ${files.length} invoice(s):`);
    for (const f of files) {
      console.log(`  ${f}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
