/**
 * Resolve target agent from request context.
 * Priority: query.agentId > params.agentId > engine.currentAgentId
 */

/** 读操作用：显式 ID 找不到时抛错；无 ID 时过渡期 fallback + warning */
export function resolveAgent(engine, c) {
  const explicit = c.req.query("agentId") || c.req.param("agentId");
  if (explicit) {
    const found = engine.getAgent(explicit);
    if (!found) throw new AgentNotFoundError(explicit);
    return found;
  }
  // 过渡期：保留 fallback + 打 warning
  console.warn("[resolve-agent] DEPRECATED: missing agentId, falling back to focus agent. Caller:", new Error().stack?.split("\n")[2]?.trim());
  return engine.getAgent(engine.currentAgentId) || engine.agent;
}

/** 写操作用：强制要求显式 agentId，不做 fallback */
export function resolveAgentStrict(engine, c) {
  const explicit = c.req.query("agentId") || c.req.param("agentId");
  if (!explicit) {
    throw new AgentNotFoundError("(missing agentId)");
  }
  const found = engine.getAgent(explicit);
  if (!found) throw new AgentNotFoundError(explicit);
  return found;
}

export class AgentNotFoundError extends Error {
  constructor(id) {
    super(`agent "${id}" not found`);
    this.name = "AgentNotFoundError";
    this.status = 404;
    this.agentId = id;
  }
}
