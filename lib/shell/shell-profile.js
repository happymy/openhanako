import path from "node:path";

function envValue(env, name) {
  const source = env || {};
  const direct = source[name];
  if (direct) return direct;
  const key = Object.keys(source).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? source[key] : undefined;
}

function isWin32PathLike(filePath) {
  return /^[a-z]:[\\/]|^\\\\/i.test(String(filePath || ""));
}

function basenameForPath(filePath) {
  const raw = String(filePath || "").trim();
  if (!raw) return "";
  const base = isWin32PathLike(raw) || raw.includes("\\")
    ? path.win32.basename(raw)
    : path.basename(raw);
  return base.replace(/\.exe$/i, "");
}

function normalizeProfileName(profile) {
  const value = String(profile || "default").trim().toLowerCase();
  return value || "default";
}

function posixProfile({ id, executable, commandArgs = ["-lc"], interactiveArgs = ["-i"], env }) {
  return {
    id,
    family: "posix",
    executable,
    env,
    argsForCommand(command) {
      return [...commandArgs, String(command ?? "")];
    },
    argsForInteractive() {
      return [...interactiveArgs];
    },
  };
}

function powershellProfile({ executable, env }) {
  const baseArgs = ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"];
  return {
    id: "windows-powershell",
    family: "powershell",
    executable,
    env,
    argsForCommand(command) {
      return [...baseArgs, "-Command", String(command ?? "")];
    },
    argsForInteractive() {
      return [...baseArgs];
    },
  };
}

function cmdProfile({ executable, env }) {
  return {
    id: "windows-cmd",
    family: "cmd",
    executable,
    env,
    argsForCommand(command) {
      return ["/d", "/s", "/c", String(command ?? "")];
    },
    argsForInteractive() {
      return [];
    },
  };
}

function resolvePosixDefault({ platform, env }) {
  const executable = envValue(env, "SHELL") || "/bin/bash";
  return posixProfile({
    id: platform === "darwin" ? "macos-default" : "linux-default",
    executable,
    env,
  });
}

function resolvePowerShellDefault({ env }) {
  return powershellProfile({
    executable: envValue(env, "HANA_POWERSHELL") || "powershell.exe",
    env,
  });
}

function resolveCmdDefault({ env }) {
  return cmdProfile({
    executable: envValue(env, "COMSPEC") || "cmd.exe",
    env,
  });
}

function resolveGitBashProfile({
  env,
  resolveWin32ShellRuntime,
  getWin32ShellEnvForRuntime,
}) {
  if (typeof resolveWin32ShellRuntime !== "function") {
    throw new Error("git-bash shell profile requires resolveWin32ShellRuntime");
  }
  const shellInfo = resolveWin32ShellRuntime({ preferBundled: true, env });
  const profileEnv = typeof getWin32ShellEnvForRuntime === "function"
    ? getWin32ShellEnvForRuntime(env, shellInfo)
    : env;
  return posixProfile({
    id: "windows-git-bash",
    executable: shellInfo.shell,
    commandArgs: shellInfo.args || ["-lc"],
    interactiveArgs: ["-i"],
    env: profileEnv,
  });
}

export function resolveShellProfile({
  platform = process.platform,
  profile = "default",
  env = process.env,
  resolveWin32ShellRuntime,
  getWin32ShellEnvForRuntime,
} = {}) {
  const profileName = normalizeProfileName(profile);

  if (platform === "win32") {
    if (profileName === "cmd") return resolveCmdDefault({ env });
    if (profileName === "git-bash" || profileName === "bash") {
      return resolveGitBashProfile({
        env,
        resolveWin32ShellRuntime,
        getWin32ShellEnvForRuntime,
      });
    }
    if (profileName === "powershell" || profileName === "pwsh" || profileName === "default") {
      return resolvePowerShellDefault({ env });
    }
    throw new Error(`unsupported Windows shell profile: ${profile}`);
  }

  if (profileName !== "default" && profileName !== "posix") {
    throw new Error(`unsupported shell profile for ${platform}: ${profile}`);
  }
  return resolvePosixDefault({ platform, env });
}

export function profileLabel(profile) {
  if (!profile) return "";
  if (profile.family === "powershell") {
    return basenameForPath(profile.executable).toLowerCase() === "pwsh" ? "pwsh" : "powershell";
  }
  return basenameForPath(profile.executable) || profile.family || "";
}

export const __testing = {
  basenameForPath,
  envValue,
};
