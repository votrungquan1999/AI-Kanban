import { describe, expect, it, vi } from "vitest";
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
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { createTaskAction, blockCard, stillBlockedCard } = await import(
  "./actions"
);

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
});

describe("stillBlockedCard", () => {
  it("re-enters Blocked (restarting the timer) and revalidates the board", async () => {
    await stillBlockedCard("card-2");

    expect(updateTaskStatus).toHaveBeenCalledWith("card-2", Status.Blocked, {
      caller: Caller.Ui,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});
