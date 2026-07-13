import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyUnstampedDataHome,
  coordinateDataEpochStartup,
  describeDataEpochStartupBlock,
  inspectDataEpochMaintenance,
  type DataEpochCheckpointProvider,
  type DataEpochFaultEvent,
} from "../core/data-epoch-coordinator.ts";
import {
  DATA_EPOCH_BREAKING_REVIEWS,
  DATA_EPOCH_MIGRATIONS,
  resolveDataEpochMigrationPath,
  type DataEpochBreakingReview,
  type DataEpochMigration,
} from "../core/data-epoch-migrations.ts";
import { DATA_EPOCH } from "../shared/contract-versions.cjs";
import {
  dataEpochJournalPath,
  dataEpochStampPath,
  readDataEpochStamp,
  writeDataEpochJournal,
  writeDataEpochStamp,
} from "../shared/data-epoch.cjs";

const tempDirs: string[] = [];

function makeHomeDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hana-epoch-coordinator-"));
  tempDirs.push(directory);
  return directory;
}

function seedLegacyStamp(homeDir: string, epoch = 1) {
  fs.writeFileSync(dataEpochStampPath(homeDir), JSON.stringify({
    epoch,
    lastVersion: `legacy-${epoch}`,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
}

function migration(id = "preferences-1-to-2", sourceEpoch = 1, targetEpoch = 2, trace: string[] = []): DataEpochMigration {
  return {
    id,
    fromEpoch: sourceEpoch,
    toEpoch: targetEpoch,
    affectedStoreIds: ["user-preferences"],
    recoveryMode: "restore-only",
    preCoordinatorReadCompatibility: "preserved",
    preflight: () => { trace.push(`preflight:${id}`); },
    migrate: () => { trace.push(`migrate:${id}`); },
    validate: () => { trace.push(`validate:${id}`); },
  };
}

function checkpointProvider(trace: string[] = []): DataEpochCheckpointProvider {
  return {
    async create(input) {
      trace.push(`checkpoint:create:${input.fromEpoch}->${input.toEpoch}`);
      return { id: `checkpoint-${input.fromEpoch}-${input.toEpoch}`, digest: "sha256:test" };
    },
    async verify(checkpoint) {
      trace.push(`checkpoint:verify:${checkpoint.id}`);
    },
  };
}

function breakingReview(fromEpoch = 1, toEpoch = 2): DataEpochBreakingReview {
  return {
    fromEpoch,
    toEpoch,
    affectedStoreIds: ["user-preferences"],
    checkpointPolicy: "Checkpoint exact preference bytes before the transition.",
    restorePolicy: "Restore through the preferences owner.",
  };
}

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("unstamped home classification", () => {
  it("distinguishes a new home, desktop bootstrap-only state, and legacy application data", () => {
    const emptyHome = makeHomeDir();
    expect(classifyUnstampedDataHome(emptyHome).classification).toBe("provably-new");

    const bootstrapHome = makeHomeDir();
    fs.mkdirSync(path.join(bootstrapHome, "artifacts", "pointers"), { recursive: true });
    fs.writeFileSync(path.join(bootstrapHome, "artifacts", "pointers", "server.current.json"), "{}");
    expect(classifyUnstampedDataHome(bootstrapHome).classification).toBe("provably-new");

    const legacyHome = makeHomeDir();
    fs.mkdirSync(path.join(legacyHome, "user"), { recursive: true });
    fs.writeFileSync(path.join(legacyHome, "user", "preferences.json"), "{}");
    expect(classifyUnstampedDataHome(legacyHome)).toMatchObject({
      classification: "legacy-baseline",
      detail: expect.stringContaining("user"),
    });

    const wrongTypeHome = makeHomeDir();
    fs.mkdirSync(path.join(wrongTypeHome, "crash.log"));
    expect(classifyUnstampedDataHome(wrongTypeHome).classification).toBe("legacy-baseline");
  });

  it("fails closed on interrupted metadata writes and symbolic links", () => {
    const temporaryWriteHome = makeHomeDir();
    fs.writeFileSync(path.join(temporaryWriteHome, "data-epoch.json.tmp-1-deadbeef"), "{}");
    expect(classifyUnstampedDataHome(temporaryWriteHome).classification).toBe("ambiguous");

    if (process.platform !== "win32") {
      const symlinkHome = makeHomeDir();
      fs.symlinkSync(os.tmpdir(), path.join(symlinkHome, "linked-data"));
      expect(classifyUnstampedDataHome(symlinkHome).classification).toBe("ambiguous");
    }
  });
});

describe("steady-state data epoch startup", () => {
  it("stamps a provably-new home directly at this kernel epoch without pretending to migrate data", async () => {
    const homeDir = makeHomeDir();
    const result = await coordinateDataEpochStartup({ homeDir, ownEpoch: 3, ownVersion: "3.0.0" });

    expect(result).toMatchObject({
      allowed: true,
      action: "stamped-new",
      minimumReaderEpoch: 3,
      committedDataEpoch: 3,
    });
    expect(readDataEpochStamp(homeDir)).toMatchObject({
      status: "ok",
      stamp: { schemaVersion: 2, minimumReaderEpoch: 3, committedDataEpoch: 3 },
    });
  });

  it("adopts an unstamped legacy home only at baseline epoch 1", async () => {
    const homeDir = makeHomeDir();
    fs.mkdirSync(path.join(homeDir, "user"), { recursive: true });
    fs.writeFileSync(path.join(homeDir, "user", "preferences.json"), "{}");

    const result = await coordinateDataEpochStartup({ homeDir, ownEpoch: 1, ownVersion: "1.0.0" });
    expect(result).toMatchObject({ allowed: true, action: "adopted-legacy", committedDataEpoch: 1 });
  });

  it("upgrades a legacy v1 stamp to v2 without changing an equal epoch", async () => {
    const homeDir = makeHomeDir();
    seedLegacyStamp(homeDir, 1);

    const result = await coordinateDataEpochStartup({ homeDir, ownEpoch: 1, ownVersion: "1.1.0" });
    expect(result).toMatchObject({ allowed: true, action: "refreshed" });
    expect(readDataEpochStamp(homeDir)).toMatchObject({
      status: "ok",
      format: "v2",
      stamp: { minimumReaderEpoch: 1, committedDataEpoch: 1, lastVersion: "1.1.0" },
    });
  });

  it("blocks a lower reader, permits only the explicit steady-state override, and never lowers the stamp", async () => {
    const homeDir = makeHomeDir();
    await writeDataEpochStamp(homeDir, { minimumReaderEpoch: 5, committedDataEpoch: 5, lastVersion: "5.0.0" });
    const before = fs.readFileSync(dataEpochStampPath(homeDir), "utf8");

    const blocked = await coordinateDataEpochStartup({ homeDir, ownEpoch: 3, ownVersion: "3.0.0" });
    expect(blocked).toMatchObject({ allowed: false, reason: "epoch-downgrade-blocked", stampEpoch: 5, ownEpoch: 3 });

    const warn = vi.fn();
    const overridden = await coordinateDataEpochStartup({
      homeDir,
      ownEpoch: 3,
      ownVersion: "3.0.0",
      allowDowngrade: true,
      log: { warn },
    });
    expect(overridden).toMatchObject({ allowed: true, action: "downgrade-allowed", minimumReaderEpoch: 5 });
    expect(warn).toHaveBeenCalledOnce();
    expect(fs.readFileSync(dataEpochStampPath(homeDir), "utf8")).toBe(before);
  });

  it("never lets the downgrade override bypass a transition journal or orphaned barrier", async () => {
    const homeDir = makeHomeDir();
    await writeDataEpochStamp(homeDir, { minimumReaderEpoch: 2, committedDataEpoch: 1, lastVersion: "2.0.0" });
    await writeDataEpochJournal(homeDir, {
      transitionId: "transition-1-2",
      fromEpoch: 1,
      toEpoch: 2,
      migrationIds: ["preferences-1-to-2"],
      recoveryModes: { "preferences-1-to-2": "restore-only" },
      phase: "barrier_raised",
      lastVersion: "2.0.0",
      affectedStoreIds: ["user-preferences"],
      checkpointId: "checkpoint-1-2",
      checkpointReceipt: { id: "checkpoint-1-2" },
    });

    const journalBlocked = await coordinateDataEpochStartup({
      homeDir,
      ownEpoch: 1,
      ownVersion: "1.0.0",
      allowDowngrade: true,
    });
    expect(journalBlocked).toMatchObject({ allowed: false, reason: "incomplete-transition", phase: "barrier_raised" });

    fs.rmSync(dataEpochJournalPath(homeDir));
    const orphanedBarrier = await coordinateDataEpochStartup({
      homeDir,
      ownEpoch: 2,
      ownVersion: "2.0.0",
      allowDowngrade: true,
    });
    expect(orphanedBarrier).toMatchObject({ allowed: false, reason: "inconsistent-transition-state" });
  });
});

describe("coordinated epoch transition", () => {
  it("requires a complete adjacent migration path and checkpoint provider before writing a journal", async () => {
    const homeDir = makeHomeDir();
    seedLegacyStamp(homeDir, 1);

    const missingEdge = await coordinateDataEpochStartup({
      homeDir,
      ownEpoch: 3,
      ownVersion: "3.0.0",
      migrations: [migration()],
      breakingReviews: [breakingReview()],
      checkpointProvider: checkpointProvider(),
    });
    expect(missingEdge).toMatchObject({
      allowed: false,
      reason: "migration-path-unavailable",
      detail: expect.stringContaining("2 -> 3"),
    });
    expect(fs.existsSync(dataEpochJournalPath(homeDir))).toBe(false);

    const missingProvider = await coordinateDataEpochStartup({
      homeDir,
      ownEpoch: 2,
      ownVersion: "2.0.0",
      migrations: [migration()],
      breakingReviews: [breakingReview()],
    });
    expect(missingProvider).toMatchObject({
      allowed: false,
      reason: "checkpoint-provider-unavailable",
      detail: expect.stringContaining("checkpoint provider"),
    });
    expect(fs.existsSync(dataEpochJournalPath(homeDir))).toBe(false);
  });

  it("runs checkpoint, barrier, migration, validation, and final commit in exact durable order", async () => {
    const homeDir = makeHomeDir();
    seedLegacyStamp(homeDir, 1);
    const trace: string[] = [];
    const faultEvents: DataEpochFaultEvent[] = [];

    const result = await coordinateDataEpochStartup({
      homeDir,
      ownEpoch: 2,
      ownVersion: "2.0.0",
      migrations: [migration("preferences-1-to-2", 1, 2, trace)],
      breakingReviews: [breakingReview()],
      checkpointProvider: checkpointProvider(trace),
      clock: () => "2026-01-02T00:00:00.000Z",
      transitionIdFactory: () => "transition-1-2",
      faultHook: (event) => { faultEvents.push(event); },
    });

    expect(result).toMatchObject({
      allowed: true,
      action: "transition-committed",
      minimumReaderEpoch: 2,
      committedDataEpoch: 2,
    });
    expect(trace).toEqual([
      "preflight:preferences-1-to-2",
      "checkpoint:create:1->2",
      "checkpoint:verify:checkpoint-1-2",
      "migrate:preferences-1-to-2",
      "validate:preferences-1-to-2",
    ]);
    expect(faultEvents).toEqual([
      "journal:prepared",
      "checkpoint:starting",
      "checkpoint:created",
      "checkpoint:verified",
      "journal:checkpoint_complete",
      "stamp:barrier",
      "journal:barrier_raised",
      "journal:migrating",
      "migration:preferences-1-to-2:before",
      "migration:preferences-1-to-2:after",
      "journal:migrated",
      "validation:preferences-1-to-2:before",
      "validation:preferences-1-to-2:after",
      "journal:validated",
      "stamp:committed",
      "journal:committed",
      "journal:remove-starting",
      "journal:removed",
    ]);
    expect(readDataEpochStamp(homeDir)).toMatchObject({
      status: "ok",
      stamp: { minimumReaderEpoch: 2, committedDataEpoch: 2 },
    });
    expect(fs.existsSync(dataEpochJournalPath(homeDir))).toBe(false);
  });

  it("records a deterministic maintenance inspection contract before checkpoint work", async () => {
    const homeDir = makeHomeDir();
    seedLegacyStamp(homeDir, 1);
    const result = await coordinateDataEpochStartup({
      homeDir,
      ownEpoch: 2,
      ownVersion: "2.0.0",
      migrations: [migration()],
      breakingReviews: [breakingReview()],
      checkpointProvider: checkpointProvider(),
      clock: () => "2026-01-02T03:04:05.000Z",
      transitionIdFactory: () => "transition-fixed",
      faultHook: (event) => {
        if (event === "journal:prepared") throw new Error("stop after prepared");
      },
    });

    expect(result).toMatchObject({ allowed: false, reason: "transition-failed" });
    expect(JSON.parse(fs.readFileSync(dataEpochJournalPath(homeDir), "utf8"))).toEqual({
      schemaVersion: 1,
      transitionId: "transition-fixed",
      fromEpoch: 1,
      toEpoch: 2,
      migrationIds: ["preferences-1-to-2"],
      affectedStoreIds: ["user-preferences"],
      recoveryModes: { "preferences-1-to-2": "restore-only" },
      phase: "prepared",
      checkpointId: null,
      checkpointReceipt: null,
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
      lastVersion: "2.0.0",
    });
    expect(inspectDataEpochMaintenance(homeDir)).toMatchObject({
      status: "incomplete",
      transitionId: "transition-fixed",
      continuation: "continue-before-migration",
    });
  });

  it("rejects a migration that does not preserve an affected pre-gate read projection", async () => {
    const homeDir = makeHomeDir();
    seedLegacyStamp(homeDir, 1);
    const unsafeMigration = { ...migration(), preCoordinatorReadCompatibility: undefined };

    const result = await coordinateDataEpochStartup({
      homeDir,
      ownEpoch: 2,
      ownVersion: "2.0.0",
      migrations: [unsafeMigration],
      breakingReviews: [breakingReview()],
      checkpointProvider: checkpointProvider(),
    });
    expect(result).toMatchObject({
      allowed: false,
      reason: "migration-contract-invalid",
      detail: expect.stringContaining("pre-coordinator read projection"),
    });
    expect(fs.existsSync(dataEpochJournalPath(homeDir))).toBe(false);
  });

  it("leaves every injected interruption fail-closed; only a proven committed tail is auto-cleaned", async () => {
    const events: DataEpochFaultEvent[] = [
      "journal:prepared",
      "checkpoint:starting",
      "checkpoint:created",
      "checkpoint:verified",
      "journal:checkpoint_complete",
      "stamp:barrier",
      "journal:barrier_raised",
      "journal:migrating",
      "migration:preferences-1-to-2:before",
      "migration:preferences-1-to-2:after",
      "journal:migrated",
      "validation:preferences-1-to-2:before",
      "validation:preferences-1-to-2:after",
      "journal:validated",
      "stamp:committed",
      "journal:committed",
      "journal:remove-starting",
      "journal:removed",
    ];

    for (const injectedEvent of events) {
      const homeDir = makeHomeDir();
      seedLegacyStamp(homeDir, 1);
      const first = await coordinateDataEpochStartup({
        homeDir,
        ownEpoch: 2,
        ownVersion: "2.0.0",
        migrations: [migration()],
        breakingReviews: [breakingReview()],
        checkpointProvider: checkpointProvider(),
        faultHook: (event) => {
          if (event === injectedEvent) throw new Error(`injected crash after ${event}`);
        },
      });
      expect(first).toMatchObject({ allowed: false, reason: "transition-failed" });

      const restart = await coordinateDataEpochStartup({ homeDir, ownEpoch: 2, ownVersion: "2.0.0" });
      const committedTail = injectedEvent === "stamp:committed"
        || injectedEvent === "journal:committed"
        || injectedEvent === "journal:remove-starting";
      const journalAlreadyRemoved = injectedEvent === "journal:removed";
      if (committedTail) {
        expect(restart).toMatchObject({ allowed: true, action: "committed-tail-cleaned" });
      } else if (journalAlreadyRemoved) {
        expect(restart).toMatchObject({ allowed: true, action: "steady" });
      } else {
        expect(restart).toMatchObject({ allowed: false, reason: "incomplete-transition" });
      }
    }
  });

  it("blocks a normal restart for every noncommitted journal phase", async () => {
    const phases = ["prepared", "checkpoint_complete", "barrier_raised", "migrating", "migrated", "validated"] as const;
    for (const phase of phases) {
      const homeDir = makeHomeDir();
      await writeDataEpochStamp(homeDir, {
        minimumReaderEpoch: phase === "prepared" || phase === "checkpoint_complete" ? 1 : 2,
        committedDataEpoch: 1,
        lastVersion: "2.0.0",
      });
      await writeDataEpochJournal(homeDir, {
        transitionId: `transition-${phase}`,
        fromEpoch: 1,
        toEpoch: 2,
        migrationIds: ["preferences-1-to-2"],
        recoveryModes: { "preferences-1-to-2": "restore-only" },
        phase,
        lastVersion: "2.0.0",
        affectedStoreIds: ["user-preferences"],
        checkpointId: phase === "prepared" ? null : `checkpoint-${phase}`,
        checkpointReceipt: phase === "prepared" ? null : { id: `checkpoint-${phase}` },
      });

      const result = await coordinateDataEpochStartup({ homeDir, ownEpoch: 2, ownVersion: "2.0.0" });
      expect(result).toMatchObject({ allowed: false, reason: "incomplete-transition", phase });
      expect(describeDataEpochStartupBlock(result as Extract<typeof result, { allowed: false }>)).toContain("不会自动续跑");
    }
  });

  it("exposes resume, restore, validated-commit, and committed-tail outcomes without changing disk", async () => {
    const cases = [
      { phase: "migrating" as const, recoveryMode: "resume-idempotent" as const, continuation: "resume-idempotent" },
      { phase: "migrated" as const, recoveryMode: "restore-only" as const, continuation: "restore-only" },
      { phase: "validated" as const, recoveryMode: "restore-only" as const, continuation: "commit-validated" },
      { phase: "committed" as const, recoveryMode: "restore-only" as const, continuation: "finalize-committed-tail" },
    ];
    for (const item of cases) {
      const homeDir = makeHomeDir();
      await writeDataEpochStamp(homeDir, {
        minimumReaderEpoch: 2,
        committedDataEpoch: item.phase === "committed" ? 2 : 1,
        lastVersion: "2.0.0",
      });
      await writeDataEpochJournal(homeDir, {
        transitionId: `transition-${item.phase}`,
        fromEpoch: 1,
        toEpoch: 2,
        migrationIds: ["preferences-1-to-2"],
        affectedStoreIds: ["user-preferences"],
        recoveryModes: { "preferences-1-to-2": item.recoveryMode },
        phase: item.phase,
        checkpointId: "checkpoint-1-2",
        checkpointReceipt: { id: "checkpoint-1-2" },
        lastVersion: "2.0.0",
      });
      const before = fs.readFileSync(dataEpochJournalPath(homeDir), "utf8");
      expect(inspectDataEpochMaintenance(homeDir)).toMatchObject({
        status: "incomplete",
        phase: item.phase,
        continuation: item.continuation,
      });
      expect(fs.readFileSync(dataEpochJournalPath(homeDir), "utf8")).toBe(before);
    }
  });

  it("does not mistake cleanup of an older committed tail for readiness at a newer kernel epoch", async () => {
    const homeDir = makeHomeDir();
    await writeDataEpochStamp(homeDir, { minimumReaderEpoch: 2, committedDataEpoch: 2, lastVersion: "2.0.0" });
    await writeDataEpochJournal(homeDir, {
      transitionId: "transition-1-2",
      fromEpoch: 1,
      toEpoch: 2,
      migrationIds: ["preferences-1-to-2"],
      affectedStoreIds: ["user-preferences"],
      recoveryModes: { "preferences-1-to-2": "restore-only" },
      phase: "committed",
      checkpointId: "checkpoint-1-2",
      checkpointReceipt: { id: "checkpoint-1-2" },
      lastVersion: "2.0.0",
    });

    const result = await coordinateDataEpochStartup({
      homeDir,
      ownEpoch: 3,
      ownVersion: "3.0.0",
      migrations: [migration("preferences-2-to-3", 2, 3)],
      breakingReviews: [breakingReview(2, 3)],
    });
    expect(result).toMatchObject({ allowed: false, reason: "checkpoint-provider-unavailable", fromEpoch: 2, toEpoch: 3 });
    expect(fs.existsSync(dataEpochJournalPath(homeDir))).toBe(false);
  });

  it("classifies a journal/stamp contradiction as corruption rather than a resumable transition", async () => {
    const homeDir = makeHomeDir();
    await writeDataEpochStamp(homeDir, { minimumReaderEpoch: 1, committedDataEpoch: 1, lastVersion: "2.0.0" });
    await writeDataEpochJournal(homeDir, {
      transitionId: "transition-contradiction",
      fromEpoch: 1,
      toEpoch: 2,
      migrationIds: ["preferences-1-to-2"],
      affectedStoreIds: ["user-preferences"],
      recoveryModes: { "preferences-1-to-2": "resume-idempotent" },
      phase: "migrating",
      checkpointId: "checkpoint-1-2",
      checkpointReceipt: { id: "checkpoint-1-2" },
      lastVersion: "2.0.0",
    });

    expect(inspectDataEpochMaintenance(homeDir)).toMatchObject({ status: "corrupt", reason: "corrupt-transition" });
    expect(await coordinateDataEpochStartup({ homeDir, ownEpoch: 2, ownVersion: "2.0.0" })).toMatchObject({
      allowed: false,
      reason: "corrupt-transition",
    });
  });
});

describe("migration registry", () => {
  it("keeps the production registry empty at epoch 1 and requires a complete path after any future bump", () => {
    if (DATA_EPOCH === 1) {
      expect(DATA_EPOCH_MIGRATIONS).toEqual([]);
      expect(DATA_EPOCH_BREAKING_REVIEWS).toEqual([]);
      return;
    }
    expect(() => resolveDataEpochMigrationPath(
      1,
      DATA_EPOCH,
      DATA_EPOCH_MIGRATIONS,
      DATA_EPOCH_BREAKING_REVIEWS,
    )).not.toThrow();
  });

  it("orders multiple adjacent edges deterministically and returns their exact affected-store union", () => {
    const pathPlan = resolveDataEpochMigrationPath(1, 3, [
      migration("z-second-on-1-2", 1, 2),
      migration("edge-2-3", 2, 3),
      migration("a-first-on-1-2", 1, 2),
    ], [breakingReview(1, 2), breakingReview(2, 3)]);
    expect(pathPlan.steps.map((entry) => entry.id)).toEqual([
      "a-first-on-1-2",
      "z-second-on-1-2",
      "edge-2-3",
    ]);
    expect(pathPlan.affectedStoreIds).toEqual(["user-preferences"]);
  });

  it("rejects an affected-store union that does not exactly match the breaking review", () => {
    expect(() => resolveDataEpochMigrationPath(1, 2, [migration()], [{
      ...breakingReview(),
      affectedStoreIds: ["agent-facts-sqlite"],
    }])).toThrow(/does not match its breaking review/);
  });
});
