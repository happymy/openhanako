import React, { useState } from 'react';
import { t } from '../../helpers';
import styles from '../../Settings.module.css';
import type { McpAuthType, McpConnectorInput, McpTransport } from './types';

type FormMode = 'local' | 'remote';

interface ConnectorFormProps {
  disabled?: boolean;
  onAdd: (input: McpConnectorInput) => Promise<void>;
}

function parseArgs(value: string): string[] {
  return value.trim() ? value.trim().split(/\s+/) : [];
}

const INITIAL_FORM = {
  mode: 'remote' as FormMode,
  name: '',
  url: '',
  transport: 'remote' as McpTransport,
  command: '',
  args: '',
  cwd: '',
  authType: 'none' as McpAuthType,
  authorizationToken: '',
  oauthClientId: '',
  oauthClientSecret: '',
};

const fieldHalfClass = `${styles['settings-form-field']} ${styles['settings-form-field-half']}`;

export function ConnectorForm({ disabled, onAdd }: ConnectorFormProps) {
  const [form, setForm] = useState(INITIAL_FORM);

  const canSubmit = form.mode === 'local'
    ? form.command.trim().length > 0
    : form.url.trim().length > 0;

  const submit = async () => {
    const input: McpConnectorInput = form.mode === 'local'
      ? {
          name: form.name || form.command,
          transport: 'stdio',
          command: form.command,
          args: parseArgs(form.args),
          cwd: form.cwd,
        }
      : {
          name: form.name || form.url,
          transport: form.transport,
          url: form.url,
          authType: form.authType,
          authorizationToken: form.authType === 'bearer' ? form.authorizationToken : '',
          oauthClientId: form.authType === 'oauth' ? form.oauthClientId : '',
          oauthClientSecret: form.authType === 'oauth' ? form.oauthClientSecret : '',
        };
    await onAdd(input);
    setForm(INITIAL_FORM);
  };

  return (
    <div className={styles['pv-add-form']}>
      <div className={styles['settings-form-grid']}>
        <div className={fieldHalfClass}>
          <label className={styles['settings-form-label']}>{t('settings.mcp.connectorName')}</label>
          <input
            className={styles['settings-input']}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="GitHub"
          />
        </div>
        <div className={fieldHalfClass}>
          <label className={styles['settings-form-label']}>{t('settings.mcp.connectorMode')}</label>
          <select
            className={styles['settings-select']}
            value={form.mode}
            onChange={(e) => setForm({ ...form, mode: e.target.value as FormMode })}
          >
            <option value="remote">{t('settings.mcp.modeRemote')}</option>
            <option value="local">{t('settings.mcp.modeLocal')}</option>
          </select>
        </div>
      </div>

      {form.mode === 'remote' ? (
        <>
          <div className={styles['settings-form-grid']}>
            <div className={fieldHalfClass}>
              <label className={styles['settings-form-label']}>{t('settings.mcp.remoteUrl')}</label>
              <input
                className={styles['settings-input']}
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://mcp.example.com/mcp"
              />
            </div>
            <div className={fieldHalfClass}>
              <label className={styles['settings-form-label']}>{t('settings.mcp.transport')}</label>
              <select
                className={styles['settings-select']}
                value={form.transport}
                onChange={(e) => setForm({ ...form, transport: e.target.value as McpTransport })}
              >
                <option value="remote">{t('settings.mcp.transportAuto')}</option>
                <option value="streamable-http">{t('settings.mcp.transportStreamable')}</option>
                <option value="sse">{t('settings.mcp.transportSse')}</option>
              </select>
            </div>
          </div>
          <div className={styles['settings-form-grid']}>
            <div className={fieldHalfClass}>
              <label className={styles['settings-form-label']}>{t('settings.mcp.authType')}</label>
              <select
                className={styles['settings-select']}
                value={form.authType}
                onChange={(e) => setForm({ ...form, authType: e.target.value as McpAuthType })}
              >
                <option value="none">{t('settings.mcp.authNone')}</option>
                <option value="bearer">{t('settings.mcp.authBearer')}</option>
                <option value="oauth">{t('settings.mcp.authOAuth')}</option>
              </select>
            </div>
            {form.authType === 'bearer' && (
              <div className={fieldHalfClass}>
                <label className={styles['settings-form-label']}>{t('settings.mcp.authToken')}</label>
                <input
                  className={styles['settings-input']}
                  type="password"
                  value={form.authorizationToken}
                  onChange={(e) => setForm({ ...form, authorizationToken: e.target.value })}
                  placeholder="Bearer token"
                />
              </div>
            )}
          </div>
          {form.authType === 'oauth' && (
            <div className={styles['settings-form-grid']}>
              <div className={fieldHalfClass}>
                <label className={styles['settings-form-label']}>{t('settings.mcp.oauthClientId')}</label>
                <input
                  className={styles['settings-input']}
                  value={form.oauthClientId}
                  onChange={(e) => setForm({ ...form, oauthClientId: e.target.value })}
                  placeholder="client_id"
                />
              </div>
              <div className={fieldHalfClass}>
                <label className={styles['settings-form-label']}>{t('settings.mcp.oauthClientSecret')}</label>
                <input
                  className={styles['settings-input']}
                  type="password"
                  value={form.oauthClientSecret}
                  onChange={(e) => setForm({ ...form, oauthClientSecret: e.target.value })}
                  placeholder="client_secret"
                />
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={styles['settings-form-grid']}>
            <div className={fieldHalfClass}>
              <label className={styles['settings-form-label']}>{t('settings.mcp.command')}</label>
              <input
                className={styles['settings-input']}
                value={form.command}
                onChange={(e) => setForm({ ...form, command: e.target.value })}
                placeholder="npx"
              />
            </div>
            <div className={fieldHalfClass}>
              <label className={styles['settings-form-label']}>{t('settings.mcp.args')}</label>
              <input
                className={styles['settings-input']}
                value={form.args}
                onChange={(e) => setForm({ ...form, args: e.target.value })}
                placeholder="-y @modelcontextprotocol/server-github"
              />
            </div>
          </div>
          <div className={styles['settings-form-grid']}>
            <div className={fieldHalfClass}>
              <label className={styles['settings-form-label']}>{t('settings.mcp.cwd')}</label>
              <input
                className={styles['settings-input']}
                value={form.cwd}
                onChange={(e) => setForm({ ...form, cwd: e.target.value })}
                placeholder={t('settings.mcp.cwdPlaceholder')}
              />
            </div>
          </div>
        </>
      )}

      <div className={styles['pv-add-form-actions']}>
        <button
          className={`${styles['pv-add-form-btn']} ${styles['primary']}`}
          type="button"
          disabled={disabled || !canSubmit}
          onClick={submit}
        >
          {t('settings.mcp.addConnector')}
        </button>
      </div>
    </div>
  );
}
