"use client";

import { Repeat } from "lucide-react";
import Link from "next/link";
import { type Card as CardData, OriginType, Status } from "@/cards/card.type";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatRelativeAge } from "@/lib/relative-time";
import { CopyDispatch } from "./copy-dispatch.ui";
import { cardDetailHref } from "./href";

/** Statuses from which a card may be sent to Blocked via the quick action. */
const BLOCKABLE_STATUSES: Status[] = [
  Status.Todo,
  Status.InProgress,
  Status.NeedReview,
];

/**
 * Renders a single card tile: number + copy control + priority on top, then the
 * title and (when present) a description preview, a primary repo·branch chip
 * (with a `+N` overflow count), a recurring marker, and a relative age. The
 * navigable areas are plain links around non-interactive content only, so the
 * copy control (a button/menu) is never nested inside an anchor.
 * @param card - The card to display.
 * @param now - Reference time for the relative age (defaults to render time;
 *   injected in tests for determinism).
 * @param blockAction - Optional action to send an active card to Blocked; when
 *   present a "Block" button shows on Todo/In Progress/Need Review tiles.
 * @param stillBlockedAction - Optional action to restart a blocked card's clock;
 *   when present a "Still Blocked" button shows only on Blocked tiles.
 */
export function CardTile({
  card,
  now,
  blockAction,
  stillBlockedAction,
}: {
  card: CardData;
  now?: Date;
  blockAction?: (cardId: string) => void;
  stillBlockedAction?: (cardId: string) => void;
}) {
  const reference = now ?? new Date();
  const ageSource = card.pickedAt ?? card.createdAt;
  const [primaryRepo] = card.repos;
  const extraRepoCount = card.repos.length - 1;
  const isRecurring = card.origin.type === OriginType.Recurring;
  const detailHref = cardDetailHref(card.id);
  const canBlock = BLOCKABLE_STATUSES.includes(card.status);
  const isBlocked = card.status === Status.Blocked;
  const showBlock = Boolean(blockAction) && canBlock;
  const showStillBlocked = Boolean(stillBlockedAction) && isBlocked;

  return (
    <Card className="grid gap-2 rounded-lg border-border bg-card p-3 shadow-sm transition-colors hover:border-ring">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-muted-foreground">
        <Link href={detailHref} className="hover:underline">
          #{card.number}
        </Link>
        <div className="grid grid-flow-col items-center gap-1">
          <CopyDispatch cardId={card.id} />
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
            P{card.priority}
          </span>
        </div>
      </div>

      <Link href={detailHref} className="grid gap-1.5">
        <span className="line-clamp-2 text-sm font-medium wrap-break-word text-card-foreground">
          {card.title}
        </span>

        {card.description ? (
          <span
            data-testid="tile-description"
            className="line-clamp-2 text-xs text-muted-foreground"
          >
            {card.description}
          </span>
        ) : null}

        <div className="grid grid-flow-col items-center justify-start gap-2 text-xs text-muted-foreground">
          {primaryRepo ? (
            <span
              data-testid="tile-repo"
              className="rounded bg-muted px-1.5 py-0.5"
            >
              {primaryRepo.repo}·{primaryRepo.branch}
              {extraRepoCount > 0 ? ` +${extraRepoCount}` : ""}
            </span>
          ) : null}
          {isRecurring ? (
            <span
              data-testid="tile-recurring"
              role="img"
              aria-label="Recurring"
              className="inline-grid place-items-center"
            >
              <Repeat className="size-3" />
            </span>
          ) : null}
          <span data-testid="tile-age">
            {formatRelativeAge(ageSource, reference)}
          </span>
        </div>
      </Link>

      {showBlock || showStillBlocked ? (
        <div className="grid grid-flow-col justify-start gap-1">
          {showBlock ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => blockAction?.(card.id)}
            >
              Block
            </Button>
          ) : null}
          {showStillBlocked ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => stillBlockedAction?.(card.id)}
            >
              Still Blocked
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
