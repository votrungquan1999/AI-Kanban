/** Link to the recurring surface (also closes the add-recurring dialog). */
export function recurringHref(): string {
  return "/recurring";
}

/** Link that opens the add-recurring dialog via URL state. */
export function newRecurringHref(): string {
  return "/recurring?new=task";
}

/** Link that opens a recurring task's detail sheet via URL state. */
export function recurringDetailHref(taskId: string): string {
  return `/recurring?task=${taskId}`;
}
