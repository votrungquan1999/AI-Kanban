import { describe, expect, it, vi } from "vitest";
import { OriginType } from "@/cards/card.type";

const { createTask } = vi.hoisted(() => ({
  createTask: vi.fn(async () => ({})),
}));

vi.mock("@/cards/card.service", () => ({
  createTask,
  updateTaskStatus: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { createTaskAction } = await import("./actions");

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
