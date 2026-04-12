/**
 * todo-constants.ts — 前端镜像
 *
 * 后端真实来源：project-hana/lib/tools/todo-constants.js
 * 这两个文件必须保持同步。任何改动都要改两处。
 */

/** 新 tool 正式名（对标 Claude Code TodoWrite） */
export const TODO_WRITE_TOOL_NAME = "todo_write" as const;

/** 所有被识别为 todo 相关的 tool 名字 */
export const TODO_TOOL_NAMES = ["todo", TODO_WRITE_TOOL_NAME] as const;

export type TodoToolName = typeof TODO_TOOL_NAMES[number];
