import { describe, expect, it } from "vitest";
import * as deepseek from "../../core/provider-compat/deepseek.js";

describe("provider-compat/deepseek — matches", () => {
  it("导出 matches 函数", () => {
    expect(typeof deepseek.matches).toBe("function");
  });

  it("导出 apply 函数", () => {
    expect(typeof deepseek.apply).toBe("function");
  });

  it("matches 对 null/undefined 返回 false（不抛错）", () => {
    expect(deepseek.matches(null)).toBe(false);
    expect(deepseek.matches(undefined)).toBe(false);
    expect(deepseek.matches({})).toBe(false);
  });

  it("matches 识别 deepseek provider", () => {
    expect(deepseek.matches({ provider: "deepseek" })).toBe(true);
  });

  it("matches 识别官方 baseUrl", () => {
    expect(deepseek.matches({ baseUrl: "https://api.deepseek.com/v1" })).toBe(true);
  });

  it("matches 识别 snake_case base_url 别名", () => {
    expect(deepseek.matches({ base_url: "https://api.deepseek.com" })).toBe(true);
  });

  it("matches 不把 openrouter 上的 deepseek 视为 deepseek", () => {
    expect(deepseek.matches({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      id: "deepseek/deepseek-v3.2",
    })).toBe(false);
  });
});

describe("provider-compat/deepseek — extractReasoningFromContent", () => {
  it("从被 transform-messages 降级为 text 的 content 里恢复原文", () => {
    // pi-ai transform-messages.js:45-48 跨模型时把 thinking block 转为
    // { type: "text", text: <思考原文> }，放在 content 数组首位
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "思考原文：先调用 date 工具" },
      ],
      tool_calls: [{ id: "call_1", type: "function", function: { name: "date", arguments: "{}" } }],
    };
    expect(deepseek.extractReasoningFromContent(message)).toBe("思考原文：先调用 date 工具");
  });

  it("已有 thinking block（同模型路径）时也能取出 thinking 字段", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "原始思考内容", thinkingSignature: "reasoning_content" },
        { type: "toolCall", id: "call_1", name: "date" },
      ],
    };
    expect(deepseek.extractReasoningFromContent(message)).toBe("原始思考内容");
  });

  it("content 为字符串（OpenAI 顶层格式 assistantMsg.content = string）时返回空字符串", () => {
    const message = {
      role: "assistant",
      content: "已经是 string 形式的 content",
      tool_calls: [{ id: "call_1" }],
    };
    expect(deepseek.extractReasoningFromContent(message)).toBe("");
  });

  it("无 content 字段时返回空字符串", () => {
    expect(deepseek.extractReasoningFromContent({ role: "assistant", tool_calls: [{}] })).toBe("");
  });

  it("content 是空数组时返回空字符串", () => {
    expect(deepseek.extractReasoningFromContent({ role: "assistant", content: [] })).toBe("");
  });

  it("null/undefined message 返回空字符串（不抛错）", () => {
    expect(deepseek.extractReasoningFromContent(null)).toBe("");
    expect(deepseek.extractReasoningFromContent(undefined)).toBe("");
  });
});
