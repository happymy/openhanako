import { describe, expect, it } from "vitest";

import { createHermeticMinGitSmokeEnv } from "../scripts/smoke-mingit.mjs";

describe("MinGit release smoke environment", () => {
  it("does not inherit a host Git or arbitrary runner PATH entries", () => {
    const env = createHermeticMinGitSmokeEnv({
      runtimeRoot: "C:\\downloads\\HanaCore\\git",
      workRoot: "C:\\Temp\\hana smoke",
      env: {
        SystemRoot: "C:\\Windows",
        PATH: "C:\\host-git\\cmd;C:\\tools;C:\\Windows\\System32",
        Path: "C:\\second-host-git\\bin",
        GIT_EXEC_PATH: "C:\\host-git\\mingw64\\libexec\\git-core",
        GIT_CONFIG_GLOBAL: "C:\\host\\.gitconfig",
        NODE_OPTIONS: "--require C:\\host\\inject.cjs",
      },
    });

    expect(env.Path).toBe([
      "C:\\downloads\\HanaCore\\git\\cmd",
      "C:\\downloads\\HanaCore\\git\\usr\\bin",
      "C:\\downloads\\HanaCore\\git\\mingw64\\bin",
      "C:\\Windows\\System32",
    ].join(";"));
    expect(env.Path).not.toContain("host-git");
    expect(env).not.toHaveProperty("GIT_EXEC_PATH");
    expect(env).not.toHaveProperty("NODE_OPTIONS");
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(env.GIT_CONFIG_GLOBAL).toBe("NUL");
    expect(env.HOME).toBe("C:\\Temp\\hana smoke");
  });
});
