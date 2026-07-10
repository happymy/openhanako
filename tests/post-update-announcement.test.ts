/**
 * 测试升级后首启公告的触发决策（resolvePostUpdateAnnouncement 纯函数）。
 *
 * 契约：lastSeenVersion 记录在 {HANA_HOME}/user/last-seen-version.json；
 * 全新安装静默播种（seedVersion），永不为"从无到有"弹公告；已完成
 * onboarding 却无记录 = 从没有此功能的老版本升级而来，视为升级后首启；
 * 非打包环境不弹也不写。
 */
import { describe, it, expect } from "vitest";
import { resolvePostUpdateAnnouncement } from "../desktop/src/shared/post-update-announcement.cjs";

describe("resolvePostUpdateAnnouncement", () => {
  it("dev 环境：不打扰也不写文件", () => {
    expect(resolvePostUpdateAnnouncement({ currentVersion: "1.2.0", lastSeenVersion: null, isPackagedLike: false, setupComplete: true }))
      .toEqual({ pending: false, seedVersion: null });
  });

  it("版本不可知：防御性不弹不写", () => {
    expect(resolvePostUpdateAnnouncement({ currentVersion: "", lastSeenVersion: "1.1.0", isPackagedLike: true, setupComplete: true }))
      .toEqual({ pending: false, seedVersion: null });
  });

  it("已看过当前版本：不再弹", () => {
    expect(resolvePostUpdateAnnouncement({ currentVersion: "1.2.0", lastSeenVersion: "1.2.0", isPackagedLike: true, setupComplete: true }))
      .toEqual({ pending: false, seedVersion: null });
  });

  it("全新安装（未完成 onboarding 且无记录）：静默播种，不弹", () => {
    expect(resolvePostUpdateAnnouncement({ currentVersion: "1.2.0", lastSeenVersion: null, isPackagedLike: true, setupComplete: false }))
      .toEqual({ pending: false, seedVersion: "1.2.0" });
  });

  it("老用户升到首个带此功能的版本（已完成 onboarding 但无记录）：要弹", () => {
    expect(resolvePostUpdateAnnouncement({ currentVersion: "1.2.0", lastSeenVersion: null, isPackagedLike: true, setupComplete: true }))
      .toEqual({ pending: true, seedVersion: null });
  });

  it("常规升级（记录版本与当前版本不同）：要弹", () => {
    expect(resolvePostUpdateAnnouncement({ currentVersion: "1.2.0", lastSeenVersion: "1.1.0", isPackagedLike: true, setupComplete: true }))
      .toEqual({ pending: true, seedVersion: null });
  });
});
