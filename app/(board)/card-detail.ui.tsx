"use client";

import { CopyIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useOptimistic } from "react";
import { type Card, Status } from "@/cards/card.type";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { formatRelativeAge } from "@/lib/relative-time";
import {
  BlockDurationPicker,
  DEFAULT_BLOCK_INTERVAL_MS,
} from "./block-duration-picker.ui";
import {
  CardEditProvider,
  useCardEditActions,
  useCardEditMode,
} from "./card-detail.state";
import { ArchiveControl, type DeleteAction } from "./card-detail-archive.ui";
import {
  CardEditForm,
  type EditAction,
  type EditPatch,
} from "./card-detail-edit.ui";
import {
  type MoveAction,
  STATUS_LABELS,
  StatusPicker,
} from "./card-detail-status.ui";
import { useCopyDispatch } from "./copy-dispatch.state";
import { boardHref } from "./href";

/**
 * Formats an ISO timestamp deterministically as `YYYY-MM-DD HH:mm` (UTC) so the
 * display is stable across locales and test environments.
 * @param iso - ISO 8601 timestamp string.
 */
function formatTimestamp(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

/**
 * A labelled detail row (small caption above the value).
 */
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm break-words text-foreground">{children}</span>
    </div>
  );
}

/**
 * Small icon button that copies a single field's raw value to the clipboard.
 * @param value - The exact value to copy.
 * @param label - Human label used for the aria-label and toast (e.g. "branch").
 */
function CopyField({ value, label }: { value: string; label: string }) {
  const { copy } = useCopyDispatch();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`Copy ${label}`}
      onClick={() => void copy(value, `Copied ${label}`)}
    >
      <CopyIcon />
    </Button>
  );
}

/**
 * A labelled row whose value can be copied via an inline icon button.
 */
function CopyableRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
      <DetailRow label={label}>{value}</DetailRow>
      <CopyField value={value} label={label.toLowerCase()} />
    </div>
  );
}

/**
 * Body listing everything that matters about a card. When `moveAction` is
 * provided the status row becomes a move picker; when `editAction` is provided
 * an Edit button reveals the inline edit form for title/description/priority.
 * When `blockAction`/`stillBlockedAction` are provided, the sheet offers the
 * matching quick action; a blocked card also shows a remaining-time hint
 * computed against `now` (injected in tests for determinism).
 */
