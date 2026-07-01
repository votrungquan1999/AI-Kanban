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
 * The agent's legal `(from → to)` lifecycle edges. The human UI is
 * unconstrained (any → any); the scheduler has no agent-exposed edge in this
 * slice. Used to enforce moves atomically (the from-set feeds a `$in` filter).
 */
const AGENT_EDGES: ReadonlyArray<readonly [Status, Status]> = [
  [Status.InProgress, Status.NeedReview],
  [Status.InProgress, Status.Done],
  [Status.NeedReview, Status.InProgress],
  [Status.NeedReview, Status.Done],
  // A resumed session reclaims its parked card out of Staled.
  [Status.Staled, Status.InProgress],
];

/**
 * The source statuses from which `caller` may legally move a card to `to`.
 * UI → every status (any → any). Agent → only the from-statuses of its legal
 * edges into `to` (possibly empty, e.g. `to = todo`). Any other caller → none.
 * @param caller - The requesting caller.
 * @param to - The target status.
 * @returns The legal source statuses (empty if the move is not permitted).
 */
export function legalFromStatuses(caller: Caller, to: Status): Status[] {
  if (caller === Caller.Ui) {
    return Object.values(Status);
  }

  if (caller === Caller.Agent) {
    return AGENT_EDGES.filter(([, target]) => target === to).map(
      ([from]) => from,
    );
  }

  return [];
}
