/**
 * compile.js — 记忆编译器（v3 四块独立编译 + assemble）
 *
 * 四个独立函数各自有指纹缓存，互不依赖：
 *   compileToday()    → today.md（当天 sessions）
 *   compileWeek()     → week.md（过去7天滑动窗口）
 *   compileLongterm() → longterm.md（fold 周报到长期）
 *   compileFacts()    → facts.md（重要事实，继承上一版）
 *
 * assemble() 同步读取四个文件，拼成 memory.md（≤2000 token）。
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getLogicalDay } from "../time-utils.js";
import { callText } from "../../core/llm-client.js";
import { getLocale } from "../../server/i18n.js";
import { safeReadFile } from "../../shared/safe-fs.js";

function _isZh() { return getLocale().startsWith("zh"); }

const EMPTY_MEMORY_ZH = "（暂无记忆）\n";
const EMPTY_MEMORY_EN = "(No memory yet)\n";
export function getEmptyMemory() { return _isZh() ? EMPTY_MEMORY_ZH : EMPTY_MEMORY_EN; }

// ════════════════════════════
//  v3 四块独立编译 + assemble
// ════════════════════════════

/**
 * 编译今天的 session 摘要 → today.md
 * @param {import('./session-summary.js').SessionSummaryManager} summaryManager
 * @param {string} outputPath
 * @param {{ model: string, api: string, api_key: string, base_url: string }} resolvedModel
 * @returns {Promise<"compiled"|"skipped">}
 */
export async function compileToday(summaryManager, outputPath, resolvedModel) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const { rangeStart } = getLogicalDay();
  const sessions = summaryManager.getSummariesInRange(rangeStart, new Date());
  const fpPath = outputPath + ".fingerprint";

  // 空 sessions 不写 fingerprint：rollingSummary 失败期会让 sessions 持续为空，
  // 若落下 "empty" 指纹，之后 summary 恢复前该指纹仍会命中（因为下一次也是 empty），
  // 导致 today.md 永远卡在 0 bytes。只在有真实 session 摘要时用 fingerprint 去重。
  if (sessions.length === 0) {
    try { fs.unlinkSync(fpPath); } catch {}
    const cur = safeReadFile(outputPath, "");
    if (cur.length > 0) atomicWrite(outputPath, "");
    return "compiled";
  }

  const fpKeys = sessions.map((s) => `${s.session_id}:${s.updated_at}`);
  const fp = computeFingerprint(fpKeys);
  try {
    if (fs.readFileSync(fpPath, "utf-8").trim() === fp && fs.existsSync(outputPath)) return "skipped";
  } catch {}

  const input = sessions.map((s) => s.summary).join("\n\n---\n\n");
  const isZh = _isZh();
  const result = await _compactLLM(
    input,
    isZh
      ? `请把今天的对话摘要整理成一份"粗颗粒事件清单"。

提炼原则：
- 把同一主题/项目的多次往返归并为一件事，不要逐条流水账
- 时间标注用主时段（"上午/傍晚"或粗略 HH:MM 区间），不需精确到分钟
- 优先记录事件层（做了什么、决定了什么、遇到了什么），不记录过程层（怎么做的、用了什么工具、什么格式）

不要记录：
- 任务过程中的方法论选择、工具偏好、格式要求、术语规则
- 助手具体产出的内容（"生成了一篇关于 X 的文章"够了，不要摘录文章内容）
- 来回修改、重试、被打断又恢复这类过程波动

输出 3-5 条粗颗粒事件，每条 1-2 句。最多 300 字。一天平淡就写得短。直接输出概要文本。`
      : `Distill today's conversation summaries into a "coarse-grained event list".

Principles:
- Merge multiple back-and-forth on the same topic/project into ONE event; do not enumerate line by line
- Time markers use major periods ("morning/evening" or rough HH:MM range), no minute-level precision
- Record at the event layer (what was done, decided, encountered), not the process layer (how, with what tools, in what format)

Do NOT record:
- Task-level methodology choices, tool preferences, format requirements, terminology rules
- Specific content of assistant's output ("wrote an article about X" is enough; do not excerpt the article)
- Revisions, retries, interruptions and resumptions — these are process noise

Output 3-5 coarse events, 1-2 sentences each. Max 180 words. Keep it short on quiet days. Output the overview text directly.`,
    resolvedModel,
    450,
  );

  atomicWrite(outputPath, result);
  fs.writeFileSync(fpPath, fp);
  return "compiled";
}

/**
 * 编译过去 7 天滑动窗口的摘要 → week.md
 * @param {object} resolvedModel
 */
