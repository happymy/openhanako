import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HanaEngine } from "../core/engine.js";

describe("HanaEngine.buildTools", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  it("throws when opts.agentDir points at an unknown agent instead of using focus tools", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-build-tools-"));
    const focusAgentDir = path.join(tmpDir, "agents", "focus");
    const missingAgentDir = path.join(tmpDir, "agents", "missing");

    const engine = Object.create(HanaEngine.prototype);
    engine.hanakoHome = tmpDir;
    engine.getAgent = vi.fn(() => null);
    engine._pluginManager = null;
    engine._prefs = { getFileBackup: () => ({ enabled: false }) };
    engine._readPreferences = () => ({ sandbox: true });
    engine._agentMgr = {
      agent: {
        id: "focus",
        agentDir: focusAgentDir,
        tools: [{ name: "focus_custom_tool", execute: vi.fn() }],
      },
    };

    expect(() => engine.buildTools(tmpDir, undefined, {
      agentDir: missingAgentDir,
      workspace: tmpDir,
    })).toThrow(/agent "missing" not found/);
  });

  it("uses an explicit permission mode provider instead of the desktop session default", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-build-tools-"));
    const agentDir = path.join(tmpDir, "agents", "focus");
    const sessionPath = path.join(tmpDir, "sessions", "bridge.jsonl");
    const execute = vi.fn(async () => ({ details: { executed: true } }));
    const confirmStore = {
      create: vi.fn(() => ({
        confirmId: "confirm-tool-1",
        promise: Promise.resolve({ action: "rejected" }),
      })),
    };

    const engine = Object.create(HanaEngine.prototype);
    engine.hanakoHome = tmpDir;
    engine.getAgent = vi.fn(() => ({ id: "focus", agentDir, tools: [] }));
    engine._pluginManager = null;
    engine._prefs = { getFileBackup: () => ({ enabled: false }) };
    engine._readPreferences = () => ({ sandbox: true });
    engine._confirmStore = confirmStore;
    engine._emitEvent = vi.fn();
    engine.getSessionPermissionMode = vi.fn(() => "ask");
    engine._agentMgr = {
      agent: {
        id: "focus",
        agentDir,
        tools: [],
      },
    };

    const { customTools } = engine.buildTools(tmpDir, [
      { name: "stage_files", execute },
    ], {
      agentDir,
      workspace: tmpDir,
      getPermissionMode: () => "operate",
    });

    const result = await customTools[0].execute(
      "call-1",
      { path: "x" },
      { sessionManager: { getSessionFile: () => sessionPath } },
    );

    expect(confirmStore.create).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
    expect(result.details.executed).toBe(true);
  });
});
