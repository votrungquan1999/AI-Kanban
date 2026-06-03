"use client";

import { Repeat } from "lucide-react";
import Link from "next/link";
import { type Card as CardData, OriginType } from "@/cards/card.type";
import { Card } from "@/components/ui/card";
import { formatRelativeAge } from "@/lib/relative-time";
import { CopyDispatch } from "./copy-dispatch.ui";
import { cardDetailHref } from "./href";

/**
 * Renders a single card tile: number + copy control + priority on top, then the
 * title and (when present) a description preview, a primary repo·branch chip
 * (with a `+N` overflow count), a recurring marker, and a relative age. The
 * navigable areas are plain links around non-interactive content only, so the
 * copy control (a button/menu) is never nested inside an anchor.
 * @param card - The card to display.
 * @param now - Reference time for the relative age (defaults to render time;
 *   injected in tests for determinism).
 */
export function CardTile({ card, now }: { card: CardData; now?: Date }) {
  const reference = now ?? new Date();
  const ageSource = card.pickedAt ?? card.createdAt;
  const [primaryRepo] = card.repos;
  const extraRepoCount = card.repos.length - 1;
  const isRecurring = card.origin.type === OriginType.Recurring;
  const detailHref = cardDetailHref(card.id);

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
        <span className="text-sm font-medium text-card-foreground">
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
    </Card>
  );
}
