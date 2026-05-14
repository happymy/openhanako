import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { removeSkillsFromBundles } from "../lib/skill-bundles/store.js";

describe("skill bundle store", () => {
  let tempDir;
  let engine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-skill-bundles-"));
    engine = { hanakoHome: tempDir };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not create an empty store when removing skills and no bundle store exists", () => {
    const store = removeSkillsFromBundles(engine, ["missing"]);

    expect(store).toEqual({ schemaVersion: 1, bundles: [] });
    expect(fs.existsSync(path.join(tempDir, "skill-bundles.json"))).toBe(false);
  });
});
