import { hanaFetch } from '../../api';
import type { McpConnectorInput, McpState } from './types';

export const EMPTY_MCP_STATE: McpState = {
  enabled: false,
  connectors: [],
  agentConfig: { connectors: {} },
};

async function jsonOrError<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function loadMcpState(agentId: string): Promise<McpState> {
  const res = await hanaFetch(`/api/plugins/mcp/state?agentId=${encodeURIComponent(agentId)}`);
  const data = await jsonOrError<McpState>(res);
  return {
    enabled: data.enabled === true,
    connectors: Array.isArray(data.connectors) ? data.connectors : (Array.isArray(data.servers) ? data.servers : []),
    servers: Array.isArray(data.servers) ? data.servers : undefined,
    agentConfig: data.agentConfig || { connectors: {} },
  };
}

export async function setMcpEnabled(enabled: boolean): Promise<void> {
  await hanaFetch('/api/plugins/mcp/enabled', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

export async function addMcpConnector(input: McpConnectorInput): Promise<void> {
  await hanaFetch('/api/plugins/mcp/connectors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function removeMcpConnector(connectorId: string): Promise<void> {
  await hanaFetch(`/api/plugins/mcp/connectors/${encodeURIComponent(connectorId)}`, {
    method: 'DELETE',
  });
}

export async function runMcpConnectorAction(
  connectorId: string,
  action: 'start' | 'stop' | 'refresh-tools',
): Promise<void> {
  await hanaFetch(`/api/plugins/mcp/connectors/${encodeURIComponent(connectorId)}/${action}`, {
    method: 'POST',
  });
}

export async function setAgentMcpConnector(
  agentId: string,
  connectorId: string,
  enabled: boolean,
): Promise<void> {
  await hanaFetch(`/api/plugins/mcp/agents/${encodeURIComponent(agentId)}/connectors/${encodeURIComponent(connectorId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

export async function setAgentMcpTool(
  agentId: string,
  connectorId: string,
  toolName: string,
  enabled: boolean,
): Promise<void> {
  await hanaFetch(`/api/plugins/mcp/agents/${encodeURIComponent(agentId)}/connectors/${encodeURIComponent(connectorId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tools: { [toolName]: enabled } }),
  });
}

export async function startMcpOAuth(connectorId: string): Promise<{ sessionId: string; url: string }> {
  const res = await hanaFetch(`/api/plugins/mcp/connectors/${encodeURIComponent(connectorId)}/oauth/start`, {
    method: 'POST',
  });
  return jsonOrError<{ sessionId: string; url: string }>(res);
}

export async function pollMcpOAuth(sessionId: string): Promise<{ status: string; error?: string }> {
  const res = await hanaFetch(`/api/plugins/mcp/oauth/poll/${encodeURIComponent(sessionId)}`);
  return jsonOrError<{ status: string; error?: string }>(res);
}

export async function logoutMcpOAuth(connectorId: string): Promise<void> {
  await hanaFetch(`/api/plugins/mcp/connectors/${encodeURIComponent(connectorId)}/oauth/logout`, {
    method: 'POST',
  });
}
