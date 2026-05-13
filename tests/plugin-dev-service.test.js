import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { PluginManager } from "../core/plugin-manager.js";
import { PluginDevService } from "../core/plugin-dev-service.js";

function makeBus() {
  return {
    emit: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    request: vi.fn(),
    hasHandler: vi.fn(() => false),
    listCapabilities: vi.fn(() => []),
    getCapability: vi.fn(() => null),
  };
}

function writeDevPlugin(root, id, options = {}) {
  const pluginDir = path.join(root, id);
  fs.mkdirSync(path.join(pluginDir, "tools"), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "manifest.json"), JSON.stringify({
    id,
    name: options.name || id,
    version: options.version || "0.1.0",
    ...(options.trust ? { trust: options.trust } : {}),
    ...(options.manifest || {}),
  }, null, 2));
  fs.writeFileSync(path.join(pluginDir, "tools", "echo.js"), `
    export const name = "echo";
    export const description = "Echo input text";
    export async function execute(params) {
      return ${JSON.stringify(options.prefix || "Echo")} + " " + params.text;
    }
  `);
  if (options.lifecycle) {
    fs.writeFileSync(path.join(pluginDir, "index.js"), options.lifecycle);
  }
  return pluginDir;
}

describe("PluginDevService", () => {
  let tmpDir;
  let sourceRoot;
  let devPluginsDir;
  let runDataDir;
  let dataDir;
  let bus;
  let pluginManager;
  let syncPluginExtensions;
  let service;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-plugin-dev-"));
    sourceRoot = path.join(tmpDir, "sources");
    devPluginsDir = path.join(tmpDir, "hana-home", "plugins-dev");
    runDataDir = path.join(tmpDir, "hana-home", "plugin-dev-runs");
    dataDir = path.join(tmpDir, "hana-home", "plugin-data");
    fs.mkdirSync(sourceRoot, { recursive: true });
    bus = makeBus();
    syncPluginExtensions = vi.fn();
    pluginManager = new PluginManager({
      pluginsDirs: [devPluginsDir],
      dataDir,
      bus,
      preferencesManager: {
        getDisabledPlugins: () => [],
        getAllowFullAccessPlugins: () => false,
      },
    });
    service = new PluginDevService({
      pluginManager,
      devPluginsDir,
      runDataDir,
      allowedSourceRoots: [sourceRoot],
      syncPluginExtensions,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("installs an allowed source as a dev plugin and invokes its tool", async () => {
    const sourcePath = writeDevPlugin(sourceRoot, "dev-echo", { prefix: "Echo" });

    const install = await service.installFromSource({ sourcePath });

    expect(install.devRunId).toEqual(expect.any(String));
    expect(install.plugin).toMatchObject({
      id: "dev-echo",
      source: "dev",
      status: "loaded",
    });
    expect(fs.existsSync(path.join(devPluginsDir, "dev-echo", "manifest.json"))).toBe(true);
    expect(syncPluginExtensions).toHaveBeenCalledTimes(1);

    const invocation = await service.invokeTool({
      pluginId: "dev-echo",
      toolName: "echo",
      input: { text: "hi" },
      sessionPath: "/tmp/session.jsonl",
    });

    expect(invocation.toolName).toBe("dev-echo_echo");
    expect(invocation.result.content[0].text).toBe("Echo hi");
  });

  it("reloads from the source slot and refreshes the installed code", async () => {
    const sourcePath = writeDevPlugin(sourceRoot, "dev-reload", { prefix: "One" });
    await service.installFromSource({ sourcePath });
    writeDevPlugin(sourceRoot, "dev-reload", { prefix: "Two", version: "0.2.0" });

    const reload = await service.reloadPlugin("dev-reload");
    const invocation = await service.invokeTool({
      pluginId: "dev-reload",
      toolName: "echo",
      input: { text: "now" },
    });

    expect(reload.plugin.version).toBe("0.2.0");
    expect(invocation.result.content[0].text).toBe("Two now");
    expect(syncPluginExtensions).toHaveBeenCalledTimes(2);
  });

  it("keeps full-access dev plugins restricted without explicit dev permission", async () => {
    const sourcePath = writeDevPlugin(sourceRoot, "dev-full", {
      trust: "full-access",
      lifecycle: `
        export default class DevFull {
          async onload() { globalThis.__hanaDevFullLoaded = true; }
        }
      `,
    });

    const install = await service.installFromSource({ sourcePath, allowFullAccess: false });

    expect(install.plugin).toMatchObject({
      id: "dev-full",
      source: "dev",
      status: "restricted",
      trust: "full-access",
    });
    expect(globalThis.__hanaDevFullLoaded).toBeUndefined();
  });

  it("rejects source paths outside the configured allowed roots", async () => {
    const outsideRoot = path.join(tmpDir, "outside");
    fs.mkdirSync(outsideRoot, { recursive: true });
    const sourcePath = writeDevPlugin(outsideRoot, "outside-dev");

    await expect(service.installFromSource({ sourcePath }))
      .rejects.toThrow(/outside allowed plugin dev roots/i);
    expect(fs.existsSync(path.join(devPluginsDir, "outside-dev"))).toBe(false);
  });

  it("registers EventBus dev capabilities and request handlers", async () => {
    const { EventBus } = await import("../hub/event-bus.js");
    const eventBus = new EventBus();
    const sourcePath = writeDevPlugin(sourceRoot, "bus-dev", { prefix: "Bus" });

    const unregister = service.registerEventBusHandlers(eventBus);

    expect(eventBus.getCapability("plugin.dev.install")).toMatchObject({
      type: "plugin.dev.install",
      available: true,
      owner: "system",
    });

    const install = await eventBus.request("plugin.dev.install", { sourcePath });
    const invocation = await eventBus.request("plugin.dev.invokeTool", {
      pluginId: "bus-dev",
      toolName: "echo",
      input: { text: "ok" },
    });

    expect(install.plugin.id).toBe("bus-dev");
    expect(invocation.result.content[0].text).toBe("Bus ok");

    unregister();
    expect(eventBus.getCapability("plugin.dev.install")).toBeNull();
  });

  it("describes UI surfaces with an element-first debug strategy", async () => {
    const sourcePath = writeDevPlugin(sourceRoot, "ui-dev", {
      trust: "full-access",
      manifest: {
        contributes: {
          page: { title: "UI Dev", route: "/page" },
        },
      },
    });
    fs.mkdirSync(path.join(sourcePath, "routes"), { recursive: true });
    await service.installFromSource({ sourcePath, allowFullAccess: true });

    const surfaces = service.listSurfaces("ui-dev");
    const descriptor = service.describeSurfaceDebug({
      pluginId: "ui-dev",
      kind: "page",
      route: "/page",
    });

    expect(surfaces).toEqual([expect.objectContaining({
      kind: "page",
      pluginId: "ui-dev",
      routeUrl: "/api/plugins/ui-dev/page",
    })]);
    expect(descriptor).toMatchObject({
      strategy: "element-first",
      elementBridge: {
        preferred: true,
        operations: expect.arrayContaining(["describeElements", "clickElement", "typeIntoElement"]),
      },
      screenshot: {
        role: expect.stringContaining("fallback"),
      },
    });
  });
});
