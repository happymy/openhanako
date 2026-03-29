import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../plugins/image-gen/adapters/registry.js", () => ({
  getAdapter: vi.fn(),
}));

vi.mock("../plugins/image-gen/lib/download.js", () => ({
  saveImage: vi.fn(async () => ({ filename: "123-abcd1234.png", filePath: "/tmp/generated/123-abcd1234.png" })),
}));

import { getAdapter } from "../plugins/image-gen/adapters/registry.js";
import { saveImage } from "../plugins/image-gen/lib/download.js";

describe("generate-image tool", () => {
  let execute, name, description, parameters;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../plugins/image-gen/tools/generate-image.js");
    execute = mod.execute;
    name = mod.name;
    description = mod.description;
    parameters = mod.parameters;
  });

  it("exports correct tool metadata", () => {
    expect(name).toBe("generate-image");
    expect(description).toBeTruthy();
    expect(parameters.required).toContain("prompt");
  });

  it("calls adapter and returns markdown image URL on success", async () => {
    getAdapter.mockReturnValue({
      generate: vi.fn(async () => ({
        images: [{ buffer: Buffer.from("img"), mimeType: "image/png", fileName: "img.png" }],
      })),
    });

    const ctx = {
      bus: {
        request: vi.fn(async (type, payload) => {
          if (type === "agent:config") return { config: {} };
          if (type === "provider:credentials") return { apiKey: "key", baseUrl: "https://api.test.com" };
          return {};
        }),
      },
      config: { get: vi.fn((key) => {
        if (key === "defaultImageModel") return { id: "test-model", provider: "test-prov" };
        if (key === "providerDefaults") return {};
        return null;
      }) },
      dataDir: "/tmp/test-plugin-data",
      agentId: "agent-1",
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const result = await execute({ prompt: "a cat" }, ctx);
    expect(result).toContain("stage_files");
    expect(result).toContain("/tmp/generated/123-abcd1234.png");
    expect(getAdapter).toHaveBeenCalledWith("test-prov");
    expect(saveImage).toHaveBeenCalled();
  });

  it("uses agent config imageModel when no input override", async () => {
    getAdapter.mockReturnValue({
      generate: vi.fn(async () => ({
        images: [{ buffer: Buffer.from("img"), mimeType: "image/png" }],
      })),
    });

    const ctx = {
      bus: {
        request: vi.fn(async (type) => {
          if (type === "agent:config") return { config: { imageModel: { id: "agent-model", provider: "agent-prov" } } };
          if (type === "provider:credentials") return { apiKey: "key", baseUrl: "https://test.com" };
          return {};
        }),
      },
      config: { get: vi.fn(() => null) },
      dataDir: "/tmp",
      agentId: "agent-1",
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    await execute({ prompt: "test" }, ctx);
    expect(getAdapter).toHaveBeenCalledWith("agent-prov");
  });

  it("returns error when no model configured", async () => {
    const ctx = {
      bus: { request: vi.fn(async () => ({ config: {} })) },
      config: { get: vi.fn(() => null) },
      dataDir: "/tmp",
      agentId: "a",
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const result = await execute({ prompt: "a cat" }, ctx);
    expect(result).toContain("未配置");
  });

  it("returns error when credentials missing", async () => {
    getAdapter.mockReturnValue({ generate: vi.fn() });

    const ctx = {
      bus: {
        request: vi.fn(async (type) => {
          if (type === "agent:config") return { config: {} };
          if (type === "provider:credentials") return { error: "no_credentials" };
          return {};
        }),
      },
      config: { get: vi.fn((key) => {
        if (key === "defaultImageModel") return { id: "m", provider: "p" };
        return null;
      }) },
      dataDir: "/tmp",
      agentId: "a",
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const result = await execute({ prompt: "test" }, ctx);
    expect(result).toContain("API Key");
  });

  it("returns error when adapter not found", async () => {
    getAdapter.mockReturnValue(null);

    const ctx = {
      bus: {
        request: vi.fn(async (type) => {
          if (type === "agent:config") return { config: {} };
          if (type === "provider:credentials") return { apiKey: "key", baseUrl: "https://test.com" };
          return {};
        }),
      },
      config: { get: vi.fn((key) => {
        if (key === "defaultImageModel") return { id: "m", provider: "unknown" };
        return null;
      }) },
      dataDir: "/tmp",
      agentId: "a",
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const result = await execute({ prompt: "test" }, ctx);
    expect(result).toContain("不支持");
  });

  it("includes revisedPrompt when adapter returns one", async () => {
    getAdapter.mockReturnValue({
      generate: vi.fn(async () => ({
        images: [{ buffer: Buffer.from("img"), mimeType: "image/png" }],
        revisedPrompt: "A cute orange cat",
      })),
    });

    const ctx = {
      bus: {
        request: vi.fn(async (type) => {
          if (type === "agent:config") return { config: {} };
          if (type === "provider:credentials") return { apiKey: "key", baseUrl: "https://test.com" };
          return {};
        }),
      },
      config: { get: vi.fn((key) => {
        if (key === "defaultImageModel") return { id: "m", provider: "p" };
        if (key === "providerDefaults") return {};
        return null;
      }) },
      dataDir: "/tmp",
      agentId: "a",
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const result = await execute({ prompt: "a cat" }, ctx);
    expect(result).toContain("A cute orange cat");
  });

  it("catches API errors and returns human-readable message", async () => {
    getAdapter.mockReturnValue({
      generate: vi.fn(async () => { throw new Error("API error 429: rate limit exceeded"); }),
    });

    const ctx = {
      bus: {
        request: vi.fn(async (type) => {
          if (type === "agent:config") return { config: {} };
          if (type === "provider:credentials") return { apiKey: "key", baseUrl: "https://test.com" };
          return {};
        }),
      },
      config: { get: vi.fn((key) => {
        if (key === "defaultImageModel") return { id: "m", provider: "p" };
        if (key === "providerDefaults") return {};
        return null;
      }) },
      dataDir: "/tmp",
      agentId: "a",
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const result = await execute({ prompt: "test" }, ctx);
    expect(result).toContain("429");
  });
});
