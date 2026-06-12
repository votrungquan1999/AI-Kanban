import { beforeEach, describe, expect, it } from "vitest";
import { settingsCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import {
  getDefaultBlockInterval,
  updateDefaultBlockInterval,
} from "@/settings/settings.service";
import { useTestMongo } from "@/test/use-test-mongo";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

describe("board settings: default block interval", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await settingsCollection(db).deleteMany({});
  });

  it("seeds and returns a 2-hour default on a board with no settings yet", async () => {
    // Given a fresh board (no settings document has ever been written)
    // When the default block interval is read
    const interval = await getDefaultBlockInterval();

    // Then it is the lazily-seeded 2-hour default
    expect(interval).toBe(TWO_HOURS_MS);
  });

  it("persists a changed default that sticks across reads", async () => {
    // Given the board default has been seeded
    await getDefaultBlockInterval();

    // When the user changes the default to one hour
    const returned = await updateDefaultBlockInterval(ONE_HOUR_MS);

    // Then the update reports the new value and a fresh read reflects it
    expect(returned).toBe(ONE_HOUR_MS);
    expect(await getDefaultBlockInterval()).toBe(ONE_HOUR_MS);
  });
});