function CardDetailBody({
  card,
  moveAction,
  editAction,
  deleteAction,
  blockAction,
  stillBlockedAction,
  defaultIntervalMs,
  now,
}: {
  card: Card;
  moveAction?: MoveAction;
  editAction?: EditAction;
  deleteAction?: DeleteAction;
  blockAction?: (cardId: string, intervalMs: number) => void;
  stillBlockedAction?: (cardId: string) => void;
  defaultIntervalMs?: number;
  now?: Date;
}) {
  const isEditing = useCardEditMode();
  const { startEdit } = useCardEditActions();

  // Reflect an edit immediately: the displayed card carries the patch while the
  // action is in flight, then resets to the revalidated server prop once it
  // lands. A blank description clears the field (optimistically too).
  const [optimisticCard, applyOptimistic] = useOptimistic(
    card,
    (current, patch: EditPatch) => ({
      ...current,
      ...patch,
      description: patch.description ? patch.description : undefined,
    }),
  );

  /**
   * Optimistically applies the patch, then persists it via the injected edit
   * action. Called from the edit form's React form action (a transition), which
   * is what makes the optimistic update valid.
   * @param cardId - The card's hex id.
   * @param patch - The edited fields.
   */
  async function handleSave(cardId: string, patch: EditPatch) {
    applyOptimistic(patch);
    await editAction?.(cardId, patch);
  }

  const isBlocked = optimisticCard.status === Status.Blocked;
  const canBlock =
    optimisticCard.status === Status.Todo ||
    optimisticCard.status === Status.InProgress ||
    optimisticCard.status === Status.NeedReview;
  const showBlock = Boolean(blockAction) && canBlock;
  const showStillBlocked = Boolean(stillBlockedAction) && isBlocked;

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{optimisticCard.title}</DrawerTitle>
        <DrawerDescription>#{optimisticCard.number}</DrawerDescription>
      </DrawerHeader>

      {moveAction ? (
        <StatusPicker card={optimisticCard} moveAction={moveAction} />
      ) : (
        <DetailRow label="Status">
          {STATUS_LABELS[optimisticCard.status]}
        </DetailRow>
      )}

      {isBlocked && optimisticCard.blockedUntil ? (
        <DetailRow label="Blocked">
          Auto-moves to Need Review{" "}
          {formatRelativeAge(optimisticCard.blockedUntil, now ?? new Date())}
        </DetailRow>
      ) : null}

      {showBlock || showStillBlocked ? (
        <div className="grid grid-flow-col justify-start gap-2">
          {showBlock && blockAction ? (
            <BlockDurationPicker
              cardId={card.id}
              defaultIntervalMs={defaultIntervalMs ?? DEFAULT_BLOCK_INTERVAL_MS}
              blockAction={blockAction}
            />
          ) : null}
          {showStillBlocked ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => stillBlockedAction?.(card.id)}
            >
              Reset timer
            </Button>
          ) : null}
        </div>
      ) : null}

      {isEditing && editAction ? (
        <CardEditForm card={optimisticCard} editAction={handleSave} />
      ) : (
        <>
          {optimisticCard.description ? (
            <DetailRow label="Description">
              {optimisticCard.description}
            </DetailRow>
          ) : null}
          <DetailRow label="Priority">P{optimisticCard.priority}</DetailRow>
          {editAction || deleteAction ? (
            <div className="grid grid-flow-col justify-start gap-2">
              {editAction ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={startEdit}
                >
                  Edit
                </Button>
              ) : null}
              {deleteAction ? (
                <ArchiveControl cardId={card.id} deleteAction={deleteAction} />
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <CopyableRow label="Card id" value={optimisticCard.id} />

      {card.repos.length > 0 ? (
        <div className="grid gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Repos
          </span>
          {card.repos.map((repo) => (
            <div
              key={repo.worktreePath}
              className="grid gap-1 rounded-md bg-muted/50 p-2 text-sm"
            >
              <span className="font-medium">{repo.repo}</span>
              <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                <span className="text-muted-foreground">{repo.branch}</span>
                <CopyField value={repo.branch} label="branch" />
              </div>
              <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                <span className="font-mono text-xs break-all text-muted-foreground">
                  {repo.worktreePath}
                </span>
                <CopyField value={repo.worktreePath} label="worktree path" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {card.workspacePath ? (
        <CopyableRow label="Workspace" value={card.workspacePath} />
      ) : null}

      <DetailRow label="Created">{formatTimestamp(card.createdAt)}</DetailRow>
      <DetailRow label="Updated">{formatTimestamp(card.updatedAt)}</DetailRow>
      {card.pickedAt ? (
        <DetailRow label="Picked">{formatTimestamp(card.pickedAt)}</DetailRow>
      ) : null}
      {card.finishedAt ? (
        <DetailRow label="Finished">
          {formatTimestamp(card.finishedAt)}
        </DetailRow>
      ) : null}
    </>
  );
}

/**
 * URL-driven card detail sheet (phone-first bottom drawer). Visibility is driven
 * by the `?card=<id>` URL param via `open`; dismissing it navigates back to the
 * board. When `moveAction`/`editAction`/`deleteAction` are injected, the sheet
 * also lets the operator move the card's column, edit its core fields inline,
 * and archive it (with confirmation).
 * @param card - The card to show, or null when none is selected.
 * @param open - Whether the sheet is shown.
 * @param moveAction - Optional server action to move the card's status.
 * @param editAction - Optional server action to edit the card's core fields.
 * @param deleteAction - Optional server action to archive the card.
 * @param blockAction - Optional action to block the card for a chosen interval.
 * @param stillBlockedAction - Optional action to restart a blocked card's clock.
 * @param defaultIntervalMs - Board default pre-filled into the block picker.
 * @param now - Reference time for the remaining-block hint (injected in tests).
 */
export function CardDetail({
  card,
  open,
  moveAction,
  editAction,
  deleteAction,
  blockAction,
  stillBlockedAction,
  defaultIntervalMs,
  now,
}: {
  card: Card | null;
  open: boolean;
  moveAction?: MoveAction;
  editAction?: EditAction;
  deleteAction?: DeleteAction;
  blockAction?: (cardId: string, intervalMs: number) => void;
  stillBlockedAction?: (cardId: string) => void;
  defaultIntervalMs?: number;
  now?: Date;
}) {
  const router = useRouter();

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      router.replace(boardHref());
    }
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent>
        {card ? (
          <CardEditProvider>
            <CardDetailBody
              card={card}
              moveAction={moveAction}
              editAction={editAction}
              deleteAction={deleteAction}
              blockAction={blockAction}
              stillBlockedAction={stillBlockedAction}
              defaultIntervalMs={defaultIntervalMs}
              now={now}
            />
          </CardEditProvider>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
