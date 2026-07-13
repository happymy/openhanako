import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDataEpochJournal,
  createDataEpochStamp,
  dataEpochJournalPath,
  dataEpochStampPath,
  describeDataEpochBlock,
  readDataEpochJournal,
  readDataEpochStamp,
  removeDataEpochJournal,
  writeDataEpochJournal,
  writeDataEpochStamp,
} from "../shared/data-epoch.cjs";

const tempDirs: string[] = [];

function makeHomeDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hana-data-epoch-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("data epoch stamp", () => {
  it("maps the legacy high-water shape to one fully committed epoch", () => {
    const homeDir = makeHomeDir();
    fs.writeFileSync(dataEpochStampPath(homeDir), JSON.stringify({ epoch: 3, lastVersion: "1.0.0" }));

    expect(readDataEpochStamp(homeDir)).toMatchObject({
      status: "ok",
      format: "legacy-v1",
      stamp: {
        schemaVersion: 1,
        epoch: 3,
        minimumReaderEpoch: 3,
        committedDataEpoch: 3,
        lastVersion: "1.0.0",
      },
    });
  });

  it("writes and rereads a v2 barrier/commit pair with durable JSON bytes", async () => {
    const homeDir = makeHomeDir();
    const written = await writeDataEpochStamp(homeDir, {
      minimumReaderEpoch: 4,
      committedDataEpoch: 3,
      lastVersion: "2.0.0",
    });

    expect(written).toMatchObject({
      schemaVersion: 2,
      epoch: 4,
      minimumReaderEpoch: 4,
      committedDataEpoch: 3,
      lastVersion: "2.0.0",
    });
    expect(fs.readFileSync(dataEpochStampPath(homeDir), "utf8")).toMatch(/\n$/);
    expect(readDataEpochStamp(homeDir)).toMatchObject({ status: "ok", format: "v2", stamp: written });
  });

  it("fails closed on corrupt JSON and impossible v2 epoch relationships", () => {
    const homeDir = makeHomeDir();
    fs.writeFileSync(dataEpochStampPath(homeDir), "{broken");
    expect(readDataEpochStamp(homeDir)).toMatchObject({ status: "corrupt" });

    fs.writeFileSync(dataEpochStampPath(homeDir), JSON.stringify({
      schemaVersion: 2,
      epoch: 3,
      minimumReaderEpoch: 4,
      committedDataEpoch: 3,
      lastVersion: "1.0.0",
      updatedAt: new Date().toISOString(),
    }));
    expect(readDataEpochStamp(homeDir)).toMatchObject({
      status: "corrupt",
      detail: expect.stringContaining("epoch` to equal `minimumReaderEpoch"),
    });

    expect(() => createDataEpochStamp({
      minimumReaderEpoch: 3,
      committedDataEpoch: 4,
      lastVersion: "1.0.0",
    })).toThrow(/cannot exceed/);
  });
});

describe("data epoch transition journal", () => {
  const base = {
    transitionId: "transition-1-2",
    fromEpoch: 1,
    toEpoch: 2,
    migrationIds: ["preferences-1-to-2"],
    affectedStoreIds: ["user-preferences"],
    recoveryModes: { "preferences-1-to-2": "restore-only" as const },
    lastVersion: "2.0.0",
  };

  it("requires a checkpoint receipt after the prepared phase", () => {
    expect(createDataEpochJournal({ ...base, phase: "prepared" })).toMatchObject({
      schemaVersion: 1,
      phase: "prepared",
      checkpointId: null,
      checkpointReceipt: null,
    });
    expect(() => createDataEpochJournal({ ...base, phase: "checkpoint_complete" })).toThrow(/requires a checkpoint/);
  });

  it("writes, validates, and durably removes a journal", async () => {
    const homeDir = makeHomeDir();
    const written = await writeDataEpochJournal(homeDir, {
      ...base,
      phase: "checkpoint_complete",
      checkpointId: "checkpoint-1",
      checkpointReceipt: { id: "checkpoint-1", digest: "sha256:test" },
    });

    expect(readDataEpochJournal(homeDir)).toMatchObject({ status: "ok", journal: written });
    expect(await removeDataEpochJournal(homeDir)).toBe(true);
    expect(await removeDataEpochJournal(homeDir)).toBe(false);
    expect(readDataEpochJournal(homeDir)).toMatchObject({ status: "missing" });
  });

  it("rejects malformed or unknown journal phases instead of guessing", () => {
    const homeDir = makeHomeDir();
    fs.writeFileSync(dataEpochJournalPath(homeDir), JSON.stringify({
      ...base,
      schemaVersion: 1,
      phase: "mystery",
      checkpointId: null,
      checkpointReceipt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    expect(readDataEpochJournal(homeDir)).toMatchObject({
      status: "corrupt",
      detail: expect.stringContaining("invalid phase"),
    });
  });
});

describe("describeDataEpochBlock", () => {
  it("includes both epochs, the last version, and the explicit override in both languages", () => {
    const message = describeDataEpochBlock({ stampEpoch: 5, ownEpoch: 3, stampLastVersion: "2.0.0" });
    expect(message).toContain("epoch=5");
    expect(message).toContain("epoch=3");
    expect(message).toContain("2.0.0");
    expect(message).toContain("HANA_ALLOW_DATA_DOWNGRADE=1");
    expect(message).toContain("继续使用旧内核");
  });
});
