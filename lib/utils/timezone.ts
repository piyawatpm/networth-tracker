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
