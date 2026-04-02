const SYDNEY_TZ = "Australia/Sydney";

export function getSydneyDateString(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SYDNEY_TZ });
}

export function sydneyDateToTimestamp(dateStr: string): number {
  // Create a date at noon Sydney time to avoid DST edge cases
  const [year, month, day] = dateStr.split("-").map(Number);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // Build a date object for noon in Sydney
  const target = new Date(year, month - 1, day, 12, 0, 0);
  const parts = formatter.formatToParts(target);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "0";

  // If the formatted date matches, we're good
  const sydneyDay = parseInt(get("day"), 10);
  if (sydneyDay === day) {
    return Math.floor(target.getTime() / 1000);
  }

  // Adjust by ±1 hour until we match
  const adjusted = new Date(target.getTime() + (sydneyDay < day ? 3600000 : -3600000));
  return Math.floor(adjusted.getTime() / 1000);
}

export function timestampToSydneyDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-CA", {
    timeZone: SYDNEY_TZ,
  });
}

export function formatSydneyDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-AU", {
    timeZone: SYDNEY_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateString(dateStr: string): string {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

export function getYearKey(dateStr: string): string {
  return dateStr.slice(0, 4);
}

export function getCurrentMonthKey(): string {
  return getSydneyDateString().slice(0, 7);
}

export function getLastMonthKey(): string {
  const today = getSydneyDateString();
  const [year, month] = today.split("-").map(Number);
  const lastMonth = month === 1 ? 12 : month - 1;
  const lastYear = month === 1 ? year - 1 : year;
  return `${lastYear}-${String(lastMonth).padStart(2, "0")}`;
}

export function getCurrentYearKey(): string {
  return getSydneyDateString().slice(0, 4);
}

export function getLast6MonthKeys(): string[] {
  const today = getSydneyDateString();
  const [year, month] = today.split("-").map(Number);
  const keys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    let m = month - i;
    let y = year;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return keys;
}

export function monthKeyToLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1);
  return date.toLocaleDateString("en-AU", { month: "short" });
}

/** Get the number of days in a given YYYY-MM month key */
export function getDaysInMonth(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

/** Get today's day-of-month in Sydney timezone (1-based) */
export function getSydneyDayOfMonth(): number {
  const dateStr = getSydneyDateString(); // YYYY-MM-DD
  return parseInt(dateStr.split("-")[2], 10);
}

/** Get start and end date strings for a given month key (YYYY-MM) */
export function getMonthDateRange(monthKey: string): { from: string; to: string } {
  const days = getDaysInMonth(monthKey);
  return {
    from: `${monthKey}-01`,
    to: `${monthKey}-${String(days).padStart(2, "0")}`,
  };
}

/** Get all month keys that have data, sorted newest first */
export function getMonthKeysFromEntries(entries: { date: string }[]): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    if (e.date) set.add(e.date.slice(0, 7));
  }
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

/** Get last N month keys from current month (inclusive), ordered oldest→newest */
export function getLastNMonthKeys(n: number): string[] {
  const today = getSydneyDateString();
  const [year, month] = today.split("-").map(Number);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    let m = month - i;
    let y = year;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return keys;
}

/** Get YYYY-MM-DD for the first day of the current year (Sydney) */
export function getYTDStartDate(): string {
  return `${getCurrentYearKey()}-01-01`;
}

/** Format a month key (YYYY-MM) to "Mar 2026" format */
export function monthKeyToFullLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1);
  return date.toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}

/** Compute occurrence dates for a recurring expense between two dates */
export function computeOccurrences(
  startDate: string,
  frequency: "weekly" | "fortnightly" | "monthly" | "yearly",
  fromDate: string,
  toDate: string,
): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd);
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const from = new Date(fy, fm - 1, fd);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const to = new Date(ty, tm - 1, td);

  if (frequency === "weekly" || frequency === "fortnightly") {
    const stepDays = frequency === "weekly" ? 7 : 14;
    const current = new Date(start);
    // Advance to the first occurrence on or after fromDate
    while (current < from) {
      current.setDate(current.getDate() + stepDays);
    }
    while (current <= to) {
      dates.push(formatToDateString(current));
      current.setDate(current.getDate() + stepDays);
    }
  } else if (frequency === "monthly") {
    const targetDay = sd;
    let y = from.getFullYear();
    let m = from.getMonth(); // 0-based
    // Start from the month of startDate if it's after fromDate's month
    if (new Date(sy, sm - 1, 1) > from) {
      y = sy;
      m = sm - 1;
    }
    while (true) {
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const day = Math.min(targetDay, daysInMonth);
      const candidate = new Date(y, m, day);
      if (candidate > to) break;
      if (candidate >= from && candidate >= start) {
        dates.push(formatToDateString(candidate));
      }
      m++;
      if (m > 11) { m = 0; y++; }
    }
  } else if (frequency === "yearly") {
    const targetMonth = sm - 1;
    const targetDay = sd;
    let y = from.getFullYear();
    if (new Date(y, targetMonth, targetDay) < from) y++;
    while (true) {
      const daysInMonth = new Date(y, targetMonth + 1, 0).getDate();
      const day = Math.min(targetDay, daysInMonth);
      const candidate = new Date(y, targetMonth, day);
      if (candidate > to) break;
      if (candidate >= start) {
        dates.push(formatToDateString(candidate));
      }
      y++;
    }
  }

  return dates;
}

function formatToDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
