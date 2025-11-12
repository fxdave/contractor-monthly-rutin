import { readFile } from "fs/promises";

const ENV = await parseEnv(".env.hours");
function getEnvOrDie(name: string) {
  if (!ENV[name]) throw new Error(`${name} is required in .env.hours`);
  return ENV[name];
}

const API_KEY = getEnvOrDie("API_KEY");
const MARKETING_RATE = parseFloat(getEnvOrDie("MARKETING_RATE"));
const OTHER_RATE = parseFloat(getEnvOrDie("OTHER_RATE"));

interface ProjectHours {
  projectName: string;
  hours: number;
}

async function parseEnv(path: string) {
  return Object.fromEntries(
    (await readFile(path, "utf-8"))
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#"))
      .map((line) => line.split("=").map((s) => s.trim()))
  );
}

async function clockifyFetch<T>(endpoint: string, options: RequestInit = {}) {
  const res = await fetch(`https://api.clockify.me/api/v1${endpoint}`, {
    ...options,
    headers: {
      "X-Api-Key": API_KEY,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok)
    throw new Error(`Clockify API error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

function getMonthRange(month: string) {
  const [year, monthNum] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0)).toISOString(),
    end: new Date(Date.UTC(year, monthNum, 1, 0, 0, 0, 0)).toISOString(),
  };
}

function calculateHours(start: string, end: string) {
  return (new Date(end).getTime() - new Date(start).getTime()) / 3600000;
}

export async function getMonthlyHours(month: string): Promise<{
  hours: ProjectHours[];
  userId: string;
}> {
  const { start, end } = getMonthRange(month);
  console.log(`Fetching hours for ${month}...`);

  const user = await clockifyFetch<{ id: string; activeWorkspace: string }>(
    "/user"
  );
  const { id: userId, activeWorkspace: workspaceId } = user;
  console.log(`User: ${userId}, Workspace: ${workspaceId}`);

  const projects = await clockifyFetch<{ id: string; name: string }[]>(
    `/workspaces/${workspaceId}/projects`
  );

  // Fetch all time entries with pagination
  let allEntries: {
    timeInterval: { start: string; end: string; duration: string };
    projectId: string;
  }[] = [];
  let page = 1;
  const pageSize = 50;

  while (true) {
    const entries = await clockifyFetch<
      {
        timeInterval: { start: string; end: string; duration: string };
        projectId: string;
      }[]
    >(
      `/workspaces/${workspaceId}/user/${userId}/time-entries?start=${start}&end=${end}&page=${page}&page-size=${pageSize}`
    );

    allEntries = allEntries.concat(entries);
    console.log(`Fetched page ${page}: ${entries.length} entries`);

    if (entries.length < pageSize) {
      break; // Last page
    }
    page++;
  }

  const entries = allEntries;

  const projectMap = new Map(projects.map((p) => [p.id, p.name]));
  const startDate = new Date(start);
  const endDate = new Date(end);

  // Filter entries that overlap with the month (start OR end is in the range)
  const filteredEntries = entries.filter((e) => {
    const entryStart = new Date(e.timeInterval.start);
    const entryEnd = new Date(e.timeInterval.end);
    // Entry overlaps if it starts before month ends AND ends after month starts
    return entryStart < endDate && entryEnd > startDate;
  });

  console.log(`Found ${filteredEntries.length} time entries after filtering`);

  const hoursMap = new Map<string, number>();
  for (const entry of filteredEntries) {
    const projectName = entry.projectId
      ? projectMap.get(entry.projectId) ?? "Unknown Project"
      : "No Project";

    // Clamp the entry times to the month boundaries
    const entryStart = new Date(entry.timeInterval.start);
    const entryEnd = new Date(entry.timeInterval.end);
    const clampedStart =
      entryStart < startDate ? start : entry.timeInterval.start;
    const clampedEnd = entryEnd > endDate ? end : entry.timeInterval.end;

    const hours = calculateHours(clampedStart, clampedEnd);
    hoursMap.set(projectName, (hoursMap.get(projectName) ?? 0) + hours);
  }

  return {
    hours: Array.from(hoursMap, ([projectName, hours]) => ({
      projectName,
      hours,
    })),
    userId,
  };
}

function floor0(n: number): number {
  return Math.floor(n * 1) / 1;
}
function floor1(n: number): number {
  return Math.floor(n * 10) / 10;
}
function floor2(n: number): number {
  return Math.floor(n * 100) / 100;
}

function formatHMS(decimalHours: number): string {
  const totalSeconds = Math.floor(decimalHours * 3600);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")}`;
}

const NOW = new Date();
// previous month
const prevMonth = NOW.getMonth() === 0 ? 12 : NOW.getMonth();
const prevYear =
  NOW.getMonth() === 0 ? NOW.getFullYear() - 1 : NOW.getFullYear();
const monthStr = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
const { hours, userId } = await getMonthlyHours(monthStr);

console.log("\n=== Hours by Project ===");
hours.forEach(({ projectName, hours }) =>
  console.log(`${projectName}: ${hours.toFixed(2)} hours (${formatHMS(hours)})`)
);

// Categorize projects as marketing or other
function isMarketing(projectName: string): boolean {
  const marketingKeywords = ["marketing", "recruitment"];
  return marketingKeywords.some((keyword) =>
    projectName.toLowerCase().includes(keyword)
  );
}

let marketingHours = 0;
let otherHours = 0;

for (const { projectName, hours: h } of hours) {
  if (isMarketing(projectName)) {
    console.log(`  → ${projectName} categorized as marketing`);
    marketingHours += h;
  } else {
    console.log(`  → ${projectName} categorized as other`);
    otherHours += h;
  }
}

const marketingPrice = floor2(marketingHours * MARKETING_RATE);
const otherPrice = floor2(otherHours * OTHER_RATE);
const summary = marketingPrice + otherPrice;
const totalHours = marketingHours + otherHours;

console.log("\n=== Billing Summary ===");

console.log(
  `Marketing: ${floor2(marketingHours)}h @ ${MARKETING_RATE} HUF/h = ${floor2(
    marketingPrice
  )} HUF`
);
console.log(
  `Other: ${floor2(otherHours)}h @ ${OTHER_RATE} HUF/h = ${floor2(
    otherPrice
  )} HUF`
);
console.log(`\nTotal: ${summary.toFixed(0)} HUF (${totalHours.toFixed(1)}h)`);

const [year, monthNum] = monthStr.split("-").map(Number);
const start = new Date(
  Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0)
).toISOString();
const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate(); // Get last day of month in UTC
const end = new Date(
  Date.UTC(year, monthNum - 1, lastDay, 23, 59, 59, 999)
).toISOString();
const filterData = encodeURIComponent(JSON.stringify({ users: [userId] }));
const reportUrl = `https://app.clockify.me/reports/summary?start=${start}&end=${end}&filterValuesData=${filterData}`;
console.log("\nCheck here:", reportUrl);
