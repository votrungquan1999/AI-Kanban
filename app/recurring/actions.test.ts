import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRecurringTask, setFixNote, resetToDue, revalidatePath } =
  vi.hoisted(() => ({
    createRecurringTask: vi.fn(async () => ({})),
    setFixNote: vi.fn(async () => ({})),
    resetToDue: vi.fn(async () => ({})),
    revalidatePath: vi.fn(),
  }));

vi.mock("@/recurring/recurring.service", () => ({ createRecurringTask }));
vi.mock("@/recurring/recurring.fix.service", () => ({
  setFixNote,
  resetToDue,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { createRecurringTaskAction, setFixNoteAction, resetToDueAction } =
  await import("./actions");

describe("createRecurringTaskAction", () => {
  beforeEach(() => {
    createRecurringTask.mockClear();
  });

  it("maps the daily preset to everyHours=24 and creates the task", async () => {
    // Given a submission choosing the daily preset
    const formData = new FormData();
    formData.set("title", "Nightly digest");
    formData.set("instruction", "Summarise the day");
    formData.set("scheduleKind", "daily");

    // When the action runs
    await createRecurringTaskAction({}, formData);

    // Then the preset is resolved to 24h server-side
    expect(createRecurringTask).toHaveBeenCalledWith({
      title: "Nightly digest",
      instruction: "Summarise the day",
      everyHours: 24,
    });
  });

  it("reads the numeric everyHours field for the custom preset", async () => {
    // Given a submission choosing custom with an explicit interval
    const formData = new FormData();
    formData.set("title", "Every six hours");
    formData.set("instruction", "Check the queue");
    formData.set("scheduleKind", "custom");
    formData.set("everyHours", "6");

    // When the action runs
    await createRecurringTaskAction({}, formData);

    // Then the custom numeric value is forwarded (not a preset)
    expect(createRecurringTask).toHaveBeenCalledWith({
      title: "Every six hours",
      instruction: "Check the queue",
      everyHours: 6,
    });
  });

  it("rejects a custom interval that is not a positive integer", async () => {
    // Given a custom selection with an empty numeric field
    const formData = new FormData();
    formData.set("title", "Bad interval");
    formData.set("instruction", "Should not run");
    formData.set("scheduleKind", "custom");
    formData.set("everyHours", "");

    // When the action runs
    const result = await createRecurringTaskAction({}, formData);

    // Then it surfaces a validation error and never creates the task
    expect(result.error).toBe("everyHours must be positive");
    expect(createRecurringTask).not.toHaveBeenCalled();
  });
});

describe("setFixNoteAction", () => {
  beforeEach(() => {
    setFixNote.mockClear();
    revalidatePath.mockClear();
  });

  it("records the fix note and revalidates the recurring surface", async () => {
    // When the action records a note for a failed task
    await setFixNoteAction("0123456789abcdef01234567", "rotate the token");

    // Then it calls the service with the note and revalidates "/recurring"
    expect(setFixNote).toHaveBeenCalledWith("0123456789abcdef01234567", {
      note: "rotate the token",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/recurring");
  });
});

describe("resetToDueAction", () => {
  beforeEach(() => {
    resetToDue.mockClear();
    revalidatePath.mockClear();
  });

  it("resets the task to due and revalidates the recurring surface", async () => {
    // When the action resets a failed task
    await resetToDueAction("0123456789abcdef01234567");

    // Then it calls the service and revalidates "/recurring"
    expect(resetToDue).toHaveBeenCalledWith("0123456789abcdef01234567");
    expect(revalidatePath).toHaveBeenCalledWith("/recurring");
  });
});
