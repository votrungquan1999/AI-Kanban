import { describe, expect, it } from "vitest";
import { createMcpServer } from "@/mcp/server";

describe("dispatch entrypoint", () => {
  it("exposes an env-free generic server, side-effect-free on import, leaving the per-card server intact", async () => {
    // Given no card or worker identity in the environment
    const card = process.env.CARD_ID;
    const worker = process.env.WORKER_ID;
    delete process.env.CARD_ID;
    delete process.env.WORKER_ID;
    try {
      // When the dispatch entrypoint module is imported (no identity set)
      const mod = await import("@/mcp/dispatch-index");

      // Then importing is side-effect-free and exposes an env-free main()
      expect(typeof mod.main).toBe("function");

      // And the generic server builds without requiring any identity
      const { createDispatchMcpServer } = await import("@/mcp/dispatch-server");
      expect(() => createDispatchMcpServer()).not.toThrow();

      // And the existing per-card server is unaffected (still scoped by cardId)
      expect(() => createMcpServer({ cardId: "a".repeat(24) })).not.toThrow();
    } finally {
      if (card !== undefined) process.env.CARD_ID = card;
      if (worker !== undefined) process.env.WORKER_ID = worker;
    }
  });
});
