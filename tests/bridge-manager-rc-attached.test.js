/**
 * BridgeManager RC attached-session 路由集成测试
 *
 * 当 sessionKey 有 active attachment 时：
 *   - _flushPending 检测到 attachment → 走 _flushAttachedDesktopSession
 *   - 不调 hub.send（不写 bridge session jsonl）
 *   - 调用 engine.ensureSessionLoaded + session.prompt
 *   - 返回 reply 通过 adapter.sendReply 送 TG
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/bridge/telegram-adapter.js", () => ({ createTelegramAdapter: vi.fn() }));
vi.mock("../lib/bridge/feishu-adapter.js", () => ({ createFeishuAdapter: vi.fn() }));
vi.mock("../lib/debug-log.js", () => ({ debugLog: () => null }));

import os from "os";
import { BridgeManager } from "../lib/bridge/bridge-manager.js";
import { createSlashSystem } from "../core/slash-commands/index.js";

function makeFakeSession({ replyText = "desktop reply", toolMedia = [] } = {}) {
  const subs = [];
  return {
    subscribe: (fn) => { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
    prompt: vi.fn(async () => {
      // emit text_delta one chunk
      for (const fn of subs) {
        fn({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: replyText } });
        for (const url of toolMedia) {
          fn({ type: "tool_execution_end", isError: false, result: { details: { media: { mediaUrls: [url] } } } });
        }
      }
    }),
    model: null,
    _subs: subs,
  };
}

function createMocks({ session } = {}) {
  const s = session || makeFakeSession();
  const adapter = {
    sendReply: vi.fn().mockResolvedValue(),
    sendTypingIndicator: vi.fn().mockResolvedValue(),
    stop: vi.fn(),
  };
  const engine = {
    getAgent: vi.fn((id) => id === "hana"
      ? { id: "hana", agentName: "T", config: { bridge: { telegram: { owner: "owner123" } } }, sessionDir: os.tmpdir() }
      : null),
    isBridgeSessionStreaming: vi.fn(() => false),
    isSessionStreaming: vi.fn(() => false),
    steerBridgeSession: vi.fn(() => false),
    abortBridgeSession: vi.fn(async () => false),
    bridgeSessionManager: { injectMessage: vi.fn(() => true), readIndex: () => ({}), writeIndex: () => {} },
    ensureSessionLoaded: vi.fn(async () => s),
    agentName: "T",
    hanakoHome: os.tmpdir(),
    currentAgentId: "hana",
  };
  const hub = {
    send: vi.fn().mockResolvedValue("should NOT be called"),
    eventBus: { emit: vi.fn() },
  };
  const slashSystem = createSlashSystem({ engine, hub });
  engine.slashDispatcher = slashSystem.dispatcher;
  engine.slashRegistry = slashSystem.registry;
  engine.rcState = slashSystem.rcState;

  const bm = new BridgeManager({ engine, hub });
  bm._platforms.set("telegram:hana", { adapter, status: "connected", agentId: "hana", platform: "telegram" });
  bm.blockStreaming = false;

  return { bm, adapter, engine, hub, rcState: slashSystem.rcState, session: s };
}

describe("BridgeManager RC attached-session routing", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("with active attachment → routes DM to desktop session, NOT hub.send", async () => {
    const { bm, adapter, engine, hub, rcState, session } = createMocks();
    rcState.attach("tg_dm_owner123@hana", "/path/to/desk.jsonl");

    bm._handleMessage("telegram", {
      sessionKey: "tg_dm_owner123@hana",
      text: "帮我看看 foo 这个函数",
      userId: "owner123",
      chatId: "owner123",
      agentId: "hana",
    });

    await vi.advanceTimersByTimeAsync(2500);

    // hub 未被调用（消息不走 bridge session）
    expect(hub.send).not.toHaveBeenCalled();
    // 桌面 session 被加载 + prompt
    expect(engine.ensureSessionLoaded).toHaveBeenCalledWith("/path/to/desk.jsonl");
    expect(session.prompt).toHaveBeenCalledOnce();
    // 回复送回 TG（排除 "正在输入..." 之类的预热消息）
    const replyCalls = adapter.sendReply.mock.calls.filter(c => c[1] === "desktop reply");
    expect(replyCalls).toHaveLength(1);
    expect(replyCalls[0][0]).toBe("owner123");
  });

  it("without attachment → falls back to hub.send (normal bridge path)", async () => {
    const { bm, adapter, engine, hub } = createMocks();
    // 不设 attachment

    bm._handleMessage("telegram", {
      sessionKey: "tg_dm_owner123@hana",
      text: "hi",
      userId: "owner123",
      chatId: "owner123",
      agentId: "hana",
    });

    await vi.advanceTimersByTimeAsync(2500);

    // 常规路径：hub 被调用，桌面 session 不加载
    expect(hub.send).toHaveBeenCalledOnce();
    expect(engine.ensureSessionLoaded).not.toHaveBeenCalled();
  });

  it("non-owner message with attachment set → does NOT route (防御性 isOwner 检查)", async () => {
    const { bm, hub, engine, rcState } = createMocks();
    // 某种异常情况：attachment 存在但消息来自非 owner
    rcState.attach("tg_dm_owner123@hana", "/path/to/desk.jsonl");

    bm._handleMessage("telegram", {
      sessionKey: "tg_dm_owner123@hana",
      text: "intruder",
      userId: "random-guest",  // 非 owner
      chatId: "owner123",
      agentId: "hana",
    });

    await vi.advanceTimersByTimeAsync(2500);

    // 非 owner 走正常路径（hub.send），不碰桌面 session
    expect(engine.ensureSessionLoaded).not.toHaveBeenCalled();
  });

  it("desktop session prompt failure → sends [Error] to bridge", async () => {
    const session = makeFakeSession();
    session.prompt.mockRejectedValueOnce(new Error("model timeout"));
    const { bm, adapter, rcState } = createMocks({ session });
    rcState.attach("tg_dm_owner123@hana", "/err.jsonl");

    bm._handleMessage("telegram", {
      sessionKey: "tg_dm_owner123@hana",
      text: "x",
      userId: "owner123",
      chatId: "owner123",
      agentId: "hana",
    });

    await vi.advanceTimersByTimeAsync(2500);

    const replies = adapter.sendReply.mock.calls.map(c => c[1]);
    expect(replies.some(r => /\[Error\].*model timeout/.test(r))).toBe(true);
  });

  it("tool media from desktop session → forwarded via adapter", async () => {
    const session = makeFakeSession({ replyText: "see image", toolMedia: ["https://example.com/a.png"] });
    const adapterSendMedia = vi.fn().mockResolvedValue();
    const { bm, adapter, rcState } = createMocks({ session });
    adapter.sendMedia = adapterSendMedia;
    rcState.attach("tg_dm_owner123@hana", "/s.jsonl");

    bm._handleMessage("telegram", {
      sessionKey: "tg_dm_owner123@hana",
      text: "q",
      userId: "owner123",
      chatId: "owner123",
      agentId: "hana",
    });

    await vi.advanceTimersByTimeAsync(2500);

    expect(adapterSendMedia).toHaveBeenCalledWith("owner123", "https://example.com/a.png");
  });
});