export async function compileWeek(summaryManager, outputPath, resolvedModel) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

  const sessions = summaryManager.getSummariesInRange(sevenDaysAgo, now);
  const fpPath = outputPath + ".fingerprint";

  // 空 sessions 不写 fingerprint：同 compileToday 的理由，避免失败态被指纹锁死。
  if (sessions.length === 0) {
    try { fs.unlinkSync(fpPath); } catch {}
    const cur = safeReadFile(outputPath, "");
    if (cur.length > 0) atomicWrite(outputPath, "");
    return "compiled";
  }

  const fpKeys = sessions.map((s) => `${s.session_id}:${s.updated_at}`);
  const fp = computeFingerprint(fpKeys);
  try {
    if (fs.readFileSync(fpPath, "utf-8").trim() === fp && fs.existsSync(outputPath)) return "skipped";
  } catch {}

  const input = sessions.map((s) => s.summary).join("\n\n---\n\n");
  const isZh = _isZh();
  const result = await _compactLLM(
    input,
    isZh
      ? `请把过去 7 天的对话摘要整理成一份"本周主题概要"。

关键定位：到 week 这一层，记录已经是粗线条的了。它不是"每天发生的事"的集合，而是再上一层——归纳一周内的主线、重要事实、重要的工作内容。读这份记录的人只需要知道"这周大致发生了什么"，不需要知道任何过程细节。

提炼层级：
- 持续性的工作主题（"本周持续在打磨 X 项目"、"花了几天在做 Y"）放最前
- 够分量的单次事件（如"周三完成了 Z 的归档"、"周末发布了 W"）次之
- 时间用模糊表述（"周初/前几天/这两天"），不留精确时间戳

明确不要保留的内容：
- 任务过程中的细节（怎么做的、改了几遍、被打断又恢复）
- 任务过程中的方法论、工具、格式选择
- 单次对话内的来回修改、临时决定
- 助手的具体产出内容
- 不重要的杂事（普通的闲聊、查询、调试）

只记录"这周大致发生了哪些粗线条的事"——重要的工作内容、重要的决策、重要的事实。其他可以不写。

输出 3-5 条本周主题/事件。最多 400 字。直接输出概要文本。`
      : `Distill the past 7 days' conversation summaries into a "weekly theme overview".

Positioning: at the week layer, the record is already coarse-grained. It is NOT a collection of "what happened each day" — it is one level above: distilling the main threads, important facts, and important work of the week. The reader only needs to know "roughly what happened this week", not any process detail.

Layering:
- Persistent work themes ("spent the week polishing project X", "several days on Y") come first
- Substantial single events (e.g. "archived Z on Wednesday", "shipped W over the weekend") come second
- Time is vague ("early in the week / a few days ago / these last two days"); do NOT preserve exact timestamps

Explicitly do NOT keep:
- Task-level details (how it was done, how many revisions, interruptions and resumptions)
- Task-level methodology, tools, format choices
- Within-conversation revisions and temporary decisions
- Specific content of assistant's output
- Trivial activity (small talk, lookups, debugging)

Record only "what coarse-grained things happened this week" — important work, important decisions, important facts. Skip the rest.

Output 3-5 weekly themes/events. Max 240 words. Output the overview text directly.`,
    resolvedModel,
    600,
  );

  atomicWrite(outputPath, result);
  fs.writeFileSync(fpPath, fp);
  return "compiled";
}

/**
 * 将 week.md fold 进 longterm.md（每日一次）
 * @param {object} resolvedModel
 */
export async function compileLongterm(weekMdPath, longtermPath, resolvedModel) {
  fs.mkdirSync(path.dirname(longtermPath), { recursive: true });

  const weekContent = safeReadFile(weekMdPath, "").trim();

  if (!weekContent) return "skipped";

  // fingerprint：week.md 内容没变就跳过，避免每天把同一批内容反复折叠
  const fp = computeFingerprint([weekContent]);
  const fpPath = longtermPath + ".fingerprint";
  try {
    if (fs.readFileSync(fpPath, "utf-8").trim() === fp && fs.existsSync(longtermPath)) return "skipped";
  } catch {}

  const prevLongterm = safeReadFile(longtermPath, "").trim();

  const isZh = _isZh();
  const input = prevLongterm
    ? (isZh
        ? `## 上一份长期情况\n\n${prevLongterm}\n\n## 本周新增\n\n${weekContent}`
        : `## Previous long-term context\n\n${prevLongterm}\n\n## This week's additions\n\n${weekContent}`)
    : weekContent;

  const result = await _compactLLM(
    input,
    isZh
      ? `请把以下内容整合成一份长期背景记录。

到 longterm 这一层，记录已经是最稳定的核心。只保留"如果一年后回看仍然成立"的内容：
- 持续在做的项目/主题方向
- 反复出现的工作模式或兴趣点
- 跨时间的角色/身份/关系变化

去掉这些"单次性内容"：
- 某天/某周完成的具体任务
- 任务过程中的方法论、工具、格式选择
- 助手的具体产出内容
- 任何"这周/那周"级别的细节

最多 400 字。直接输出记录文本。`
      : `Consolidate the following into a long-term background record.

At the longterm layer, the record is the most stable core. Keep only what would still hold "if reviewed a year from now":
- Persistent projects / theme directions
- Recurring work patterns or interests
- Cross-temporal changes in role / identity / relationships

Remove these "one-off" contents:
- Specific tasks completed on a particular day or week
- Task-level methodology, tools, format choices
- Specific content of assistant's output
- Any "this week / that week" level details

Max 240 words. Output the record text directly.`,
    resolvedModel,
    600,
  );

  atomicWrite(longtermPath, result);
  fs.writeFileSync(fpPath, fp);
  return "compiled";
}

