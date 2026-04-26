import { afterEach, describe, expect, it, vi } from "vitest";
import { callText } from "../core/llm-client.js";

describe("callText provider-compat routing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("裸 model id + opts.quirks 仍走 qwen utility 兼容层", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }),
    });

    await callText({
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      model: "qwen3.5-plus",
      quirks: ["enable_thinking"],
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 5_000,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.enable_thinking).toBe(false);
  });
});
