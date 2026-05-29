import { listTasks } from "@/cards/card.service";
import { createTaskAction, moveCard } from "./(board)/actions";
import { AddTaskDialog } from "./(board)/add-task-dialog";
import { Board } from "./(board)/board";
import { groupIntoColumns } from "./(board)/board.columns";
import { BoardShell } from "./(board)/board-shell.ui";
import { newTaskHref } from "./(board)/href";

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
  const cards = await listTasks();

  return (
    <BoardShell title="AI Kanban" addTaskHref={newTaskHref()}>
      <Board columns={groupIntoColumns(cards)} moveAction={moveCard} />
      <AddTaskDialog open={isAddOpen} action={createTaskAction} />
    </BoardShell>
  );
}
