import { Hono } from "hono";

export function createSessionCollabRoute(engine: any) {
  const route = new Hono();
  route.post("/session-collab/apply", async (c) => {
    const store = engine.sessionCollabDraftStore || null;
    if (!store) return c.json({ error: "draft store unavailable" }, 500);
    let body: any = null;
    try { body = await c.req.json(); } catch { return c.json({ error: "invalid json" }, 400); }
    const suggestionId = typeof body?.suggestionId === "string" ? body.suggestionId.trim() : "";
    if (!suggestionId) return c.json({ error: "suggestionId required" }, 400);
    try {
      const applied = await store.apply(suggestionId, body?.draft || {});
      if (!applied.ok && applied.reason === "in-flight") {
        return c.json({ error: "draft is being applied", code: "draft_in_flight" }, 409);
      }
      if (!applied.ok) return c.json({ error: "draft not found or already applied", code: "draft_expired" }, 404);
      return c.json({ ok: true, result: applied.result ?? null });
    } catch (err: any) {
      const message = err?.message || String(err);
      // create 半成功：错误里带出已建 sessionId，前端据此提示（条目已保留可重试首条投递）
      const half = /^first_message_failed:([^:]+):/.exec(message);
      return c.json({
        error: message,
        code: half ? "first_message_failed" : "apply_failed",
        ...(half ? { sessionId: half[1] } : {}),
      }, 500);
    }
  });
  return route;
}
