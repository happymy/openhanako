#!/usr/bin/env node
/**
 * smoke-mingit.mjs — Windows 上验证 MinGit runtime 能跑非交互 git 全流程 +
 * sh-compatible POSIX shell。runtime 的"真实二进制"验证（JS 单测覆盖不到）。
 *
 * 用法（Windows）：node scripts/smoke-mingit.mjs [runtimeRoot]
 *   默认 runtimeRoot = vendor/mingit
 * 退出码：全过 0，任一失败 1。
 *
 * 注意：在 macOS/Linux 上跑会 FAIL（没有 .exe），这是预期的，不要加进 npm test。
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

function envValue(env, name) {
  const match = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match?.[1] ? String(match[1]) : "";
}

/**
 * Build a Windows environment that can use only the selected MinGit runtime
 * plus Windows system binaries. In particular, never append the runner's PATH:
 * GitHub's Windows image already contains Git and would otherwise let an
 * incomplete release archive borrow DLLs or coreutils from the host install.
 */
export function createHermeticMinGitSmokeEnv({ runtimeRoot, workRoot, env = process.env }) {
  const systemRoot = envValue(env, "SystemRoot") || envValue(env, "WINDIR") || "C:\\Windows";
  const normalizedRuntimeRoot = path.win32.resolve(runtimeRoot);
  const normalizedWorkRoot = path.win32.resolve(workRoot);
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    ComSpec: envValue(env, "ComSpec") || path.win32.join(systemRoot, "System32", "cmd.exe"),
    PATHEXT: envValue(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD",
    TEMP: normalizedWorkRoot,
    TMP: normalizedWorkRoot,
    USERPROFILE: normalizedWorkRoot,
    HOME: normalizedWorkRoot,
    Path: [
      path.win32.join(normalizedRuntimeRoot, "cmd"),
      path.win32.join(normalizedRuntimeRoot, "usr", "bin"),
      path.win32.join(normalizedRuntimeRoot, "mingw64", "bin"),
      path.win32.join(systemRoot, "System32"),
    ].join(";"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "NUL",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    MSYS2_PATH_TYPE: "strict",
  };
}

function run(label, exe, args, opts = {}) {
  try {
    const out = execFileSync(exe, args, { encoding: "utf-8", timeout: 30000, ...opts });
    console.log(`PASS  ${label}: ${(out || "").trim().split(/\r?\n/)[0] || "(no output)"}`);
    return true;
  } catch (err) {
    console.error(`FAIL  ${label}: ${err.message}`);
    return false;
  }
}

// 提交身份内联传入，不依赖 CI 机器的全局 git config
const IDENT = [
  "-c", "user.email=smoke@hana.invalid",
  "-c", "user.name=hana-smoke",
];

const COREUTILS = "cat ls cp mv rm mkdir grep sed awk find sort uniq head tail wc cut tr xargs echo touch";

export function main(argv = process.argv.slice(2), env = process.env) {
  const root = path.resolve(argv[0] || path.join(process.cwd(), "vendor", "mingit"));
  const git = path.join(root, "cmd", "git.exe");
  // MinGit 不打包 bash.exe；POSIX 契约是 usr/bin/sh.exe（bash 以 sh 模式运行），参数 -c
  const sh = path.join(root, "usr", "bin", "sh.exe");
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-mingit-smoke-"));
  const repoDir = path.join(workRoot, "repo");
  const cloneDir = path.join(workRoot, "repo-copy");
  const runtimeEnv = createHermeticMinGitSmokeEnv({ runtimeRoot: root, workRoot, env });
  const runOptions = { env: runtimeEnv, cwd: workRoot };

  try {
    const results = [
      run("git --version", git, ["--version"], runOptions),
      run("git init", git, ["init", repoDir], runOptions),
      run("git status", git, ["-C", repoDir, "status", "--short", "--branch"], runOptions),
      run("git config write", git, ["-C", repoDir, "config", "hana.smoke", "1"], runOptions),
      run("git config read", git, ["-C", repoDir, "config", "hana.smoke"], runOptions),
      run("git commit", git, ["-C", repoDir, ...IDENT, "commit", "--allow-empty", "-m", "smoke"], runOptions),
      run("git rev-parse HEAD", git, ["-C", repoDir, "rev-parse", "HEAD"], runOptions),
      run("git local clone", git, ["-c", "protocol.file.allow=always", "clone", repoDir, cloneDir], runOptions),
      run("git clone status", git, ["-C", cloneDir, "status", "--short", "--branch"], runOptions),
      run("sh starts", sh, ["-c", "echo sh=ok"], runOptions),
      run("coreutils originate from archive", sh, [
        "-c",
        `missing=""; external=""; for t in ${COREUTILS}; do `
          + `resolved=$(command -v "$t" 2>/dev/null) || { missing="$missing $t"; continue; }; `
          + `case "$t:$resolved" in echo:echo|*:/usr/bin/*|*:/mingw64/bin/*) ;; `
          + `*) external="$external $t=$resolved" ;; esac; done; `
          + `if [ -n "$missing" ]; then echo "MISSING:$missing"; exit 1; fi; `
          + `if [ -n "$external" ]; then echo "EXTERNAL:$external"; exit 1; fi; echo "coreutils ok"`,
      ], runOptions),
      run("sh pipeline", sh, [
        "-c",
        "printf 'a\\nb\\nc\\n' | grep b | sed 's/b/B/' | awk '{print $1}'",
      ], runOptions),
    ];
    return results.every(Boolean) ? 0 : 1;
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  process.exit(main());
}
