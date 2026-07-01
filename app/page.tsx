import { reconcileBlockedCards } from "@/cards/card.blocked.service";
import { getTask, listTasks } from "@/cards/card.service";
import { reconcileStaledCards } from "@/cards/card.staled.service";
import type { Card } from "@/cards/card.type";
import { getDefaultBlockInterval } from "@/settings/settings.service";
import {
  blockCard,
  createTaskAction,
  deleteTaskAction,
  moveCard,
  stillBlockedCard,
  updateDefaultIntervalAction,
  updateTaskAction,
} from "./(board)/actions";
import { AddTaskDialog } from "./(board)/add-task-dialog";
import { Board } from "./(board)/board";
import { groupIntoColumns } from "./(board)/board.columns";
import { BoardAutoRefresh } from "./(board)/board-auto-refresh.ui";
import { BoardShell } from "./(board)/board-shell.ui";
import { CardDetail } from "./(board)/card-detail.ui";
import { newTaskHref } from "./(board)/href";

/**
 * Resolves the `?card=<id>` param into a card. Returns null for an absent,
 * malformed, or unknown id (getTask throws on those) so a bad URL just shows
 * the board with no sheet instead of crashing it.
 * @param cardId - The raw `?card` search param value.
 */
async function resolveDetailCard(
  cardId: string | string[] | undefined,
): Promise<Card | null> {
  if (typeof cardId !== "string") {
    return null;
  }
  try {
    return await getTask(cardId);
  } catch {
    return null;
  }
}

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Board home page: reads all cards, renders the four columns, and wires the
 * add-task dialog whose open state is driven by the `?new=task` URL param.
 * @param searchParams - Next.js search params (async).
 */
export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const isAddOpen = params.new === "task";
  // Persist-on-read auto-moves before listing, so they reflect on this load and
  // every 5-min refresh: overdue Blocked cards advance to Need Review, and
  // in-progress cards idle past 3h are parked in Staled.
  await reconcileBlockedCards();
  await reconcileStaledCards();
  const cards = await listTasks();
  const detailCard = await resolveDetailCard(params.card);
  const defaultIntervalMs = await getDefaultBlockInterval();

  return (
    <BoardShell
      title="AI Kanban"
      addTaskHref={newTaskHref()}
      defaultIntervalMs={defaultIntervalMs}
      updateDefaultIntervalAction={updateDefaultIntervalAction}
    >
      <BoardAutoRefresh />
      <Board
        columns={groupIntoColumns(cards)}
        moveAction={moveCard}
        blockAction={blockCard}
        stillBlockedAction={stillBlockedCard}
        defaultIntervalMs={defaultIntervalMs}
      />
      <AddTaskDialog open={isAddOpen} action={createTaskAction} />
      <CardDetail
        card={detailCard}
        open={Boolean(detailCard)}
        moveAction={moveCard}
        editAction={updateTaskAction}
        deleteAction={deleteTaskAction}
        blockAction={blockCard}
        stillBlockedAction={stillBlockedCard}
        defaultIntervalMs={defaultIntervalMs}
      />
    </BoardShell>
  );
}
