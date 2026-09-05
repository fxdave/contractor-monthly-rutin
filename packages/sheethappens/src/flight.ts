export interface TimesheetProject {
  id: string;
  name: string;
  hours: number;
  rate: number;
  rateSource: string;
  amount: number;
  entries: number;
}

export interface Timesheet {
  month: string;
  label: string;
  status: string;
  hours: number;
  amount: number;
  entries: number;
  currency: string;
  periodStart?: string;
  declaredAmount?: number;
  projects: TimesheetProject[];
}

type FlightNode = unknown;
type FlightElement = [string, string, string | null, Record<string, FlightNode>];

const isElement = (value: FlightNode): value is FlightElement =>
  Array.isArray(value) && value[0] === "$" && typeof value[1] === "string";

/**
 * Splits an RSC flight payload into its `<hexId>:<json>` rows. Rows whose payload
 * carries a module marker (`I[...]`, `H{...}`) are parsed without the marker;
 * anything unparseable (references, sentinels) is skipped.
 */
function parseRows(payload: string): FlightNode[] {
  const rows: FlightNode[] = [];
  for (const line of payload.split("\n")) {
    const match = line.match(/^([0-9a-f]+):(.*)$/s);
    if (!match) continue;
    const body = /^[A-Za-z][[{]/.test(match[2]) ? match[2].slice(1) : match[2];
    try {
      rows.push(JSON.parse(body));
    } catch {
      // Reference rows ("$1", "$Sreact.fragment") carry no data.
    }
  }
  return rows;
}

function collectElements(rows: FlightNode[]): FlightElement[] {
  const elements: FlightElement[] = [];
  const seen = new Set<object>();
  const walk = (value: FlightNode): void => {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (isElement(value)) elements.push(value);
    for (const child of Object.values(value)) walk(child);
  };
  rows.forEach(walk);
  return elements;
}

/** Renders a flight subtree to text, dropping unresolved references ("$L12"). */
function textOf(value: FlightNode): string {
  if (typeof value === "string") return value.startsWith("$") ? "" : value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return isElement(value) ? textOf(value[3]?.children) : value.map(textOf).join("");
  }
  if (value && typeof value === "object") {
    return textOf((value as Record<string, FlightNode>).children);
  }
  return "";
}

const className = (element: FlightElement): string =>
  typeof element[3]?.className === "string" ? (element[3].className as string) : "";

const childrenOf = (element: FlightElement): FlightNode[] =>
  ([] as FlightNode[]).concat((element[3]?.children ?? []) as FlightNode[]);

/** "65.30 h" -> 65.3, "HUF 861,960" -> 861960, "13,200 HUF/h" -> 13200 */
function toNumber(text: string): number {
  const match = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export function parseTimesheet(payload: string, month: string): Timesheet | null {
  const elements = collectElements(parseRows(payload));

  // Summary tiles: <div class="... bg-card/70 ..."><div>{icon}{label}</div><p>{value}</p></div>
  const stats: Record<string, string> = {};
  for (const element of elements) {
    if (element[1] !== "div" || !className(element).includes("bg-card/70")) continue;
    const [header, value] = childrenOf(element);
    const label = textOf(header).trim();
    if (label) stats[label] = textOf(value).trim();
  }
  if (!stats.Hours) return null;

  // Project breakdown: keyed <tr> rows of five <td> cells.
  const projects: TimesheetProject[] = [];
  for (const element of elements) {
    if (element[1] !== "tr" || !element[2]) continue;
    const cells = childrenOf(element).filter((c): c is FlightElement => isElement(c) && c[1] === "td");
    if (cells.length < 5) continue;
    const [name, hours, rate, amount, entries] = cells.map((cell) => textOf(cell).trim());
    projects.push({
      id: element[2],
      name,
      hours: toNumber(hours),
      rate: toNumber(rate),
      rateSource: rate.split("·").pop()?.trim() ?? "",
      amount: toNumber(amount),
      entries: toNumber(entries),
    });
  }

  // Invoice-upload form carries the canonical period and amount.
  const fields: Record<string, string> = {};
  for (const element of elements) {
    const name = element[3]?.name;
    if (element[1] !== "input" || typeof name !== "string") continue;
    const value = element[3]?.value ?? element[3]?.defaultValue;
    if (typeof value === "string") fields[name] = value;
  }

  const heading = elements.find((e) => e[1] === "h2" && className(e).includes("mt-3"));
  const badge = elements.find(
    (e) => e[1] === "span" && className(e).includes("radius-pill") && className(e).includes("bg-"),
  );

  return {
    month,
    label: heading ? textOf(heading[3].children).trim() : month,
    status: badge ? textOf(badge[3].children).trim() : "Unknown",
    hours: toNumber(stats.Hours ?? ""),
    amount: toNumber(stats.Amount ?? ""),
    entries: toNumber(stats.Entries ?? ""),
    // Months without an invoice form carry no currencyCode field; the tile reads
    // "HUF<nbsp>374,000", so match the code rather than splitting on whitespace.
    currency: fields.currencyCode ?? (stats.Amount ?? "").match(/[A-Z]{3}/)?.[0] ?? "HUF",
    periodStart: fields.periodStart,
    declaredAmount: fields.declaredAmount ? toNumber(fields.declaredAmount) : undefined,
    projects,
  };
}
