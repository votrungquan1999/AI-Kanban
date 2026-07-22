import { Status } from "@/cards/card.type";

/** Who is requesting a card status change. */
export enum Caller {
  Ui = "ui",
  Scheduler = "scheduler",
  Agent = "agent",
  /**
   * Automatic, non-human, non-agent moves — currently the 2h Blocked→NeedReview
   * auto-advance done by the reconcile-on-read path. Audited distinctly so the
   * history shows "the system unblocked this," not a human or the agent. The
   * reconcile uses its own atomic compound-filter update (not the policy), so
   * `legalFromStatuses` keeps the safe default (no edges) for this caller.
   */
  System = "system",
}

/**
 * The source statuses from which `caller` may legally move a card, independent
 * of the target: UI and Agent → every status (any → any, full parity with a
 * human operator); any other caller → none.
 * @param caller - The requesting caller.
 * @param _to - The target status (unused now that every eligible caller is any → any; kept for call-site stability).
 * @returns The legal source statuses (empty if the move is not permitted).
 */
export function legalFromStatuses(caller: Caller, _to: Status): Status[] {
  if (caller === Caller.Ui || caller === Caller.Agent) {
    return Object.values(Status);
  }

  return [];
}
