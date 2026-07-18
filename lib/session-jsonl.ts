import fs from "fs";
import path from "path";

export function sessionIdFromFilename(filename) {
  return filename.replace(/\.jsonl$/, "");
}

export function isSessionJsonlFilename(filename) {
  const name = path.basename(String(filename || ""));
  return !!name
    && name === filename
    && name.endsWith(".jsonl")
    && !name.includes(".repair.jsonl");
}

export function listSessionFiles(sessionDir) {
  const results = [];

  function scanDir(dir, prefix) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!isSessionJsonlFilename(f)) continue;
        const filePath = path.join(dir, f);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            results.push({
              sessionId: sessionIdFromFilename(path.basename(filePath)),
              filename: prefix ? `${prefix}/${f}` : f,
              filePath,
              mtime: stat.mtime,
            });
          }
        } catch {}
      }
    } catch {}
  }

  if (!sessionDir) return results;
  scanDir(sessionDir, null);
  scanDir(path.join(sessionDir, "bridge", "owner"), "bridge/owner");
  return results;
}

/**
 * 从 session JSONL 文件提取消息列表（带时间戳）。
 *
 * Pi session 是 append-only tree：物理文件可能同时保留已经抛弃的旧分支，
 * 最后一条可解析 tree entry 才是当前 leaf。这里必须先读取完整文件并沿 parentId
 * 回溯 root → leaf，再做时间过滤。只读文件尾部无法证明父链完整，会把记忆/日记
 * 截成残缺上下文；线性扫描则会把隐藏分支重新写进长期记忆。
 *
 * `full` 保留为兼容参数。分支正确性要求所有调用都完整读取。
 */
export function readSessionMessages(filePath, opts: { since?: any; full?: boolean } = {}) {
  const since = opts.since && !Number.isNaN(Date.parse(opts.since))
    ? Date.parse(opts.since)
    : null;
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return { messages: [], lastTimestamp: null };
  }

  const parsedEntries = [];
  let hasTreeEntries = false;
  let leafId = null;
  const byId = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry || entry.type === "session") continue;
      parsedEntries.push(entry);
      if (typeof entry.id === "string" && entry.id) {
        hasTreeEntries = true;
        leafId = entry.id;
        byId.set(entry.id, entry);
      }
    } catch {
      // 单行损坏只丢弃该行，避免局部坏数据阻断整条记忆/日记链路。
    }
  }

  let activeEntries = parsedEntries;
  if (hasTreeEntries && leafId) {
    const reversed = [];
    const seen = new Set();
    let current = byId.get(leafId);
    while (current && typeof current.id === "string" && !seen.has(current.id)) {
      reversed.push(current);
      seen.add(current.id);
      current = typeof current.parentId === "string" && current.parentId
        ? byId.get(current.parentId)
        : null;
    }
    activeEntries = reversed.reverse();
  }

  const messages = [];
  let lastTimestamp = null;

  for (const entry of activeEntries) {
    if (entry.type !== "message" || !entry.message) continue;
    const { role, content } = entry.message;
    if (role !== "user" && role !== "assistant") continue;
    const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
    if (since !== null && (Number.isNaN(ts) || ts <= since)) continue;
    messages.push({ role, content, timestamp: entry.timestamp || null });
    if (entry.timestamp) lastTimestamp = entry.timestamp;
  }

  return { messages, lastTimestamp };
}
