import { beforeEach, describe, expect, it, vi } from "vitest";
import { OriginType, Status } from "@/cards/card.type";
import { Caller } from "@/cards/transition-policy";

const { createTask, updateTaskStatus } = vi.hoisted(() => ({
  createTask: vi.fn(async () => ({})),
  updateTaskStatus: vi.fn(async () => ({})),
}));

vi.mock("@/cards/card.service", () => ({
  createTask,
  updateTaskStatus,
}));
const { updateDefaultBlockInterval } = vi.hoisted(() => ({
  updateDefaultBlockInterval: vi.fn(async () => 0),
}));
vi.mock("@/settings/settings.service", () => ({ updateDefaultBlockInterval }));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const {
  createTaskAction,
  blockCard,
  stillBlockedCard,
  updateDefaultIntervalAction,
} = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createTaskAction", () => {
  it("forwards the selected P0–P3 priority to createTask", async () => {
    // Given a submission carrying a chosen priority
    const formData = new FormData();
    formData.set("title", "Pick me");
    formData.set("priority", "2");

    // When the action runs
    await createTaskAction({}, formData);

    // Then the card is created at that priority (not dropped to the default)
    expect(createTask).toHaveBeenCalledWith({
      title: "Pick me",
      origin: { type: OriginType.Manual },
      priority: 2,
    });
  });
});

describe("blockCard", () => {
  it("moves the card into Blocked as the UI caller and revalidates the board", async () => {
    await blockCard("card-1");

    expect(updateTaskStatus).toHaveBeenCalledWith("card-1", Status.Blocked, {
      caller: Caller.Ui,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("forwards the chosen block interval to updateTaskStatus", async () => {
    await blockCard("card-3", 3_600_000);

    expect(updateTaskStatus).toHaveBeenCalledWith("card-3", Status.Blocked, {
      caller: Caller.Ui,
      intervalMs: 3_600_000,
    });
  });
});

describe("updateDefaultIntervalAction", () => {
  it("persists the new board default interval and revalidates the board", async () => {
    await updateDefaultIntervalAction(4 * 60 * 60 * 1000);

    expect(updateDefaultBlockInterval).toHaveBeenCalledWith(4 * 60 * 60 * 1000);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});

describe("stillBlockedCard", () => {
  it("re-enters Blocked without an interval (so the service replays the card's own) and revalidates", async () => {
    await stillBlockedCard("card-2");

    // Re-enters Blocked with exactly { caller } and NO intervalMs key — the
    // contrast with blockCard: the service then replays the card's stored
    // interval rather than a new one. (A real intervalMs would fail this exact
    // match, distinguishing reset from block.)
    expect(updateTaskStatus).toHaveBeenCalledWith("card-2", Status.Blocked, {
      caller: Caller.Ui,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});
