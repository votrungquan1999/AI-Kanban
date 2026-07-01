// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Card, OriginType, Status } from "@/cards/card.type";
import { ToastProvider } from "@/components/ui/toast";
import { CardDetail } from "./card-detail.ui";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

const card: Card = {
  id: "0123456789abcdef01234567",
  number: 7,
  title: "Wire the dispatch board",
  description: "Make the copy control work on touch",
  status: Status.InProgress,
  priority: 2,
  origin: { type: OriginType.Manual },
  createdAt: "2026-01-01T08:30:00.000Z",
  updatedAt: "2026-01-02T09:00:00.000Z",
  pickedAt: null,
  finishedAt: null,
  blockedUntil: null,
  blockInterval: null,
  workspacePath: "/work/card-7",
  repos: [
    {
      repo: "ai-kanban",
      branch: "aikanban/card-7",
      worktreePath: "/work/card-7/ai-kanban",
    },
  ],
  tags: [],
  sessionId: null,
  progress: [],
};

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

/**
 * Renders the detail sheet inside the toast provider it depends on.
 */
function renderDetail(props: {
  card: Card | null;
  open: boolean;
  moveAction?: (cardId: string, status: Status) => Promise<void>;
  editAction?: (
    cardId: string,
    patch: { title?: string; description?: string; priority?: number },
  ) => Promise<void>;
  deleteAction?: (cardId: string) => Promise<void>;
  blockAction?: (cardId: string, intervalMs: number) => void;
  stillBlockedAction?: (cardId: string) => void;
  now?: Date;
}) {
  return render(
    <ToastProvider>
      <CardDetail {...props} />
    </ToastProvider>,
  );
}

/**
 * Installs a fake clipboard whose `writeText` can be asserted on.
 */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

afterEach(() => {
  replace.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    ...(originalClipboard ?? { value: undefined }),
    configurable: true,
  });
  vi.restoreAllMocks();
});

