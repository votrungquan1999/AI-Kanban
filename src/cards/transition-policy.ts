/** Who is requesting a card status change. */
export enum Caller {
  Ui = "ui",
  Scheduler = "scheduler",
  Agent = "agent",
}

/**
 * Whether `caller` may change a card's status. The human UI may move a card to
 * any column (the drag/override escape hatch); programmatic callers
 * (scheduler/agent) are constrained in a later slice — this is the seam.
 * @param caller - The requesting caller.
 * @returns True if the status change is permitted.
 */
export function canTransition(caller: Caller): boolean {
  return caller === Caller.Ui;
}
