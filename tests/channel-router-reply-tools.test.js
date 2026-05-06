import { describe, expect, it, vi } from "vitest";

const { runAgentSessionMock } = vi.hoisted(() => ({
  runAgentSessionMock: vi.fn(async () => "OK"),
}));

vi.mock("../hub/agent-executor.js", () => ({
  runAgentSession: runAgentSessionMock,
}));

vi.mock("../lib/debug-log.js", () => ({
  debugLog: () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  createModuleLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { ChannelRouter } from "../hub/channel-router.js";

describe("ChannelRouter reply tool boundary", () => {
  it("runs hidden channel reply sessions with the read-only tool set", async () => {
    runAgentSessionMock.mockClear();

    const engine = { marker: "engine" };
    const router = new ChannelRouter({
      hub: {
        engine,
        eventBus: { emit: vi.fn() },
      },
    });

    const result = await router._executeReply(
      "hanako",
      "ch_crew",
      "user: @Hanako please reply OK",
    );

    expect(result).toBe("OK");
    expect(runAgentSessionMock).toHaveBeenCalledOnce();
    expect(runAgentSessionMock.mock.calls[0][2]).toMatchObject({
      engine,
      sessionSuffix: "channel-temp",
      readOnly: true,
    });
  });
});
