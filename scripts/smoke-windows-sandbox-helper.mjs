#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runRestrictedTokenHelperSmoke } from "./verify-standalone-server-artifact.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function windowsSandboxHelperPath({ rootDir = ROOT, arch = "x64" } = {}) {
  return path.join(rootDir, "dist-sandbox", `win-${arch}`, "hana-win-sandbox.exe");
}

export function smokeWindowsSandboxHelper({
  rootDir = ROOT,
  arch = "x64",
  platform = process.platform,
  env = process.env,
} = {}) {
  if (platform !== "win32") {
    throw new Error("[smoke-windows-sandbox] this smoke requires a Windows runner");
  }
  const helperPath = windowsSandboxHelperPath({ rootDir, arch });
  if (!fs.existsSync(helperPath)) {
    throw new Error(`[smoke-windows-sandbox] helper is missing: ${helperPath}`);
  }

  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-windows-sandbox-ci-"));
  const workDir = path.join(smokeRoot, "work");
  const hanaHome = path.join(smokeRoot, "hana-home");
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(hanaHome, { recursive: true });
  try {
    runRestrictedTokenHelperSmoke({
      layoutRoot: rootDir,
      workDir,
      hanaHome,
      helperPath,
      env,
    });
  } finally {
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  }
  return { helperPath };
}

export function run(argv = process.argv.slice(2)) {
  const arch = argv[0] || "x64";
  const result = smokeWindowsSandboxHelper({ arch });
  console.log(`[smoke-windows-sandbox] restricted-token helper passed: ${result.helperPath}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    run();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  }
}
