/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockState extends Record<string, unknown> {
  pluginAllowFullAccess?: boolean;
  pluginUserDir?: string;
  set?: (patch: Record<string, unknown>) => void;
  showToast?: (message: string, type: 'success' | 'error') => void;
}

const mockState: MockState = {};
const mockHanaFetch = vi.fn();

vi.mock('../../settings/store', () => {
  const hook: any = (selector?: (s: MockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  hook.getState = () => mockState;
  hook.setState = (partial: Partial<MockState>) => Object.assign(mockState, partial);
  return { useSettingsStore: hook };
});

vi.mock('../../settings/api', () => ({
  hanaFetch: (...args: unknown[]) => mockHanaFetch(...args),
}));

vi.mock('../../utils/markdown', () => ({
  renderMarkdown: (source: string) => source,
}));

function resetState() {
  Object.keys(mockState).forEach(key => delete mockState[key]);
  Object.assign(mockState, {
    pluginAllowFullAccess: false,
    pluginUserDir: '/tmp/hana/plugins',
    set: vi.fn((patch: Record<string, unknown>) => Object.assign(mockState, patch)),
    showToast: vi.fn(),
  });
}

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

describe('PluginsTab', () => {
  beforeEach(() => {
    resetState();
    mockHanaFetch.mockReset();
    mockHanaFetch.mockResolvedValue(jsonResponse([]));
    window.platform = {
      selectPlugin: vi.fn(async () => null),
      getFilePath: vi.fn(),
    } as unknown as typeof window.platform;
    window.t = (key: string, params?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        'settings.plugins.openMarketplace': '打开插件市场',
        'settings.plugins.marketplaceTitle': '插件市场',
        'settings.plugins.marketplaceHint': '浏览可安装插件，查看 README、权限和贡献类型。',
        'settings.plugins.dropzone': '拖拽插件文件夹或点击选择',
        'settings.plugins.empty': '暂无插件',
        'settings.plugins.pluginsDir': `插件目录：${params?.path || ''}`,
        'settings.plugins.fullAccessToggle': '允许全权插件',
        'settings.plugins.fullAccessDesc': '允许插件访问完整能力。',
        'settings.plugins.reload': '重新加载插件',
        'settings.plugins.showDiagnostics': '查看插件诊断',
      };
      return messages[key] || key;
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens the marketplace in its own settings subpage', async () => {
    const { PluginsTab } = await import('../../settings/tabs/PluginsTab');
    render(<PluginsTab />);

    fireEvent.click(screen.getByRole('button', { name: '打开插件市场' }));

    expect(mockState.set).toHaveBeenCalledWith({ activeTab: 'plugin-marketplace' });
    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/plugins?source=community');
    });
  });
});
