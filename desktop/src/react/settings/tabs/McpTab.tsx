import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../store';
import { t } from '../helpers';
import { SettingsSection } from '../components/SettingsSection';
import { Toggle } from '../widgets/Toggle';
import { AgentConnectorControls } from './mcp/AgentConnectorControls';
import { ConnectorForm } from './mcp/ConnectorForm';
import { ConnectorList } from './mcp/ConnectorList';
import {
  EMPTY_MCP_STATE,
  addMcpConnector,
  loadMcpState,
  logoutMcpOAuth,
  pollMcpOAuth,
  removeMcpConnector,
  runMcpConnectorAction,
  setAgentMcpConnector,
  setAgentMcpTool,
  setMcpEnabled,
  startMcpOAuth,
} from './mcp/mcp-api';
import type { McpConnectorInput } from './mcp/types';
import styles from '../Settings.module.css';

const platform = window.platform;

export function McpTab() {
  const currentAgentId = useSettingsStore(s => s.currentAgentId);
  const showToast = useSettingsStore(s => s.showToast);
  const [viewAgentId, setViewAgentId] = useState<string | null>(currentAgentId);
  const viewAgentIdRef = useRef(viewAgentId);
  viewAgentIdRef.current = viewAgentId;

  const [state, setState] = useState(EMPTY_MCP_STATE);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!viewAgentId && currentAgentId) setViewAgentId(currentAgentId);
  }, [currentAgentId, viewAgentId]);

  const loadState = useCallback(async () => {
    const agentId = viewAgentIdRef.current;
    if (!agentId) return;
    try {
      const snapshotAgentId = agentId;
      const data = await loadMcpState(agentId);
      if (viewAgentIdRef.current !== snapshotAgentId) return;
      setState(data);
    } catch (err) {
      console.error('[mcp] load failed:', err);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState, viewAgentId]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    try {
      await action();
      await loadState();
      showToast(t('settings.autoSaved'), 'success');
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const toggleGlobal = (enabled: boolean) => run('global', () => setMcpEnabled(enabled));

  const addConnector = (input: McpConnectorInput) => run('add', () => addMcpConnector(input));

  const connectorAction = (connectorId: string, action: 'start' | 'stop' | 'refresh-tools') =>
    run(`${action}-${connectorId}`, () => runMcpConnectorAction(connectorId, action));

  const removeConnector = (connectorId: string) => {
    if (!confirm(t('settings.mcp.removeConfirm'))) return;
    run(`remove-${connectorId}`, () => removeMcpConnector(connectorId));
  };

  const setAgentConnector = (connectorId: string, enabled: boolean) => run(`agent-connector-${connectorId}`, async () => {
    const agentId = viewAgentIdRef.current;
    if (!agentId) throw new Error('agentId is required');
    await setAgentMcpConnector(agentId, connectorId, enabled);
  });

  const setAgentTool = (connectorId: string, toolName: string, enabled: boolean) => run(`tool-${connectorId}-${toolName}`, async () => {
    const agentId = viewAgentIdRef.current;
    if (!agentId) throw new Error('agentId is required');
    await setAgentMcpTool(agentId, connectorId, toolName, enabled);
  });

  const connectOAuth = (connectorId: string) => run(`oauth-${connectorId}`, async () => {
    const { sessionId, url } = await startMcpOAuth(connectorId);
    platform?.openExternal?.(url);
    await waitForOAuth(sessionId);
  });

  const disconnectOAuth = (connectorId: string) =>
    run(`oauth-logout-${connectorId}`, () => logoutMcpOAuth(connectorId));

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="mcp">
      <SettingsSection title={t('settings.mcp.masterTitle')}>
        <div className={styles['skills-list-item']}>
          <div className={styles['skills-list-info']}>
            <div className={styles['skills-list-name']}>{t('settings.mcp.masterName')}</div>
            <div className={styles['skills-list-desc']}>{t('settings.mcp.masterDesc')}</div>
          </div>
          <div className={styles['skills-list-actions']}>
            <Toggle
              on={state.enabled}
              onChange={toggleGlobal}
              disabled={busyKey === 'global'}
              label={state.enabled ? t('common.on') : t('common.off')}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.mcp.connectorsTitle')} variant="flush">
        <ConnectorForm disabled={busyKey === 'add'} onAdd={addConnector} />
        <ConnectorList
          connectors={state.connectors}
          globalEnabled={state.enabled}
          busyKey={busyKey}
          onAction={connectorAction}
          onRemove={removeConnector}
          onOAuthStart={connectOAuth}
          onOAuthLogout={disconnectOAuth}
        />
      </SettingsSection>

      <AgentConnectorControls
        connectors={state.connectors}
        globalEnabled={state.enabled}
        viewAgentId={viewAgentId}
        busyKey={busyKey}
        agentConfig={state.agentConfig}
        onAgentChange={setViewAgentId}
        onConnectorToggle={setAgentConnector}
        onToolToggle={setAgentTool}
      />
    </div>
  );
}

async function waitForOAuth(sessionId: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const status = await pollMcpOAuth(sessionId);
    if (status.status === 'done') return;
    if (status.status === 'error') throw new Error(status.error || 'OAuth failed');
  }
  throw new Error('OAuth login timed out');
}