/**
 * 从近期 session 摘要的 ## 重要事实 段编译 facts.md
 * @param {object} resolvedModel
 */
export async function compileFacts(summaryManager, outputPath, resolvedModel) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // 读取上一版 facts.md 作为继承基础（避免 30 天外的稳定属性丢失）
  const prevFacts = safeReadFile(outputPath, "").trim();

  // 取最近 30 天的新摘要，提取 ## 重要事实 段
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const sessions = summaryManager.getSummariesInRange(thirtyDaysAgo, now);

  const factParts = [];
  for (const s of sessions) {
    if (!s.summary) continue;
    const m = s.summary.match(/##\s*重要事实\s*\n([\s\S]*?)(?=\n##|$)/);
    if (m) {
      const text = m[1].trim();
      if (text && text !== "无") factParts.push(text);
    }
  }

  // 没有新摘要时：保留旧 facts 原样
  if (factParts.length === 0) {
    if (!prevFacts) atomicWrite(outputPath, "");
    return "compiled";
  }

  // 把旧 facts 和新摘要里的事实合并后去重
  const newFacts = factParts.join("\n");
  const combined = prevFacts
    ? `${prevFacts}\n${newFacts}`
    : newFacts;

  // 字数少直接写入，不调 LLM
  if (combined.length < 500) {
    atomicWrite(outputPath, combined);
    return "compiled";
  }

  const isZh = _isZh();
  const result = await _compactLLM(
    combined,
    isZh
      ? "将以下重要事实去重合并（200字以内）。只保留稳定的、跨时间有效的用户属性：身份、偏好、关系、习惯。矛盾时以最新为准。直接输出事实列表。"
      : "Deduplicate and merge the following key facts (under 120 words). Keep only stable, time-persistent user attributes: identity, preferences, relationships, habits. When facts conflict, prefer the latest. Output the fact list directly.",
    resolvedModel,
    300,
  );

  atomicWrite(outputPath, result);
  return "compiled";
}

/**
 * 将四个中间文件组装成 memory.md（同步，不调 LLM）
 * @param {string} factsPath
 * @param {string} todayPath
 * @param {string} weekPath
 * @param {string} longtermPath
 * @param {string} memoryMdPath
 */
export function assemble(factsPath, todayPath, weekPath, longtermPath, memoryMdPath) {
  const read = (p) => { try { return fs.readFileSync(p, "utf-8").trim(); } catch { return ""; } };

  const facts    = read(factsPath);
  const today    = read(todayPath);
  const week     = read(weekPath);
  const longterm = read(longtermPath);

  // 四个标题始终保留，空栏写占位符，避免格式漂移
  const isZh = _isZh();
  const empty = isZh ? "（暂无）" : "(none)";
  const section = (title, content) =>
    `## ${title}\n\n${content || empty}`;

  const md = [
    section(isZh ? "重要事实" : "Key facts", facts),
    section(isZh ? "今天" : "Today", today),
    section(isZh ? "本周早些时候" : "Earlier this week", week),
    section(isZh ? "长期情况" : "Long-term context", longterm),
  ].join("\n\n") + "\n";

  atomicWrite(memoryMdPath, md);
}

/**
 * 通用 LLM 压缩调用（内部）
 * @param {string} input
 * @param {string} systemPrompt
 * @param {{ model: string, api: string, api_key: string, base_url: string }} resolvedModel
 * @param {number} maxTokens
 */
async function _compactLLM(input, systemPrompt, resolvedModel, maxTokens) {
  const { model, api, api_key, base_url } = resolvedModel;
  return callText({
    api, model,
    apiKey: api_key,
    baseUrl: base_url,
    messages: [{ role: "user", content: input }],
    systemPrompt,
    temperature: 0.3,
    maxTokens: maxTokens,
    timeoutMs: 60_000,
  });
}

// ════════════════════════════
//  辅助
// ════════════════════════════

function computeFingerprint(keys) {
  return crypto.createHash("md5").update(keys.join("\n")).digest("hex");
}

function atomicWrite(filePath, content) {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}
