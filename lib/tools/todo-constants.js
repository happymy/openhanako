/**
 * todo-constants.js — 共享的 todo tool 相关常量
 *
 * 作为前后端筛选 todo 相关 tool_result 的单一来源。
 * 前端镜像在 desktop/src/react/utils/todo-constants.ts，必须保持同步。
 */

/** 新 tool 正式名（对标 Claude Code TodoWrite） */
export const TODO_WRITE_TOOL_NAME = "todo_write";

/** 所有被识别为 todo 相关的 tool 名字（包括旧版以兼容历史 session） */
export const TODO_TOOL_NAMES = Object.freeze(["todo", TODO_WRITE_TOOL_NAME]);
