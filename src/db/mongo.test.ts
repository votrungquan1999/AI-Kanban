import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

describe("getDb", () => {
  useTestMongo();

  it("returns the same cached Db handle across calls (connects once)", async () => {
    const first = await getDb();
    const second = await getDb();

    expect(second).toBe(first);
  });
});
