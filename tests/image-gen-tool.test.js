import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the adapter modules so the tool's ADAPTERS map points to our fakes
const mockVolcengineSubmit = vi.fn();
const mockOpenaiSubmit = vi.fn();

vi.mock("../plugins/image-gen/adapters/volcengine.js", () => ({
  volcengineImageAdapter: {
    id: "volcengine",
    types: ["image"],
    checkAuth: vi.fn(async () => ({ ok: true })),
    submit: mockVolcengineSubmit,
  },
}));

vi.mock("../plugins/image-gen/adapters/openai.js", () => ({
  openaiImageAdapter: {
    id: "openai",
    types: ["image"],
    checkAuth: vi.fn(async () => ({ ok: true })),
    submit: mockOpenaiSubmit,
  },
}));

describe("generate-image tool", () => {
  let execute, name, description, parameters;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import after mocks are set
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

  it("calls adapter.submit and returns stage_files prompt on success", async () => {
    mockVolcengineSubmit.mockResolvedValueOnce({
      taskId: "abc123",
      files: ["sunset-abc1234.png"],
    });

    const ctx = {
      bus: {
        request: vi.fn(async (type) => {
          if (type === "agent:config") return { config: {} };
          return {};
        }),
      },
      config: {
        get: vi.fn((key) => {
          if (key === "defaultImageModel") return { id: "doubao-seedream-4-0-250828", provider: "volcengine" };
          if (key === "providerDefaults") return {};
          return null;
        }),
      },
      dataDir: "/tmp/test-plugin-data",
      agentId: "agent-1",
      log: vi.fn(),
    };

    const result = await execute({ prompt: "a cat" }, ctx);
    expect(result).toContain("stage_files");
    expect(result).toContain("sunset-abc1234.png");
    expect(mockVolcengineSubmit).toHaveBeenCalledOnce();
  });

  it("uses agent config imageModel when no input override", async () => {
    mockVolcengineSubmit.mockResolvedValueOnce({
      taskId: "t1",
      files: ["img.png"],
    });

    const ctx = {
      bus: {
        request: vi.fn(async (type) => {
          if (type === "agent:config") return { config: { imageModel: { id: "agent-model", provider: "volcengine" } } };
          return {};
        }),
      },
      config: { get: vi.fn(() => null) },
      dataDir: "/tmp",
      agentId: "agent-1",
      log: vi.fn(),
    };

    await execute({ prompt: "test" }, ctx);
    expect(mockVolcengineSubmit).toHaveBeenCalledOnce();
    const [params] = mockVolcengineSubmit.mock.calls[0];
    expect(params.model).toBe("agent-model");
  });

  it("returns error when no model configured", async () => {
    const ctx = {
      bus: { request: vi.fn(async () => ({ config: {} })) },
      config: { get: vi.fn(() => null) },
      dataDir: "/tmp",
      agentId: "a",
      log: vi.fn(),
    };

    const result = await execute({ prompt: "a cat" }, ctx);
    expect(result).toContain("未配置");
  });

  it("returns error when adapter not found for unknown provider", async () => {
    const ctx = {
      bus: {
        request: vi.fn(async (type) => {
          if (type === "agent:config") return { config: {} };
          return {};
        }),
      },
      config: {
        get: vi.fn((key) => {
          if (key === "defaultImageModel") return { id: "m", provider: "unknown-provider" };
          return null;
        }),
      },
      dataDir: "/tmp",
      agentId: "a",
      log: vi.fn(),
    };

    const result = await execute({ prompt: "test" }, ctx);
    expect(result).toContain("不支持");
  });

  it("catches API errors thrown by submit and returns human-readable message", async () => {
    mockVolcengineSubmit.mockRejectedValueOnce(new Error("API error 429: rate limit exceeded"));

    const ctx = {
      bus: {
        request: vi.fn(async (type) => {
          if (type === "agent:config") return { config: {} };
          return {};
        }),
      },
      config: {
        get: vi.fn((key) => {
          if (key === "defaultImageModel") return { id: "m", provider: "volcengine" };
          if (key === "providerDefaults") return {};
          return null;
        }),
      },
      dataDir: "/tmp",
      agentId: "a",
      log: vi.fn(),
    };

    const result = await execute({ prompt: "test" }, ctx);
    expect(result).toContain("429");
  });

  it("uses openai adapter when provider is openai", async () => {
    mockOpenaiSubmit.mockResolvedValueOnce({
      taskId: "t2",
      files: ["dog.png"],
    });

    const ctx = {
      bus: {
        request: vi.fn(async () => ({ config: {} })),
      },
      config: {
        get: vi.fn((key) => {
          if (key === "defaultImageModel") return { id: "gpt-image-1", provider: "openai" };
          return null;
        }),
      },
      dataDir: "/tmp",
      agentId: "a",
      log: vi.fn(),
    };

    const result = await execute({ prompt: "a dog" }, ctx);
    expect(result).toContain("stage_files");
    expect(mockOpenaiSubmit).toHaveBeenCalledOnce();
  });
});
