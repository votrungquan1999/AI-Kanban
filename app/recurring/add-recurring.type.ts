/** Result state of the add-recurring form action (kept out of the "use server" file). */
export interface AddRecurringState {
  error?: string;
}

/** Schedule preset selected in the add-recurring form; `Custom` reads everyHours. */
export enum ScheduleKind {
  Hourly = "hourly",
  Daily = "daily",
  Weekly = "weekly",
  Custom = "custom",
}
