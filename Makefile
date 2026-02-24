INVOICE ?=

.PHONY: install generate-default-template download create storno render typecheck start

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
create:
	npx tsx apps/tui/src/scripts/create-invoice.ts $(QUANTITY)

storno:
	npx tsx apps/tui/src/scripts/storno-invoice.ts $(INVOICE)

render:
	npx tsx apps/tui/src/scripts/render-invoice.ts $(INVOICE)
