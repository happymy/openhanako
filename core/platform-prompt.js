import os from "node:os";
import path from "node:path";

const DEFAULT_SANDBOX_MODE = "read-all_write-scoped_network-on";

function envValue(env, name) {
  const source = env || {};
  const direct = source[name];
  if (direct) return direct;
  const key = Object.keys(source).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? source[key] : undefined;
}

function shellNameFromPath(shellPath) {
  const raw = String(shellPath || "").trim();
  if (!raw) return "";
  return path.basename(raw).replace(/(?:\.exe)$/i, "");
}

function getExecShellLabel(platform, env = process.env) {
  if (platform === "win32") return "powershell";
  return shellNameFromPath(envValue(env, "SHELL")) || "bash";
}

export function getPlatformPromptNote({
  platform = process.platform,
  osType = os.type(),
  osRelease = os.release(),
  cwd = "",
  env = process.env,
} = {}) {
  return [
    "<environment_context>",
    `  <platform>${platform}</platform>`,
    `  <cwd>${cwd}</cwd>`,
    `  <shell>${getExecShellLabel(platform, env)}</shell>`,
    `  <os>${osType} ${osRelease}</os>`,
    `  <sandbox_mode>${DEFAULT_SANDBOX_MODE}</sandbox_mode>`,
    "</environment_context>",
    "Use structured file tools for source edits. Use shell for builds, tests, scripts, and command-line tools.",
  ].join("\n");
}
