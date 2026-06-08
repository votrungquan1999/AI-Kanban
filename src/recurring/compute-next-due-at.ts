const MS_PER_HOUR = 3_600_000;

/**
 * Computes the next due time by rolling a reference time forward by a whole
 * number of hours. Pure and total (no clamping/validation — `everyHours` is
 * validated at the input-schema boundary); the reference `from` is not mutated.
 * @param everyHours - The interval in hours to advance by.
 * @param from - The reference time to roll forward from.
 * @returns A new `Date` `everyHours` hours after `from`.
 */
export function computeNextDueAt(everyHours: number, from: Date): Date {
  return new Date(from.getTime() + everyHours * MS_PER_HOUR);
}
