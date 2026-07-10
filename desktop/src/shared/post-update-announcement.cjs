/**
 * post-update-announcement.cjs — 升级后首启公告的触发决策
 *
 * 契约：
 * - lastSeenVersion 记录在 {HANA_HOME}/user/last-seen-version.json，只在
 *   用户确认公告（ack）或全新安装播种（seed）时写入。
 * - 全新安装（未完成 onboarding 且无记录）静默播种当前版本，永不为
 *   "从无到有"弹公告；已完成 onboarding 却无记录 = 从没有此功能的老版本
 *   升级而来，视为升级后首启。
 * - 非打包环境不弹也不写（HANA_FORCE_ANNOUNCEMENT=1 可在开发期强制视为打包）。
 */
function resolvePostUpdateAnnouncement({ currentVersion, lastSeenVersion, isPackagedLike, setupComplete }) {
  if (!isPackagedLike) return { pending: false, seedVersion: null };
  if (typeof currentVersion !== "string" || !currentVersion) return { pending: false, seedVersion: null };
  if (lastSeenVersion === currentVersion) return { pending: false, seedVersion: null };
  if (!lastSeenVersion && !setupComplete) return { pending: false, seedVersion: currentVersion };
  return { pending: true, seedVersion: null };
}

module.exports = { resolvePostUpdateAnnouncement };
