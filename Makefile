INVOICE ?=

.PHONY: *

install:
	npm install
	test -f .env || cp .env.example .env

typecheck:
	npx turbo typecheck

start:
	npx tsx apps/tui/src/main.ts

generate-default-template:
	npx tsx apps/tui/src/scripts/init.ts
	npx tsx apps/tui/src/scripts/generate-template.ts

FROM ?= 2019
TO ?=
download:
	npx tsx apps/tui/src/scripts/download-invoices.ts $(FROM) $(TO)

QUANTITY ?=

clockify-getPreviousMonthReport:
	npx tsx apps/tui/src/scripts/clockify-report.ts

nav-createXml:
	npx tsx apps/tui/src/scripts/build-invoice.ts $(QUANTITY)

nav-createStornoXml:
	npx tsx apps/tui/src/scripts/build-storno.ts

nav-lastXml-review:
	npx tsx apps/tui/src/scripts/review-invoice.ts $(INVOICE)

nav-lastXml-send:
	npx tsx apps/tui/src/scripts/send-invoice.ts $(INVOICE)

nav-lastXml-renderPdf:
	npx tsx apps/tui/src/scripts/render-invoice.ts $(INVOICE)

otp-downloadStatement:
	npx tsx apps/tui/src/scripts/download-statement.ts

rutin:
	make clockify-getPreviousMonthReport \
	nav-createXml \
	nav-lastXml-review \
	nav-lastXml-send \
	nav-lastXml-renderPdf \
	otp-downloadStatement