// plugins/image-gen/routes/media.js
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { getKnownModels } from "../lib/model-catalog.js";

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime" };

export default function (app, ctx) {
  // Serve generated media — streaming + Range support
  app.get("/media/:filename", async (c) => {
    const filename = c.req.param("filename");
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      return c.json({ error: "invalid filename" }, 400);
    }
    const filePath = path.join(ctx.dataDir, "generated", filename);

    let stat;
    try { stat = fs.statSync(filePath); } catch { return c.json({ error: "not found" }, 404); }

    const ext = path.extname(filename).slice(1);
    const mime = MIME[ext] || "application/octet-stream";
    const total = stat.size;
    const range = c.req.header("range");

    if (range) {
      // Range request — partial content (video seeking, progressive load)
      const match = range.match(/bytes=(\d*)-(\d*)/);
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : total - 1;
      const chunkSize = end - start + 1;

      const stream = fs.createReadStream(filePath, { start, end });
      const { readable, writable } = new TransformStream();
      streamPipe(stream, writable);

      return new Response(readable, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": String(chunkSize),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // Full request — stream the entire file (no readFileSync)
    const stream = fs.createReadStream(filePath);
    const { readable, writable } = new TransformStream();
    streamPipe(stream, writable);

    return new Response(readable, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(total),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400",
      },
    });
  });

  // Open generated media in system default application (cross-platform)
  app.post("/media/open/:filename", async (c) => {
    const filename = c.req.param("filename");
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      return c.json({ error: "invalid filename" }, 400);
    }
    const filePath = path.join(ctx.dataDir, "generated", filename);

    try { fs.statSync(filePath); } catch { return c.json({ error: "not found" }, 404); }

    try {
      await openWithSystem(filePath);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err.message || "failed to open file" }, 500);
    }
  });

  // Preset providers that support image generation
  const IMAGE_PROVIDER_PRESETS = [
    { id: "volcengine", displayName: "火山引擎 (豆包)" },
    { id: "openai", displayName: "OpenAI" },
    { id: "openai-codex-oauth", displayName: "OpenAI Codex (OAuth)" },
  ];

  // Known image models — single source of truth from shared catalog
  const KNOWN_IMAGE_MODELS = Object.fromEntries(
    IMAGE_PROVIDER_PRESETS.map(p => [p.id, getKnownModels(p.id)])
  );

  // Provider summary for Media settings tab
  app.get("/providers", async (c) => {
    try {
      const { models } = await ctx.bus.request("provider:models-by-type", { type: "image" });
      // Group added image models by provider
      const grouped = {};
      for (const m of (models || [])) {
        if (!grouped[m.provider]) {
          const creds = await ctx.bus.request("provider:credentials", { providerId: m.provider });
          grouped[m.provider] = {
            providerId: m.provider,
            hasCredentials: !creds.error,
            models: [],
            availableModels: [],
          };
        }
        grouped[m.provider].models.push({ id: m.id, name: m.name });
      }
      // Ensure preset providers always appear + attach available models
      for (const preset of IMAGE_PROVIDER_PRESETS) {
        if (!grouped[preset.id]) {
          const creds = await ctx.bus.request("provider:credentials", { providerId: preset.id });
          grouped[preset.id] = {
            providerId: preset.id,
            displayName: preset.displayName,
            hasCredentials: !creds.error,
            models: [],
            availableModels: [],
          };
        } else if (!grouped[preset.id].displayName) {
          grouped[preset.id].displayName = preset.displayName;
        }
        // Compute available = known - already added
        const known = KNOWN_IMAGE_MODELS[preset.id] || [];
        const addedIds = new Set(grouped[preset.id].models.map(m => m.id));
        grouped[preset.id].availableModels = known.filter(m => !addedIds.has(m.id));
      }
      return c.json({ providers: grouped, config: ctx.config.get() || {} });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Save plugin config (default model, provider defaults)
  app.put("/config", async (c) => {
    try {
      const body = await c.req.json();
      for (const [key, value] of Object.entries(body)) {
        ctx.config.set(key, value);
      }
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });
}

/** Open a file with the system default application (cross-platform). */
function openWithSystem(filePath) {
  return new Promise((resolve, reject) => {
    const p = process.platform;
    let cmd, args;
    if (p === "darwin") {
      cmd = "open"; args = [filePath];
    } else if (p === "win32") {
      cmd = "cmd"; args = ["/c", "start", "", filePath];
    } else {
      cmd = "xdg-open"; args = [filePath];
    }
    execFile(cmd, args, (err) => err ? reject(err) : resolve());
  });
}

/** Pipe a Node.js Readable into a Web WritableStream */
function streamPipe(nodeStream, writable) {
  const writer = writable.getWriter();
  nodeStream.on("data", (chunk) => writer.write(chunk));
  nodeStream.on("end", () => writer.close());
  nodeStream.on("error", () => writer.close());
}