describe("CardDetail", () => {
  it("shows the card's full details when open", async () => {
    renderDetail({ card, open: true });

    // Title + description
    expect(
      await screen.findByText("Wire the dispatch board"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Make the copy control work on touch"),
    ).toBeInTheDocument();

    // Status (human-readable)
    expect(screen.getByText(/in.?progress/i)).toBeInTheDocument();

    // Repo · branch · worktree path
    expect(screen.getByText("aikanban/card-7")).toBeInTheDocument();
    expect(screen.getByText("/work/card-7/ai-kanban")).toBeInTheDocument();
  });

  it("returns to the board when the sheet is closed", async () => {
    renderDetail({ card, open: true });

    await userEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(replace).toHaveBeenCalledWith("/");
  });

  it("copies an individual field's raw value from its copy icon", async () => {
    const writeText = stubClipboard();
    renderDetail({ card, open: true });

    // When the operator taps the branch's copy icon
    await userEvent.click(
      await screen.findByRole("button", { name: /copy branch/i }),
    );

    // Then just that field's raw value lands on the clipboard
    expect(writeText).toHaveBeenCalledWith("aikanban/card-7");
  });

  it("shows a copyable resume command when the card has a session handle", async () => {
    const writeText = stubClipboard();
    const sessionCard: Card = { ...card, sessionId: "abc-123-session-id" };
    renderDetail({ card: sessionCard, open: true });

    // The resume command row is visible with the session handle baked in
    expect(
      await screen.findByText("claude --resume abc-123-session-id"),
    ).toBeInTheDocument();

    // Tapping its copy icon puts the full command on the clipboard
    await userEvent.click(
      screen.getByRole("button", { name: /copy resume command/i }),
    );
    expect(writeText).toHaveBeenCalledWith(
      "claude --resume abc-123-session-id",
    );
  });

  it("hides the resume command row when the card has no session handle", async () => {
    // The base fixture has sessionId: null
    renderDetail({ card, open: true });

    await screen.findByText("Wire the dispatch board");
    expect(screen.queryByText(/claude --resume/i)).not.toBeInTheDocument();
  });

  it("shows the labels when the card has tags", async () => {
    const taggedCard: Card = { ...card, tags: ["feature", "backend"] };
    renderDetail({ card: taggedCard, open: true });

    // The Tags row appears with the labels listed
    expect(await screen.findByText("Tags")).toBeInTheDocument();
    expect(screen.getByText("feature, backend")).toBeInTheDocument();
  });

  it("hides the tags row when the card has no labels", async () => {
    // The base fixture has tags: []
    renderDetail({ card, open: true });

    await screen.findByText("Wire the dispatch board");
    expect(screen.queryByText("Tags")).not.toBeInTheDocument();
  });

  it("saves edited title/description/priority via the edit action", async () => {
    const editAction = vi.fn(async () => {});
    renderDetail({ card, open: true, editAction });

    // When the operator enters edit mode, changes the title, and saves
    await userEvent.click(await screen.findByRole("button", { name: /edit/i }));
    const titleInput = await screen.findByLabelText(/^title$/i);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Edited title");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    // Then the edit action is called with the full field patch
    expect(editAction).toHaveBeenCalledWith(card.id, {
      title: "Edited title",
      description: "Make the copy control work on touch",
      priority: 2,
    });
  });

  it("optimistically reflects the edited title while the save is in flight", async () => {
    // Given an edit action we hold open (the save stays pending)
    let resolveSave: (() => void) | undefined;
    const editAction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    renderDetail({ card, open: true, editAction });

    // When the operator renames the card and saves
    await userEvent.click(await screen.findByRole("button", { name: /edit/i }));
    const titleInput = await screen.findByLabelText(/^title$/i);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Optimistic title");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    // Then the sheet header shows the new title before the action resolves
    expect(
      await screen.findByRole("heading", { name: "Optimistic title" }),
    ).toBeInTheDocument();
    resolveSave?.();
  });

  it("discards edits and calls nothing when the edit form is cancelled", async () => {
    const editAction = vi.fn(async () => {});
    renderDetail({ card, open: true, editAction });

    // When the operator enters edit mode, types, then cancels
    await userEvent.click(await screen.findByRole("button", { name: /edit/i }));
    await userEvent.type(
      await screen.findByLabelText(/^title$/i),
      " scratch edit",
    );
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Then nothing is persisted and the read-only view (Edit button) returns
    expect(editAction).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: /edit/i }),
    ).toBeInTheDocument();
  });

  it("archives the card and closes the sheet after confirmation", async () => {
    const deleteAction = vi.fn(async () => {});
    renderDetail({ card, open: true, deleteAction });

    // When the operator opens the archive confirm and confirms
    await userEvent.click(
      await screen.findByRole("button", { name: "Archive" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Archive card" }),
    );

    // Then the card is archived and the sheet closes back to the board
    expect(deleteAction).toHaveBeenCalledWith(card.id);
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("does not archive when the confirmation is cancelled", async () => {
    const deleteAction = vi.fn(async () => {});
    renderDetail({ card, open: true, deleteAction });

    // When the operator opens the archive confirm but cancels
    await userEvent.click(
      await screen.findByRole("button", { name: "Archive" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Then nothing is archived
    expect(deleteAction).not.toHaveBeenCalled();
  });

  it("moves the card to a chosen column from the sheet", async () => {
    const moveAction = vi.fn(async () => {});
    renderDetail({ card, open: true, moveAction });

    // When the operator opens the move picker and chooses a different column
    await userEvent.click(
      await screen.findByRole("combobox", { name: /move to column/i }),
    );
    await userEvent.click(await screen.findByRole("option", { name: "Done" }));

    // Then the card is moved to that column
    expect(moveAction).toHaveBeenCalledWith(card.id, Status.Done);
  });

  it("shows the remaining time and a Reset timer action for a blocked card", async () => {
    const stillBlockedAction = vi.fn();
    const now = new Date("2026-01-02T10:00:00.000Z");
    const blockedCard: Card = {
      ...card,
      status: Status.Blocked,
      blockedUntil: "2026-01-02T12:00:00.000Z", // 2 hours after `now`
    };
    renderDetail({ card: blockedCard, open: true, stillBlockedAction, now });

    // The sheet tells the operator when it will auto-move
    expect(await screen.findByText(/auto-moves/i)).toHaveTextContent(
      /in 2 hours/i,
    );

    // and the Reset timer action restarts the clock
    await userEvent.click(
      await screen.findByRole("button", { name: /reset timer/i }),
    );
    expect(stillBlockedAction).toHaveBeenCalledWith(blockedCard.id);
  });
});
