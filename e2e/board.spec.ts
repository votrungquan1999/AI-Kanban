import { expect, test } from "@playwright/test";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
const E2E_DB = "ai_kanban_e2e";

/** Clears the e2e database so each test starts from an empty board. */
test.beforeEach(async () => {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  await client.db(E2E_DB).collection("cards").deleteMany({});
  await client.db(E2E_DB).collection("counters").deleteMany({});
  await client.close();
});

test("renders the four lanes and creates a task into Todo", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "AI Kanban" })).toBeVisible();
  for (const lane of ["Todo", "In Progress", "Need Review", "Done"]) {
    await expect(page.getByRole("heading", { name: lane })).toBeVisible();
  }

  // Open the dialog via the header trigger, then submit a task.
  await page.locator("header").getByText("Add task").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Title").fill("My first task");
  await dialog.getByRole("button", { name: "Add task" }).click();

  // Dialog closes and the card lands in the Todo lane.
  await expect(dialog).toBeHidden();
  const todoLane = page.locator("section").filter({ hasText: "Todo" });
  await expect(todoLane.getByText("My first task")).toBeVisible();
});

test("drags a card from Todo to In Progress", async ({ page }) => {
  await page.goto("/");

  await page.locator("header").getByText("Add task").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("Draggable");
  await dialog.getByRole("button", { name: "Add task" }).click();

  const card = page.getByText("Draggable", { exact: true });
  await expect(card).toBeVisible();

  const inProgressLane = page
    .locator("section")
    .filter({ hasText: "In Progress" });

  // Granular pointer moves so dnd-kit's PointerSensor activates the drag.
  const source = await card.boundingBox();
  const target = await inProgressLane.boundingBox();
  if (!source || !target) {
    throw new Error("could not measure drag source/target");
  }

  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    source.x + source.width / 2 + 8,
    source.y + source.height / 2 + 8,
    { steps: 6 },
  );
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();

  // The card now lives in the In Progress lane, not Todo.
  await expect(
    inProgressLane.getByText("Draggable", { exact: true }),
  ).toBeVisible();
  const todoLane = page.locator("section").filter({ hasText: "Todo" });
  await expect(todoLane.getByText("Draggable", { exact: true })).toBeHidden();
});
