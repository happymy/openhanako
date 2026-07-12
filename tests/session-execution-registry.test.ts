import { describe, expect, it, vi } from "vitest";

import {
  SessionExecutionRegistry,
  wrapWithSessionExecutionCancellation,
} from "../lib/session-execution-registry.ts";

describe("SessionExecutionRegistry", () => {
  it("aborts every active tool execution owned by one session", async () => {
    const registry = new SessionExecutionRegistry();
    const observedSignals: AbortSignal[] = [];
    const tool = {
      name: "blocking_tool",
      execute: vi.fn(async (_id, _params, signal) => {
        observedSignals.push(signal);
        await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }),
    };
    const [wrapped] = wrapWithSessionExecutionCancellation([tool], {
      registry,
      getSessionPath: () => "/tmp/session.jsonl",
      getSessionIdForPath: () => "session-1",
    });

    const execution = wrapped.execute("call-1", {}, undefined, undefined, {});
    await Promise.resolve();

    expect(registry.activeCount("session-1")).toBe(1);
    expect(registry.abortBySession({ sessionId: "session-1" }, "user_abort")).toEqual({
      matched: 1,
      aborted: 1,
    });
    await expect(execution).rejects.toThrow("aborted");
    expect(observedSignals[0].aborted).toBe(true);
    expect(registry.activeCount("session-1")).toBe(0);
  });

  it("keeps executions from other sessions alive", async () => {
    const registry = new SessionExecutionRegistry();
    const first = registry.begin({ sessionId: "session-1", toolName: "one" });
    const second = registry.begin({ sessionId: "session-2", toolName: "two" });

    registry.abortBySession({ sessionId: "session-1" }, "user_abort");

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    first.release();
    second.release();
  });

  it("does not leave completed executions registered", async () => {
    const registry = new SessionExecutionRegistry();
    const [wrapped] = wrapWithSessionExecutionCancellation([{
      name: "quick_tool",
      execute: vi.fn(async () => "done"),
    }], {
      registry,
      getSessionPath: () => "/tmp/session.jsonl",
      getSessionIdForPath: () => "session-1",
    });

    await expect(wrapped.execute("call-1", {}, undefined, undefined, {})).resolves.toBe("done");
    expect(registry.activeCount("session-1")).toBe(0);
  });

  it("preserves the legacy third-argument runtime context as the fifth argument", async () => {
    const registry = new SessionExecutionRegistry();
    const execute = vi.fn(async () => "done");
    const [wrapped] = wrapWithSessionExecutionCancellation([{ name: "legacy_tool", execute }], {
      registry,
      getSessionIdForPath: () => "session-1",
    });
    const runtimeCtx = {
      sessionManager: { getSessionFile: () => "/tmp/session.jsonl" },
    };

    await wrapped.execute("call-1", {}, runtimeCtx);

    expect(execute).toHaveBeenCalledWith(
      "call-1",
      {},
      expect.objectContaining({ aborted: false }),
      undefined,
      runtimeCtx,
    );
  });
});
