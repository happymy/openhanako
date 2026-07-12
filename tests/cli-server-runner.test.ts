import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { resolveRendererDistPointer, resolveServerSpawnSpec } from "../cli/server-runner.ts";

const require = createRequire(import.meta.url);
const pointerStore = require("../shared/artifact-core/pointer-store.cjs");
const { rendererPointerChannel } = require("../shared/artifact-core/pointer-channels.cjs");

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hana-cli-runner-"));
}

/**
 * Writes a `current` renderer pointer for `channel` under `hanaHome`. When
 * `withReceipt` is true the versioned directory + matching `.verified`
 * receipt are also written, so `activation.resolveBoot` judges it valid;
 * when false the pointer file exists but nothing backs it (simulating an
 * externally deleted/corrupted version directory).
 */
async function writeRendererPointer(hanaHome, channel, { version = "9.9.9", withReceipt }: { version?: string; withReceipt: boolean }) {
  const rendererChannel = rendererPointerChannel(channel);
  const versionDir = path.join(hanaHome, "artifacts", "renderer", version);
  const sha256 = "0".repeat(64);
  if (withReceipt) {
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, "mobile.html"), "<!doctype html>", "utf-8");
    fs.writeFileSync(
      path.join(versionDir, ".verified"),
      JSON.stringify({ sha256, train: 1, version, activatedAt: new Date().toISOString() }),
      "utf-8",
    );
  }
  await pointerStore.writePointer(hanaHome, rendererChannel, "current", {
    train: 1,
    channel: rendererChannel,
    kind: "renderer",
    version,
    platformArch: null,
    versionDir,
    sha256,
    activatedAt: new Date().toISOString(),
  });
  return versionDir;
}

describe("CLI server runner", () => {
  let tmpDir = null;
  let hanaHome = null;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (hanaHome) fs.rmSync(hanaHome, { recursive: true, force: true });
    tmpDir = null;
    hanaHome = null;
  });

  it("runs the source server entry in development", async () => {
    tmpDir = makeTmpDir();
    hanaHome = makeTmpDir(); // isolated HANA_HOME — never touch the real user home's pointers
    const spec = await resolveServerSpawnSpec({
      projectRoot: tmpDir,
      env: { HANA_HOME: hanaHome },
      extraArgs: ["--chat"],
    });

    expect(spec).toMatchObject({
      mode: "source",
      command: process.execPath,
    });
    expect(spec.args).toEqual([path.join(tmpDir, "server", "index.ts"), "--chat"]);
    expect(spec.env.HANA_RENDERER_DIST).toBeUndefined();
  });

  it("runs the packaged bootstrap entry when HANA_ROOT is available", async () => {
    tmpDir = makeTmpDir();
    hanaHome = makeTmpDir();
    fs.mkdirSync(path.join(tmpDir, "bundle"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "bootstrap.js"), "", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "bundle", "index.js"), "", "utf-8");

    const spec = await resolveServerSpawnSpec({
      projectRoot: "/source/project",
      env: { HANA_ROOT: tmpDir, HANA_HOME: hanaHome },
      extraArgs: [],
    });

    expect(spec.mode).toBe("packaged");
    expect(spec.args).toEqual([path.join(tmpDir, "bootstrap.js")]);
    expect(spec.env.HANA_ROOT).toBe(tmpDir);
    expect(spec.env.HANA_SERVER_ENTRY).toBe(path.join(tmpDir, "bundle", "index.js"));
  });

  it("injects HANA_RENDERER_DIST into the spawn env when a valid renderer pointer exists", async () => {
    tmpDir = makeTmpDir();
    hanaHome = makeTmpDir();
    const versionDir = await writeRendererPointer(hanaHome, "stable", { withReceipt: true });

    const spec = await resolveServerSpawnSpec({
      projectRoot: tmpDir,
      env: { HANA_HOME: hanaHome },
      extraArgs: [],
    });

    expect(spec.env.HANA_RENDERER_DIST).toBe(versionDir);
    expect(spec.rendererDist).toEqual({ distDir: versionDir, version: "9.9.9", valid: true });
  });
});

describe("resolveRendererDistPointer (CLI pointer resolution layer)", () => {
  let hanaHome = null;

  afterEach(() => {
    if (hanaHome) fs.rmSync(hanaHome, { recursive: true, force: true });
    hanaHome = null;
  });

  it("pointer present and validated -> returns the versionDir, valid: true", async () => {
    hanaHome = makeTmpDir();
    const versionDir = await writeRendererPointer(hanaHome, "stable", { withReceipt: true });

    const result = await resolveRendererDistPointer({ hanaHome, channel: "stable" });
    expect(result).toEqual({ distDir: versionDir, version: "9.9.9", valid: true });
  });

  it("no pointer at all (never bundle pull'd) -> returns null, caller must not set the env var", async () => {
    hanaHome = makeTmpDir();

    const result = await resolveRendererDistPointer({ hanaHome, channel: "stable" });
    expect(result).toBeNull();
  });

  it("pointer present but its versionDir is missing/corrupted -> still returns the (invalid) versionDir, not null", async () => {
    hanaHome = makeTmpDir();
    const versionDir = await writeRendererPointer(hanaHome, "stable", { withReceipt: false });

    const result = await resolveRendererDistPointer({ hanaHome, channel: "stable" });
    // Damage must stay visible: the caller sets HANA_RENDERER_DIST to this
    // broken path anyway so the server lands in its explicit error mode,
    // instead of this function silently reporting "nothing to inject"
    // (which would masquerade as the guide-mode "never installed" case).
    expect(result).toEqual({ distDir: versionDir, version: "9.9.9", valid: false });
  });

  it("channels are namespaced independently (a beta pointer does not satisfy a stable resolve)", async () => {
    hanaHome = makeTmpDir();
    await writeRendererPointer(hanaHome, "beta", { withReceipt: true });

    const result = await resolveRendererDistPointer({ hanaHome, channel: "stable" });
    expect(result).toBeNull();
  });
});
