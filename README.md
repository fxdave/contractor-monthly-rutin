# contractor-monthly-rutin

Simple automation of invoicing for developer contractors.

Integrates with the Hungarian [NAV Online Szamla API v3](https://onlineszamla.nav.gov.hu/) to issue, storno, download, and render invoices. Optional [Clockify](https://clockify.me/) integration for hours tracking and billing summaries, and [OTP Bank](https://www.otpbank.hu/) automation for statement downloads.

## Features

- **Download past invoice** xmls from NAV and generate invoice template from it for a quick start
- **Create/Storno invoices** using templates and overrides with NAV integration
- **Reads clockify** and can calculate final price based on the configurable hourly rates/project
- **Download account statement** from OTP's smart bank (the old one)
- **Download invoices from email** via IMAP (e.g. Anthropic invoices)

## Prerequisites

- Node.js 20+
- A registered [NAV technical user](https://onlineszamla.nav.gov.hu/)
- (Optional) [weasyprint](https://weasyprint.org/) on PATH for PDF rendering
- (Optional) Clockify API key

## Usage

```bash
# For installation
make install                          # npm install + creates .env from .env.example
make download FROM=2019               # Download invoices from NAV from 2019
make download FROM=2019 TO=2020       # Download invoices from NAV from 2019 to 2020
make generate-default-template        # initialize templates from downloaded invoices

# Interactive menu (TUI)
make start

# invoicing
make clockify-getPreviousMonthReport  # Check hours + billing summary
make nav-createXml                    # Build invoice XML locally (no NAV send)
make nav-createStornoXml              # Build invoice XML locally (no NAV send)
make nav-lastXml-review               # Review the saved invoice XML
make nav-lastXml-send                 # Submit to NAV ⚠️(ensure compliance with law)
make nav-lastXml-renderPdf            # Render to HTML + PDF ⚠️(ensure compliance with law)
make otp-downloadStatement            # Download bank statement
make mail-downloadAnthropicInvoices   # Download Anthropic invoices from email
```

### Monthly rutin in one command

```bash
# ⚠️ I'm brave enough but I'm not responsible for your decisions.
# ✅ y/N confirmation, it sends only when you agree.
make clockify-getPreviousMonthReport nav-createXml nav-lastXml-review nav-lastXml-send nav-lastXml-renderPdf otp-downloadStatement
```

## Configuration

All runtime data lives in `data/` (gitignored):

| File                        | Purpose                                            |
| --------------------------- | -------------------------------------------------- |
| `.env`                      | credentials or basic config                        |
| `data/config/products.json` | Product definitions (description, price, VAT rate) |
| `data/config/partners.json` | Customer definitions                               |
| `data/config/clockify.json` | Clockify billing rates and overrides               |
| `data/config/templates/`    | Invoice templates (generated from latest invoice)  |
| `data/db/invoices/`         | Downloaded XMLs, rendered HTMLs, and PDFs          |
| `data/db/downloads/`        | For OTP statements and email attachments           |

## Project structure

```
packages/
  nav/          NAV Online Szamla API integration
  clockify/     Clockify time tracking integration
  otp/          OTP Bank statement automation (Playwright)
  mail/         Generic IMAP email attachment downloader
apps/
  tui/          Interactive TUI app and CLI scripts
```

Turborepo monorepo. No build step -- TypeScript runs directly via `npx tsx`.

## License

[GPLv3](LICENSE) -- no warranty of any kind.
