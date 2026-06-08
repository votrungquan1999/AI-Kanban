/** The locked preset intervals (in hours) that get a single-word label. */
const HOURLY = 1;
const DAILY = 24;
const WEEKLY = 168;

/**
 * Formats a recurring task's interval (`everyHours`) as a human schedule label.
 * The three locked presets read as words; any other value falls back to an
 * explicit "Every N hours" phrase.
 * @param everyHours - The interval between runs, in hours.
 * @returns The display label for the schedule.
 */
export function formatSchedule(everyHours: number): string {
  if (everyHours === HOURLY) {
    return "Hourly";
  }
  if (everyHours === DAILY) {
    return "Daily";
  }
  if (everyHours === WEEKLY) {
    return "Weekly";
  }
  return `Every ${everyHours} hours`;
}
