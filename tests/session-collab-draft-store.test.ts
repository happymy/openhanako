import { describe, it, expect, vi } from "vitest";
import { SessionCollabDraftStore } from "../lib/session-collab/draft-store.ts";

function makeEntry(overrides: any = {}) {
  return {
    kind: "send" as const,
    sourceSessionId: "src-1",
    draft: { targetSessionId: "dst-1", message: "hi" },
    apply: vi.fn().mockResolvedValue({ delivered: true }),
    ...overrides,
  };
}

describe("SessionCollabDraftStore", () => {
  it("create 返回公开条目且不暴露 apply 闭包", () => {
    const store = new SessionCollabDraftStore();
    const entry = store.create(makeEntry());
    expect(entry.suggestionId).toMatch(/^session_/);
    expect(entry.kind).toBe("send");
    expect((entry as any).apply).toBeUndefined();
  });

  it("apply 成功后条目即删，二次 apply 报 not-found", async () => {
    const store = new SessionCollabDraftStore();
    const { suggestionId } = store.create(makeEntry());
    const first = await store.apply(suggestionId, { message: "edited" });
    expect(first.ok).toBe(true);
    const second = await store.apply(suggestionId, {});
    expect(second).toEqual({ ok: false, reason: "not-found" });
  });

  it("apply 把编辑后的 draft 透传给闭包", async () => {
    const store = new SessionCollabDraftStore();
    const apply = vi.fn().mockResolvedValue("ok");
    const { suggestionId } = store.create(makeEntry({ apply }));
    await store.apply(suggestionId, { message: "edited" });
    expect(apply).toHaveBeenCalledWith({ message: "edited" });
  });

  it("apply 闭包抛错时条目保留，可重试", async () => {
    const store = new SessionCollabDraftStore();
    const apply = vi.fn()
      .mockRejectedValueOnce(new Error("session_busy"))
      .mockResolvedValueOnce("ok");
    const { suggestionId } = store.create(makeEntry({ apply }));
    await expect(store.apply(suggestionId, {})).rejects.toThrow("session_busy");
    const retry = await store.apply(suggestionId, {});
    expect(retry.ok).toBe(true);
  });

  it("listForSession 按源 sessionId 过滤", () => {
    const store = new SessionCollabDraftStore();
    store.create(makeEntry({ sourceSessionId: "a" }));
    store.create(makeEntry({ sourceSessionId: "b" }));
    expect(store.listForSession("a")).toHaveLength(1);
  });
});
