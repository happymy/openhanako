import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  smokeWindowsSandboxHelper,
  windowsSandboxHelperPath,
} from "../scripts/smoke-windows-sandbox-helper.mjs";

describe("Windows sandbox helper CI smoke", () => {
  it("resolves the helper produced by the native helper build", () => {
    expect(windowsSandboxHelperPath({ rootDir: "C:\\repo", arch: "x64" }))
      .toBe(path.join("C:\\repo", "dist-sandbox", "win-x64", "hana-win-sandbox.exe"));
  });

  it("fails explicitly outside a Windows runner", () => {
    expect(() => smokeWindowsSandboxHelper({ platform: "darwin" }))
      .toThrow(/requires a Windows runner/);
  });

  it("fails explicitly when the built helper is absent", () => {
    expect(() => smokeWindowsSandboxHelper({
      rootDir: path.join(path.sep, "definitely-missing-hana-helper"),
      platform: "win32",
    })).toThrow(/helper is missing/);
  });
});
