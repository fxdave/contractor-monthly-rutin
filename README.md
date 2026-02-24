# contractor-monthly-rutin

Simple automation of invoicing for developer contractors.

Integrates with the Hungarian [NAV Online Szamla API v3](https://onlineszamla.nav.gov.hu/) to issue, storno, download, and render invoices. Optional [Clockify](https://clockify.me/) integration for hours tracking and billing summaries, and [OTP Bank](https://www.otpbank.hu/) automation for statement downloads.

## Features

- Issue invoices to NAV with 2-step confirmation
- Storno existing invoices
- Download all submitted invoices as XML
- Render invoices to HTML and PDF
- Clockify monthly hours and billing summary
- OTP Bank statement download (Playwright)
- Interactive TUI menu and CLI scripts

## Prerequisites

- Node.js 20+
- A registered [NAV technical user](https://onlineszamla.nav.gov.hu/)
- (Optional) [weasyprint](https://weasyprint.org/) on PATH for PDF rendering
- (Optional) Clockify API key

## Installation

```bash
make install       # npm install + creates .env from .env.example
```

Fill in your NAV credentials in `.env`, then generate the default invoice template:

```bash
make generate-default-template
```

## Configuration

All runtime data lives in `data/` (gitignored):

| File | Purpose |
|------|---------|
| `data/config/products.json` | Product definitions (description, price, VAT rate) |
| `data/config/partners.json` | Customer definitions |
| `data/config/clockify.json` | Clockify billing rates and overrides |
| `data/config/templates/` | Invoice templates (generated from latest invoice) |
| `data/db/invoices/` | Downloaded XMLs, rendered HTMLs, and PDFs |

## Usage

### TUI (interactive menu)

```bash
make start
```

### CLI

```bash
# Download invoices from NAV
make download FROM=2019
make download FROM=2019 TO=2020

# Create invoice
# ⚠️ I'm brave enough but I'm not responsible for your decisions.
# ✅ 2-step confirmation, it sends only when you agree.
make create QUANTITY=40

# Storno an invoice
# ⚠️ I'm brave enough but I'm not responsible for your decisions.
# ✅ 2-step confirmation, it sends only when you agree.
make storno INVOICE=2026-000005

# Render invoice to HTML + PDF
# ⚠️ I'm brave enough but I'm not responsible for your decisions.
# ✅ No sending involved, it just generates HTML + PDF.
make render INVOICE=2026-000005

# Typecheck all packages
make typecheck
```

### Direct script execution

```bash
npx tsx apps/tui/src/scripts/create-invoice.ts <quantity> [product-id]
npx tsx apps/tui/src/scripts/download-invoices.ts <fromYear> [toYear]
```

## Project structure

```
packages/
  nav/          NAV Online Szamla API integration
  clockify/     Clockify time tracking integration
  otp/          OTP Bank statement automation (Playwright)
apps/
  tui/          Interactive TUI app and CLI scripts
```

Turborepo monorepo. No build step -- TypeScript runs directly via `npx tsx`.

## License

[GPLv3](LICENSE) -- no warranty of any kind.
