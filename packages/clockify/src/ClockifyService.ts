export interface ClockifyConfig {
  apiKey: string;
  defaultRate: number;
  rateOverrides?: Array<{ keywords: string[]; rate: number }>;
}

export interface ProjectHours {
  projectName: string;
  hours: number;
}

export interface MonthlyReport {
  hours: ProjectHours[];
  userId: string;
}

export interface BillingSummary {
  categories: Array<{ name: string; hours: number; rate: number; price: number }>;
  totalPrice: number;
  totalHours: number;
  reportUrl: string;
}

export class ClockifyService {
  constructor(private _config: ClockifyConfig) {}

  private async _fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`https://api.clockify.me/api/v1${endpoint}`, {
      ...options,
      headers: {
        "X-Api-Key": this._config.apiKey,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (!res.ok)
      throw new Error(`Clockify API error: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async getMonthlyHours(month: string): Promise<MonthlyReport> {
    const [year, monthNum] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0)).toISOString();
    const end = new Date(Date.UTC(year, monthNum, 1, 0, 0, 0, 0)).toISOString();

    const user = await this._fetch<{ id: string; activeWorkspace: string }>("/user");
    const { id: userId, activeWorkspace: workspaceId } = user;

    const projects = await this._fetch<{ id: string; name: string }[]>(
      `/workspaces/${workspaceId}/projects`
    );

    let allEntries: {
      timeInterval: { start: string; end: string; duration: string };
      projectId: string;
    }[] = [];
    let page = 1;
    const pageSize = 50;

    while (true) {
      const entries = await this._fetch<typeof allEntries>(
        `/workspaces/${workspaceId}/user/${userId}/time-entries?start=${start}&end=${end}&page=${page}&page-size=${pageSize}`
      );
      allEntries = allEntries.concat(entries);
      if (entries.length < pageSize) break;
      page++;
    }

    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const startDate = new Date(start);
    const endDate = new Date(end);

    const filteredEntries = allEntries.filter((e) => {
      const entryStart = new Date(e.timeInterval.start);
      const entryEnd = new Date(e.timeInterval.end);
      return entryStart < endDate && entryEnd > startDate;
    });

    const hoursMap = new Map<string, number>();
    for (const entry of filteredEntries) {
      const projectName = entry.projectId
        ? projectMap.get(entry.projectId) ?? "Unknown Project"
        : "No Project";

      const entryStart = new Date(entry.timeInterval.start);
      const entryEnd = new Date(entry.timeInterval.end);
      const clampedStart = entryStart < startDate ? start : entry.timeInterval.start;
      const clampedEnd = entryEnd > endDate ? end : entry.timeInterval.end;

      const hours = (new Date(clampedEnd).getTime() - new Date(clampedStart).getTime()) / 3600000;
      hoursMap.set(projectName, (hoursMap.get(projectName) ?? 0) + hours);
    }

    return {
      hours: Array.from(hoursMap, ([projectName, hours]) => ({ projectName, hours })),
      userId,
    };
  }

  getBillingSummary(report: MonthlyReport, month: string): BillingSummary {
    const overrides = this._config.rateOverrides ?? [];
    const rateGroups = new Map<number, { hours: number; names: Set<string> }>();

    for (const { projectName, hours } of report.hours) {
      const override = overrides.find((o) =>
        o.keywords.some((kw) => projectName.toLowerCase().includes(kw.toLowerCase()))
      );
      const rate = override ? override.rate : this._config.defaultRate;

      const group = rateGroups.get(rate) ?? { hours: 0, names: new Set<string>() };
      group.hours += hours;
      group.names.add(projectName);
      rateGroups.set(rate, group);
    }

    const categories: BillingSummary["categories"] = [];
    for (const [rate, { hours, names }] of rateGroups) {
      const name = names.size <= 2 ? Array.from(names).join(", ") : `${names.size} projects`;
      const price = Math.floor(hours * rate * 100) / 100;
      categories.push({ name, hours, rate, price });
    }

    const totalPrice = categories.reduce((sum, c) => sum + c.price, 0);
    const totalHours = categories.reduce((sum, c) => sum + c.hours, 0);

    const [year, monthNum] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0)).toISOString();
    const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    const end = new Date(Date.UTC(year, monthNum - 1, lastDay, 23, 59, 59, 999)).toISOString();
    const filterData = encodeURIComponent(JSON.stringify({ users: [report.userId] }));
    const reportUrl = `https://app.clockify.me/reports/summary?start=${start}&end=${end}&filterValuesData=${filterData}`;

    return { categories, totalPrice, totalHours, reportUrl };
  }
}
