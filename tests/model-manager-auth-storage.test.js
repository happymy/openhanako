import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import YAML from "js-yaml";
import { ModelManager } from "../core/model-manager.js";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-model-manager-auth-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeAddedModels(providers) {
  fs.writeFileSync(
    path.join(tmpDir, "added-models.yaml"),
    YAML.dump({ providers }),
    "utf-8",
  );
}

function writeAuth(data) {
  fs.writeFileSync(
    path.join(tmpDir, "auth.json"),
    JSON.stringify(data, null, 2),
    "utf-8",
  );
}

function deepseekProvider(apiKey) {
  return {
    base_url: "https://api.deepseek.com/v1",
    api: "openai-completions",
    api_key: apiKey,
    models: ["deepseek-v4-pro"],
  };
}

async function getDeepseekApiKey(manager) {
  const model = manager.modelRegistry.find("deepseek", "deepseek-v4-pro");
  expect(model).toBeTruthy();
  const auth = await manager.modelRegistry.getApiKeyAndHeaders(model);
  expect(auth.ok).toBe(true);
  return auth.apiKey;
}

describe("ModelManager AuthStorage ownership", () => {
  it("API-key provider runtime lookup uses added-models credentials over stale auth.json", async () => {
    writeAuth({
      deepseek: { type: "api_key", key: "sk-old-3ffa" },
    });
    writeAddedModels({
      deepseek: deepseekProvider("sk-new-999c"),
    });

    const manager = new ModelManager({ hanakoHome: tmpDir });
    manager.init();
    await manager.syncAndRefresh();

    await expect(getDeepseekApiKey(manager)).resolves.toBe("sk-new-999c");
    const persistedAuth = JSON.parse(fs.readFileSync(path.join(tmpDir, "auth.json"), "utf-8"));
    expect(persistedAuth.deepseek).toBeUndefined();
  });

  it("reloadAndSync clears stale in-memory API-key auth before refreshing models", async () => {
    writeAuth({
      deepseek: { type: "api_key", key: "sk-old-3ffa" },
    });
    writeAddedModels({
      deepseek: deepseekProvider("sk-new-999c"),
    });

    const manager = new ModelManager({ hanakoHome: tmpDir });
    manager.init();
    writeAuth({});

    await manager.reloadAndSync();

    await expect(getDeepseekApiKey(manager)).resolves.toBe("sk-new-999c");
  });
});
