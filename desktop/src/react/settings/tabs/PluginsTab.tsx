import React, { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../store';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import styles from '../Settings.module.css';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import { renderMarkdown } from '../../utils/markdown';

const platform = window.platform;

interface PluginInfo {
  id: string;
  name: string;
  version?: string;
  description?: string;
  status: 'loaded' | 'failed' | 'disabled' | 'restricted';
  activationState?: string | null;
  activationEvents?: string[];
  activationError?: string | null;
  source: 'builtin' | 'community';
  trust: 'restricted' | 'full-access';
  contributions?: string[];
  error?: string | null;
}

interface PluginConfigProperty {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  sensitive?: boolean;
  scope?: 'global' | 'per-agent' | 'per-session';
  ui?: { control?: string };
}

interface PluginConfigResponse {
  pluginId: string;
  schema: {
    properties?: Record<string, PluginConfigProperty>;
  };
  values: Record<string, unknown>;
}

interface PluginDiagnostics {
  id: string;
  name?: string;
  status?: string;
  error?: string | null;
  activationState?: string | null;
  activationEvents?: string[];
  activationError?: string | null;
  source?: string;
  trust?: string;
  contributions?: string[];
  routes?: {
    hasRouteApp?: boolean;
    pages?: unknown[];
    widgets?: unknown[];
    settingsTabs?: unknown[];
  };
  tools?: { name: string; dynamic?: boolean }[];
  commands?: { name: string }[];
  providers?: { id: string; name?: string }[];
  config?: { hasSchema?: boolean; keys?: string[] };
}

interface PluginDiagnosticsResponse {
  plugins: PluginDiagnostics[];
  eventBus: { type: string; available?: boolean }[];
  tasks: { taskId: string; type: string; status?: string }[];
  schedules: { scheduleId: string; type: string; enabled?: boolean }[];
}

interface MarketplacePlugin {
  id: string;
  name: string;
  publisher?: string;
  version?: string;
  description?: string;
  trust?: 'restricted' | 'full-access';
  permissions?: string[];
  contributions?: string[];
  repository?: string | null;
  compatibility?: { minAppVersion?: string; hanaApi?: string };
  distribution?: { kind?: 'source' | 'release'; path?: string; packageUrl?: string; sha256?: string } | null;
  installed?: boolean;
  installedVersion?: string | null;
  canInstall?: boolean;
}

interface MarketplaceResponse {
  source?: { kind?: string; configured?: boolean; path?: string; url?: string };
  plugins: MarketplacePlugin[];
  warnings?: string[];
}

/* ── Status badge ── */

function StatusBadge({ status }: { status: PluginInfo['status'] }) {
  const labelKey =
    status === 'loaded' ? 'settings.plugins.statusLoaded' :
    status === 'failed' ? 'settings.plugins.statusFailed' :
    status === 'restricted' ? 'settings.plugins.statusRestricted' :
    'settings.plugins.statusDisabled';

  const style: React.CSSProperties =
    status === 'loaded'
      ? { color: 'var(--success, #5a9)', background: 'rgba(90,170,153,0.1)' }
      : status === 'failed'
      ? { color: 'var(--danger, #b56b66)', background: 'rgba(var(--danger-rgb, 181, 107, 102), 0.1)' }
      : status === 'restricted'
      ? { color: 'var(--danger, #b56b66)', background: 'rgba(var(--danger-rgb, 181, 107, 102), 0.1)' }
      : { color: 'var(--text-muted)', background: 'var(--overlay-light, rgba(0,0,0,0.06))' };

  return (
    <span className={styles['oauth-status-badge']} style={style}>
      {t(labelKey)}
    </span>
  );
}

/* ── Contribution badges ── */

function ContributionBadges({ contributions }: { contributions?: string[] }) {
  if (!contributions || contributions.length === 0) return null;
  return (
    <span style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
      {contributions.map(c => (
        <span
          key={c}
          className={styles['skills-source-badge']}
          style={{
            marginRight: 0, opacity: 1,
            background: 'var(--overlay-light, rgba(0,0,0,0.05))',
            padding: '1px 6px', borderRadius: 'var(--radius-sm)',
          }}
        >
          {c}
        </span>
      ))}
    </span>
  );
}

function formatConfigValue(property: PluginConfigProperty, value: unknown): string {
  if (property.type === 'object' || property.type === 'array') {
    return value === undefined ? '' : JSON.stringify(value, null, 2);
  }
  return value === undefined || value === null ? '' : String(value);
}

function parseConfigValue(property: PluginConfigProperty, value: string): unknown {
  if (property.type === 'number') return Number(value);
  if (property.type === 'integer') return Number.parseInt(value, 10);
  if (property.type === 'object' || property.type === 'array') return value.trim() ? JSON.parse(value) : property.type === 'array' ? [] : {};
  return value;
}

function count(value: unknown[] | undefined): number {
  return Array.isArray(value) ? value.length : 0;
}

/* ── Main tab ── */

export function PluginsTab() {
  const { showToast, pluginAllowFullAccess, pluginUserDir, set } = useSettingsStore();

  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [configPlugin, setConfigPlugin] = useState<PluginInfo | null>(null);
  const [pluginConfig, setPluginConfig] = useState<PluginConfigResponse | null>(null);
  const [configDraft, setConfigDraft] = useState<Record<string, unknown>>({});
  const [dirtyConfigKeys, setDirtyConfigKeys] = useState<Set<string>>(new Set());
  const [configSaving, setConfigSaving] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PluginDiagnosticsResponse | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [marketplace, setMarketplace] = useState<MarketplaceResponse | null>(null);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [selectedMarketPlugin, setSelectedMarketPlugin] = useState<MarketplacePlugin | null>(null);
  const [marketReadme, setMarketReadme] = useState('');
  const [marketReadmeLoading, setMarketReadmeLoading] = useState(false);
  const [marketInstallId, setMarketInstallId] = useState<string | null>(null);

  /* ── data fetchers ── */

  const loadPlugins = useCallback(async () => {
    try {
      const res = await hanaFetch('/api/plugins?source=community');
      const data = await res.json();
      setPlugins(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[plugins] load failed:', err);
      setPlugins([]);
    }
  }, []);

  const loadPluginConfig = useCallback(async (plugin: PluginInfo) => {
    try {
      const res = await hanaFetch(`/api/plugins/${encodeURIComponent(plugin.id)}/config`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setConfigPlugin(plugin);
      setPluginConfig(data);
      setConfigDraft(data.values || {});
      setDirtyConfigKeys(new Set());
    } catch (err: unknown) {
      showToast(t('settings.plugins.configLoadError') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  }, [showToast]);

  const loadDiagnostics = useCallback(async () => {
    setDiagnosticsLoading(true);
    try {
      const res = await hanaFetch('/api/plugins/diagnostics');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDiagnostics({
        plugins: Array.isArray(data.plugins) ? data.plugins : [],
        eventBus: Array.isArray(data.eventBus) ? data.eventBus : [],
        tasks: Array.isArray(data.tasks) ? data.tasks : [],
        schedules: Array.isArray(data.schedules) ? data.schedules : [],
      });
    } catch (err: unknown) {
      showToast(t('settings.plugins.diagnosticsLoadError') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [showToast]);

  const loadMarketReadme = useCallback(async (plugin: MarketplacePlugin) => {
    setSelectedMarketPlugin(plugin);
    setMarketReadme('');
    setMarketReadmeLoading(true);
    try {
      const res = await hanaFetch(`/api/plugins/marketplace/${encodeURIComponent(plugin.id)}/readme`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMarketReadme(data.markdown || '');
    } catch (err: unknown) {
      showToast(t('settings.plugins.marketReadmeLoadError') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setMarketReadmeLoading(false);
    }
  }, [showToast]);

  const loadMarketplace = useCallback(async () => {
    setMarketplaceLoading(true);
    try {
      const res = await hanaFetch('/api/plugins/marketplace');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const plugins = Array.isArray(data.plugins) ? data.plugins : [];
      const next = {
        source: data.source || {},
        plugins,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
      };
      setMarketplace(next);
      if (plugins.length > 0) {
        await loadMarketReadme(plugins[0]);
      } else {
        setSelectedMarketPlugin(null);
        setMarketReadme('');
      }
    } catch (err: unknown) {
      showToast(t('settings.plugins.marketLoadError') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setMarketplaceLoading(false);
    }
  }, [loadMarketReadme, showToast]);

  const installMarketplacePlugin = async (plugin: MarketplacePlugin) => {
    setMarketInstallId(plugin.id);
    try {
      const res = await hanaFetch(`/api/plugins/marketplace/${encodeURIComponent(plugin.id)}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast(t('settings.plugins.installSuccess', { name: data.name || plugin.name }), 'success');
      await loadPlugins();
      await loadMarketplace();
    } catch (err: unknown) {
      showToast(t('settings.plugins.installError') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setMarketInstallId(null);
    }
  };

  const reload = useCallback(async () => {
    setLoading(true);
    await loadPlugins();
    setLoading(false);
  }, [loadPlugins]);

  useEffect(() => { reload(); }, [reload]);

  /* ── full-access toggle ── */

  const toggleFullAccess = async () => {
    const next = !pluginAllowFullAccess;
    set({ pluginAllowFullAccess: next });
    try {
      const res = await hanaFetch('/api/plugins/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow_full_access: next }),
      });
      const data = await res.json();
      if (Array.isArray(data)) setPlugins(data);
      showToast(t('settings.autoSaved'), 'success');
    } catch (err: unknown) {
      set({ pluginAllowFullAccess: !next });
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  /* ── install ── */

  const installFromPath = async (filePath: string) => {
    try {
      const res = await hanaFetch('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast(t('settings.plugins.installSuccess', { name: data.name || '' }), 'success');
      await loadPlugins();
    } catch (err: unknown) {
      showToast(
        t('settings.plugins.installError') + ': ' + (err instanceof Error ? err.message : String(err)),
        'error',
      );
    }
  };

  const installByPicker = async () => {
    const selectedPath = await platform?.selectPlugin?.();
    if (!selectedPath) return;
    await installFromPath(selectedPath);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const filePath = platform?.getFilePath?.(file) || (file as File & { path?: string })?.path;
    if (filePath) await installFromPath(filePath);
  };

  /* ── enable / disable ── */

  const togglePlugin = async (id: string, enable: boolean) => {
    // Optimistic update
    setPlugins(prev => prev.map(p => p.id === id ? { ...p, status: enable ? 'loaded' : 'disabled' } as PluginInfo : p));
    try {
      const res = await hanaFetch(`/api/plugins/${encodeURIComponent(id)}/enabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enable }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast(t('settings.autoSaved'), 'success');
      await loadPlugins();
    } catch (err: unknown) {
      // Revert
      setPlugins(prev => prev.map(p => p.id === id ? { ...p, status: enable ? 'disabled' : 'loaded' } as PluginInfo : p));
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  /* ── delete ── */

  const deletePlugin = async (plugin: PluginInfo) => {
    const msg = t('settings.plugins.deleteConfirm', { name: plugin.name });
    if (!confirm(msg)) return;
    try {
      const res = await hanaFetch(`/api/plugins/${encodeURIComponent(plugin.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast(t('settings.autoSaved'), 'success');
      await loadPlugins();
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  const updateConfigDraft = (key: string, value: unknown) => {
    setConfigDraft(prev => ({ ...prev, [key]: value }));
    setDirtyConfigKeys(prev => new Set(prev).add(key));
  };

  const savePluginConfig = async () => {
    if (!configPlugin || !pluginConfig) return;
    const values: Record<string, unknown> = {};
    for (const key of dirtyConfigKeys) {
      const property = pluginConfig.schema.properties?.[key] || {};
      const value = configDraft[key];
      if (property.sensitive && value === '********') continue;
      values[key] = value;
    }
    setConfigSaving(true);
    try {
      const res = await hanaFetch(`/api/plugins/${encodeURIComponent(configPlugin.id)}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.fields?.[0]?.message || data.error);
      setPluginConfig(data);
      setConfigDraft(data.values || {});
      setDirtyConfigKeys(new Set());
      showToast(t('settings.autoSaved'), 'success');
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setConfigSaving(false);
    }
  };

  /* ── render ── */

  const isEnabled = (p: PluginInfo) => p.status === 'loaded' || p.status === 'failed';
  const isDimmed = (p: PluginInfo) => p.status === 'disabled' || p.status === 'restricted';

  const reloadButton = (
    <button
      className={styles['settings-icon-btn']}
      title={t('settings.plugins.reload')}
      onClick={reload}
      disabled={loading}
    >
      <svg
        width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        className={loading ? styles['spin'] : ''}
      >
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
    </button>
  );

  const diagnosticsButton = (
    <button
      className={styles['settings-icon-btn']}
      title={t('settings.plugins.showDiagnostics')}
      onClick={loadDiagnostics}
      disabled={diagnosticsLoading}
    >
      <svg
        width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        className={diagnosticsLoading ? styles['spin'] : ''}
      >
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    </button>
  );

  const marketplaceButton = (
    <button
      className={marketplace ? styles['settings-icon-btn'] : styles['settings-save-btn-sm']}
      title={t('settings.plugins.openMarketplace')}
      onClick={loadMarketplace}
      disabled={marketplaceLoading}
    >
      {marketplace ? (
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className={marketplaceLoading ? styles['spin'] : ''}
        >
          <path d="M4 7h16" />
          <path d="M6 7l1 13h10l1-13" />
          <path d="M9 7a3 3 0 0 1 6 0" />
        </svg>
      ) : t('settings.plugins.openMarketplace')}
    </button>
  );

  const marketplaceBody = marketplace ? (
    <>
      {marketplace.warnings && marketplace.warnings.length > 0 && (
        <p className={`${styles['settings-muted-note']} ${styles['skills-empty']}`} style={{ color: 'var(--danger, #c55)' }}>
          {marketplace.warnings[0]}
        </p>
      )}
      {marketplace.plugins.length === 0 ? (
        <p className={`${styles['settings-muted-note']} ${styles['skills-empty']}`}>
          {t('settings.plugins.marketplaceEmpty')}
        </p>
      ) : (
        <div className={styles['plugin-marketplace-grid']}>
          <div className={styles['skills-list-block']}>
            {marketplace.plugins.map(plugin => (
              <div
                key={plugin.id}
                className={styles['skills-list-item']}
                onClick={() => loadMarketReadme(plugin)}
                style={selectedMarketPlugin?.id === plugin.id ? { background: 'var(--bg-hover)' } : undefined}
              >
                <div className={styles['skills-list-info']}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span className={styles['skills-list-name']}>{plugin.name}</span>
                    {plugin.version && <span className={styles['skills-list-name-hint']}>v{plugin.version}</span>}
                    {plugin.installed && (
                      <span className={styles['skills-source-badge']} style={{ marginRight: 0 }}>
                        {t('settings.plugins.marketInstalled')}
                      </span>
                    )}
                  </div>
                  {plugin.description && <span className={styles['skills-list-desc']}>{plugin.description}</span>}
                  <span className={styles['skills-list-desc']}>
                    {(plugin.publisher || 'unknown') + ' · ' + (plugin.trust || 'restricted')}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className={styles['skills-list-block']}>
            <div className={styles['skills-list-item']} style={{ alignItems: 'flex-start', cursor: 'default' }}>
              <div className={styles['skills-list-info']} style={{ gap: 'var(--space-sm)', width: '100%' }}>
                {selectedMarketPlugin ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-md)', alignItems: 'center' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className={styles['skills-list-name']}>{selectedMarketPlugin.name}</div>
                        <div className={styles['skills-list-desc']}>
                          {(selectedMarketPlugin.publisher || 'unknown') + ' · v' + (selectedMarketPlugin.version || '0.0.0')}
                        </div>
                      </div>
                      <button
                        className={styles['settings-save-btn-sm']}
                        disabled={!selectedMarketPlugin.canInstall || marketInstallId === selectedMarketPlugin.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          installMarketplacePlugin(selectedMarketPlugin);
                        }}
                      >
                        {selectedMarketPlugin.installed
                          ? t('settings.plugins.marketUpdate')
                          : t('settings.plugins.marketInstall')}
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(selectedMarketPlugin.contributions || []).map(item => (
                        <span key={item} className={styles['skills-source-badge']} style={{ marginRight: 0 }}>
                          {item}
                        </span>
                      ))}
                    </div>
                    <div
                      className="preview-markdown"
                      style={{ fontSize: '0.78rem', lineHeight: 1.65, color: 'var(--text)', maxHeight: 360, overflow: 'auto' }}
                      dangerouslySetInnerHTML={{
                        __html: marketReadmeLoading
                          ? `<p>${t('settings.plugins.marketReadmeLoading')}</p>`
                          : renderMarkdown(marketReadme || selectedMarketPlugin.description || ''),
                      }}
                    />
                  </>
                ) : (
                  <span className={styles['skills-list-desc']}>{t('settings.plugins.marketSelectPlugin')}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  ) : (
    <div className={styles['skills-list-block']}>
      <div className={styles['skills-list-item']} style={{ cursor: 'default' }}>
        <div className={styles['skills-list-info']}>
          <span className={styles['skills-list-name']}>{t('settings.plugins.marketplaceTitle')}</span>
          <span className={styles['skills-list-desc']}>{t('settings.plugins.marketplaceHint')}</span>
        </div>
        <div className={styles['skills-list-actions']}>{marketplaceButton}</div>
      </div>
    </div>
  );

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="plugins">
      <SettingsSection
        title={t('settings.plugins.marketplaceTitle')}
        variant="flush"
        context={marketplace ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className={styles['skills-source-badge']} style={{ marginRight: 0 }}>
              {marketplace.source?.configured
                ? t('settings.plugins.marketplaceCount', { count: String(marketplace.plugins.length) })
                : t('settings.plugins.marketplaceNoSource')}
            </span>
            {marketplaceButton}
          </div>
        ) : undefined}
      >
        {marketplaceBody}
      </SettingsSection>

      {/* 管理插件：dropzone + 列表 + 路径提示，同一 flush section；reload 按钮放 context */}
      <SettingsSection
        title="管理插件"
        variant="flush"
        context={<div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{diagnosticsButton}{reloadButton}</div>}
      >
        {/* 安装区：dropzone 自带虚线边框卡 */}
        <div
          className={`${styles['skills-dropzone']}${dragOver ? ' ' + styles['drag-over'] : ''}`}
          onClick={installByPicker}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>{t('settings.plugins.dropzone')}</span>
        </div>

        {/* 已安装列表 */}
        {!loading && plugins.length === 0 ? (
          <p className={`${styles['settings-muted-note']} ${styles['skills-empty']}`}>
            {t('settings.plugins.empty')}
          </p>
        ) : (
          <div className={styles['skills-list-block']}>
            {plugins.map(plugin => {
              const dimmed = isDimmed(plugin);
              const restricted = plugin.status === 'restricted';
              const enabled = isEnabled(plugin);
              const configurable = plugin.contributions?.includes('configuration');

              return (
                <div
                  key={plugin.id}
                  className={styles['skills-list-item']}
                  style={dimmed ? { opacity: 0.55 } : undefined}
                >
                  <div className={styles['skills-list-info']}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span className={styles['skills-list-name']}>{plugin.name}</span>
                      {plugin.version && (
                        <span className={styles['skills-list-name-hint']}>v{plugin.version}</span>
                      )}
                      <StatusBadge status={plugin.status} />
                      <ContributionBadges contributions={plugin.contributions} />
                    </div>
                    {plugin.description && (
                      <span className={styles['skills-list-desc']}>{plugin.description}</span>
                    )}
                    {plugin.status === 'failed' && plugin.error && (
                      <span className={styles['skills-list-desc']} style={{ color: 'var(--danger, #c55)' }}>
                        {plugin.error}
                      </span>
                    )}
                    {restricted && (
                      <span className={styles['skills-list-desc']} style={{ color: 'var(--danger, #b56b66)' }}>
                        {t('settings.plugins.needsFullAccess')}
                      </span>
                    )}
                  </div>

                  <div className={styles['skills-list-actions']}>
                    {configurable && (
                      <button
                        className={styles['skill-card-delete']}
                        title={t('settings.plugins.configure', { name: plugin.name })}
                        onClick={() => loadPluginConfig(plugin)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                        </svg>
                      </button>
                    )}
                    {/* Delete */}
                    <button
                      className={styles['skill-card-delete']}
                      title={t('settings.plugins.deleteConfirm', { name: plugin.name })}
                      onClick={() => deletePlugin(plugin)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>

                    {/* Enable/disable toggle */}
                    <button
                      className={`hana-toggle${enabled ? ' on' : ''}`}
                      disabled={restricted}
                      onClick={() => togglePlugin(plugin.id, !enabled)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 插件目录路径提示 */}
        {pluginUserDir && (
          <p style={{
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            marginTop: 'var(--space-sm)',
          }}>
            {t('settings.plugins.pluginsDir', { path: pluginUserDir })}
          </p>
        )}
      </SettingsSection>

      {diagnostics && (
        <SettingsSection
          title={t('settings.plugins.diagnosticsTitle')}
          variant="flush"
          context={
            <span className={styles['skills-source-badge']} style={{ marginRight: 0 }}>
              {t('settings.plugins.diagnosticsSummary', {
                capabilities: String(diagnostics.eventBus.filter(item => item.available).length),
                total: String(diagnostics.eventBus.length),
                tasks: String(diagnostics.tasks.length),
                schedules: String(diagnostics.schedules.length),
              })}
            </span>
          }
        >
          {diagnostics.plugins.length === 0 ? (
            <p className={`${styles['settings-muted-note']} ${styles['skills-empty']}`}>
              {t('settings.plugins.noDiagnostics')}
            </p>
          ) : (
            <div className={styles['skills-list-block']}>
              {diagnostics.plugins.map(plugin => {
                const routeText = t('settings.plugins.diagnosticRoutes', {
                  pages: String(count(plugin.routes?.pages)),
                  widgets: String(count(plugin.routes?.widgets)),
                  settingsTabs: String(count(plugin.routes?.settingsTabs)),
                });
                const capabilityText = [
                  t('settings.plugins.diagnosticTools', { count: String(count(plugin.tools)) }),
                  t('settings.plugins.diagnosticCommands', { count: String(count(plugin.commands)) }),
                  t('settings.plugins.diagnosticConfig', { count: String(count(plugin.config?.keys)) }),
                ].join(' · ');
                const activationText = plugin.activationState
                  ? t('settings.plugins.diagnosticActivation', { state: plugin.activationState })
                  : t('settings.plugins.diagnosticActivation', { state: '-' });
                return (
                  <div key={plugin.id} className={styles['skills-list-item']}>
                    <div className={styles['skills-list-info']}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span className={styles['skills-list-name']}>{plugin.name || plugin.id}</span>
                        <span className={styles['skills-list-name-hint']}>{plugin.id}</span>
                        {plugin.status && (
                          <span className={styles['skills-source-badge']} style={{ marginRight: 0 }}>
                            {plugin.status}
                          </span>
                        )}
                        {plugin.activationState && (
                          <span className={styles['skills-source-badge']} style={{ marginRight: 0 }}>
                            {plugin.activationState}
                          </span>
                        )}
                      </div>
                      <span className={styles['skills-list-desc']}>{activationText} · {routeText}</span>
                      <span className={styles['skills-list-desc']}>{capabilityText}</span>
                      {(plugin.error || plugin.activationError) && (
                        <span className={styles['skills-list-desc']} style={{ color: 'var(--danger, #c55)' }}>
                          {plugin.error || plugin.activationError}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SettingsSection>
      )}

      {configPlugin && pluginConfig && (
        <SettingsSection
          title={t('settings.plugins.configTitle', { name: configPlugin.name })}
          context={
            <button
              className={styles['settings-save-btn-sm']}
              disabled={configSaving || dirtyConfigKeys.size === 0}
              onClick={savePluginConfig}
            >
              {t('settings.api.save')}
            </button>
          }
        >
          {Object.entries(pluginConfig.schema.properties || {}).filter(([, property]) => (property.scope || 'global') === 'global').map(([key, property]) => {
            const label = property.title || key;
            const hint = property.description || (property.sensitive ? t('settings.plugins.sensitiveHint') : undefined);
            const value = configDraft[key];
            const control = property.type === 'boolean' ? (
              <button
                className={`hana-toggle${value === true ? ' on' : ''}`}
                onClick={() => updateConfigDraft(key, value !== true)}
              />
            ) : property.enum ? (
              <select
                className={styles['settings-input']}
                value={formatConfigValue(property, value)}
                onChange={(e) => updateConfigDraft(key, parseConfigValue(property, e.target.value))}
              >
                {property.enum.map((item) => (
                  <option key={String(item)} value={String(item)}>{String(item)}</option>
                ))}
              </select>
            ) : property.type === 'object' || property.type === 'array' ? (
              <textarea
                className={styles['settings-input']}
                rows={4}
                value={formatConfigValue(property, value)}
                onChange={(e) => updateConfigDraft(key, e.target.value)}
                onBlur={(e) => {
                  try { updateConfigDraft(key, parseConfigValue(property, e.target.value)); }
                  catch { showToast(t('settings.plugins.invalidJson'), 'error'); }
                }}
              />
            ) : (
              <input
                className={styles['settings-input']}
                type={property.sensitive ? 'password' : property.type === 'number' || property.type === 'integer' ? 'number' : 'text'}
                value={formatConfigValue(property, value)}
                onChange={(e) => updateConfigDraft(key, parseConfigValue(property, e.target.value))}
              />
            );
            return (
              <SettingsRow
                key={key}
                label={label}
                hint={hint}
                control={control}
                layout={property.type === 'object' || property.type === 'array' ? 'stacked' : 'inline'}
              />
            );
          })}
        </SettingsSection>
      )}

      {/* 权限：标准白卡片 row */}
      <SettingsSection title="权限">
        <SettingsRow
          label={t('settings.plugins.fullAccessToggle')}
          hint={t('settings.plugins.fullAccessDesc')}
          control={
            <button
              className={`hana-toggle${pluginAllowFullAccess ? ' on' : ''}`}
              onClick={toggleFullAccess}
            />
          }
        />
      </SettingsSection>
    </div>
  );
}
