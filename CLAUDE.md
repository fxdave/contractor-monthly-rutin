# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Hungarian invoicing system with NAV Online Számla API v3 integration. Issues, stornos, downloads, and renders invoices. Uses Clockify for hours tracking and OTP Bank for statement downloads. Turborepo monorepo with local npm packages. No build step — TypeScript runs directly via `npx tsx`.

## Commands

```bash
# Setup
make install                          # npm install + create .env from .env.example

# Typecheck all packages
make typecheck                        # npx turbo typecheck

# TUI (interactive menu)
make start                            # npx tsx apps/tui/src/main.ts

# Init & template
make generate-default-template        # Download latest invoice, generate templates/default.json

# Download invoices from NAV
make download FROM=2019               # All from 2019 to now
make download FROM=2019 TO=2020       # Specific range

# Create invoice (interactive 2-step confirmation)
make create QUANTITY=40               # Hours to invoice (reads price from config/products.json)

# Storno
make storno INVOICE=2026-000005

# Render to HTML + PDF
make render INVOICE=2026-000005       # Requires `weasyprint` on PATH for PDF

# Pipeline: step-by-step invoicing workflow
make clockify-getPreviousMonthReport  # Clockify hours + billing summary
make nav-createXml QUANTITY=40        # Build invoice XML locally (no NAV send)
make nav-createStornoXml INVOICE=2026-000005  # Build storno XML locally
make nav-lastXml-review               # Review last (or specific) invoice details
make nav-lastXml-send                 # Submit saved XML to NAV (y/N confirmation)
make nav-lastXml-renderPdf            # Render invoice to HTML + PDF
make otp-downloadStatement            # Download OTP bank statement
```

TypeScript type-check all packages:

```bash
npx turbo typecheck
```

## Architecture

### Monorepo structure

```
turbo.json                    <- Turborepo config (typecheck pipeline)
package.json                  <- Root workspace config (packages/*, apps/*)
data/                         <- Gitignored; all runtime data
  config/
    partners.json             <- Customer definitions (selectable in TUI)
    products.json             <- Product/price definitions (replaces hardcoded rates)
    clockify.json             <- Clockify billing rates and overrides
    templates/                <- Invoice templates (generated from latest invoice)
  db/
    invoices/                 <- Downloaded XMLs, rendered HTMLs, and PDFs
    requestId-counter.json    <- NAV request ID counter (auto-migrated from root)
packages/
  nav/                        <- nav: NAV Online Szamla API integration
    src/
      InvoicingProvider.ts    <- Domain types (InvoiceData, InvoiceLine, etc.) + math helpers
      InvoiceService.ts       <- High-level orchestration (sync, create, storno, render, PDF)
      index.ts                <- Barrel export
      providers/nav/
        NavInvoicingProvider.ts <- Main implementation; talks to NavService + repos
        NavService.ts          <- Raw NAV REST API calls
        config.ts              <- NavConfig type definition (no .env reads)
        crypto.ts              <- SHA3-512 request signatures, AES-128-ECB token decryption
        xml/
          parse.ts             <- NAV XML -> InvoiceData (includes invoiceReference for storno)
          build.ts             <- InvoiceData -> NAV XML (CREATE and STORNO)
          render.ts            <- InvoiceData -> standalone HTML invoice (storno-aware)
        repo/
          InvoiceRepo.ts       <- Filesystem store: invoices/<YYYY-NNNNNN>/
          RequestIdRepo.ts     <- Monotonic counter for NAV request IDs
        proto/                 <- NAV request/response XML schemas
  clockify/                   <- clockify: Clockify time tracking
    src/
      ClockifyService.ts      <- Monthly hours + billing summary
      index.ts
  otp/                        <- otp: OTP Bank statement automation (Playwright)
    src/
      OtpService.ts           <- Browser automation for statement download
      index.ts
apps/
  tui/                        <- tui: Interactive TUI app
    src/
      main.ts                 <- TUI entry point
      config.ts               <- Reads .env, constructs configs for all packages
      scripts/                <- CLI entrypoints (one per operation, use package APIs)
```

### Key conventions

- **Constructor-based config**: Packages never read `.env`. All config is passed via constructors. Only `apps/tui/src/config.ts` reads `.env`.
- All scripts use `npx tsx` (no compile step, ESM modules with `.ts` imports).
- Invoice numbers follow the format `YYYY-NNNNNN` (e.g., `2026-000005`). Sequence resets each calendar year.
- `data/` directory (gitignored) holds all runtime data: `config/` for user settings, `db/` for invoices and counters.
- `data/config/products.json` defines available products with prices. `data/config/partners.json` defines customers. `data/config/clockify.json` defines billing rates.
- `db/requestId-counter.json` persists the NAV request ID counter.
- NAV environment is controlled by `NAV_MODE=testing|production` in `.env`.
- Storno invoices render with title "Sztorno szamla", negative unit prices, and a reference note.

### NAV API flow for invoice creation

1. `tokenExchange` -> get one-time token (decrypted with AES-128-ECB exchange key)
2. Build invoice XML from template + modifications
3. `manageInvoice` with operation `CREATE` or `STORNO` + signed request + exchange token

### PDF rendering

HTML is generated by `render.ts` using inline CSS for A4 print. PDF conversion uses the external `weasyprint` CLI tool — must be installed separately (not in npm).
