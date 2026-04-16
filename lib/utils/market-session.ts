export type MarketSession = "PRE" | "REGULAR" | "POST" | "CLOSED" | "WEEKEND";

/**
 * Classify the US equity session at a given instant.
 * Uses America/New_York wall time so DST is handled automatically.
 */
export function getUsMarketSession(now = new Date()): MarketSession {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  const mins = hour * 60 + minute;

  if (weekday === "Sat" || weekday === "Sun") return "WEEKEND";
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return "PRE";
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return "REGULAR";
  if (mins >= 16 * 60 && mins < 20 * 60) return "POST";
  return "CLOSED";
}

/** Polling cadence (ms) appropriate for the given session. */
export function pollIntervalForSession(session: MarketSession): number {
  switch (session) {
    case "REGULAR":
      return 30_000;
    case "PRE":
    case "POST":
      return 30_000;
    case "CLOSED":
      return 10 * 60_000;
    case "WEEKEND":
      return 30 * 60_000;
  }
}
