import path from "path";
import { volcengineImageAdapter } from "../adapters/volcengine.js";
import { openaiImageAdapter } from "../adapters/openai.js";

const ADAPTERS = {
  volcengine: volcengineImageAdapter,
  "volcengine-coding": volcengineImageAdapter,
  openai: openaiImageAdapter,
};

export const name = "generate-image";
export const description = "根据文字描述生成图片。prompt 必须用英文。生成后调用 stage_files 呈现给用户。";
export const parameters = {
  type: "object",
  properties: {
    prompt:       { type: "string", description: "英文图片描述，按 guidelines 编写" },
    filename:     { type: "string", description: "文件名（不含扩展名），如 sunset-cat" },
    image:        { type: "string", description: "参考图的文件路径或 URL（图生图）" },
    aspect_ratio: { type: "string", description: "长宽比：1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9" },
    model:        { type: "string", description: "覆盖默认模型 ID" },
    provider:     { type: "string", description: "与 model 配合指定 provider" },
    size:         { type: "string", description: "分辨率：2K, 4K" },
    format:       { type: "string", description: "输出格式：png, jpeg, webp" },
    quality:      { type: "string", description: "生成质量：low, medium, high" },
  },
  required: ["prompt"],
};

export async function execute(input, ctx) {
  try {
    // 1. Resolve model (priority: input → agent config → global default)
    const model = await resolveModel(input, ctx);
    if (typeof model === "string") return model; // 错误提示
    if (!model) {
      return "图片生成功能未配置。请在设置 → Media 中添加图片模型。";
    }

    const { id: modelId, provider: providerId } = model;

    // 2. Get adapter
    const adapter = ADAPTERS[providerId];
    if (!adapter) {
      return `不支持的图片生成 provider：${providerId}`;
    }

    // 3. Build params and call adapter.submit() — credentials fetched inside adapter
    const params = {
      prompt: input.prompt,
      model: modelId,
      filename: input.filename,
      size: input.size,
      format: input.format,
      quality: input.quality,
      aspect_ratio: input.aspect_ratio,
      image: input.image,
    };

    const result = await adapter.submit(params, ctx);

    // 4. Build file path from first file — saveImage saves to ctx.dataDir/generated/
    const firstFilename = result.files[0];
    const filePath = path.join(ctx.dataDir, "generated", firstFilename);
    return `图片已生成并保存到 ${filePath}\n请立即调用 stage_files 工具将此文件呈现给用户：stage_files({ filepaths: ["${filePath}"] })`;

  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes("401") || msg.includes("403")) {
      return `API Key 无效或已过期，请检查 Provider 设置。(${msg})`;
    }
    if (msg.includes("429")) {
      return `图片生成请求过于频繁，请稍后再试。(${msg})`;
    }
    if (msg.includes("400")) {
      return `请求参数错误：${msg}`;
    }
    return `图片生成失败：${msg}`;
  }
}

async function resolveModel(input, ctx) {
  // Priority 1: explicit input override
  if (input.model) {
    if (!input.provider) {
      return "使用 model 参数时必须同时指定 provider（如 openai、volcengine）。";
    }
    return { id: input.model, provider: input.provider };
  }

  // Priority 2: agent config
  if (ctx.agentId) {
    try {
      const { config } = await ctx.bus.request("agent:config", { agentId: ctx.agentId });
      if (config?.imageModel?.id) {
        return config.imageModel;
      }
    } catch {
      // agent config unavailable, fall through to global default
    }
  }

  // Priority 3: global default
  const defaultModel = ctx.config.get("defaultImageModel");
  if (defaultModel?.id) {
    return defaultModel;
  }

  return null;
}
