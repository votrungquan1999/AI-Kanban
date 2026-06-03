/** Time divisions from finest to coarsest, used to pick a relative-age unit. */
const DIVISIONS: ReadonlyArray<{
  amount: number;
  unit: Intl.RelativeTimeFormatUnit;
}> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

/**
 * Formats an ISO timestamp as a human relative age (e.g. "2 days ago",
 * "3 hours ago") against an injected `now`, so callers stay deterministic and
 * testable. Picks the coarsest unit whose magnitude is below 1.
 * @param iso - The ISO 8601 timestamp to describe.
 * @param now - The reference "current" time.
 * @returns The relative age phrase.
 */
export function formatRelativeAge(iso: string, now: Date): string {
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  let duration = (new Date(iso).getTime() - now.getTime()) / 1000;

  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }

  return formatter.format(Math.round(duration), "year");
}
