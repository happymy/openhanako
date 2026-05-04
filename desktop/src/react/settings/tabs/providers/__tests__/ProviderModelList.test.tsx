/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mocks = vi.hoisted(() => ({
  hanaFetch: vi.fn(),
}));

vi.mock('../../../api', () => ({
  hanaFetch: (...args: unknown[]) => mocks.hanaFetch(...args),
}));

vi.mock('../../../../hooks/use-config', () => ({
  invalidateConfigCache: vi.fn(),
}));

vi.mock('../../../helpers', () => ({
  t: (key: string) => key,
  formatContext: (n: number) => `${n}`,
  lookupModelMeta: vi.fn(() => null),
}));

import { ProviderModelList } from '../ProviderModelList';

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

function rect(init: Partial<DOMRect>): DOMRect {
  return {
    x: init.left ?? 0,
    y: init.top ?? 0,
    left: init.left ?? 0,
    top: init.top ?? 0,
    right: init.right ?? (init.left ?? 0) + (init.width ?? 0),
    bottom: init.bottom ?? (init.top ?? 0) + (init.height ?? 0),
    width: init.width ?? 0,
    height: init.height ?? 0,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('ProviderModelList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hanaFetch.mockResolvedValue(jsonResponse({ models: [{ id: 'kimi-for-coding' }] }));
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1200 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 900 });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('portals the add-model dropdown to body so fixed coordinates are viewport-relative', async () => {
    const onRefresh = vi.fn(async () => {});
    const { container } = render(
      <div data-testid="provider-host">
        <ProviderModelList
          providerId="kimi-coding"
          summary={{
            type: 'api-key',
            auth_type: 'api-key',
            display_name: 'Kimi Coding Plan',
            base_url: 'https://api.kimi.com/coding/',
            api: 'anthropic-messages',
            api_key: '',
            models: ['kimi-for-coding'],
            custom_models: [],
            has_credentials: false,
            supports_oauth: false,
            is_coding_plan: true,
            can_delete: false,
          }}
          onRefresh={onRefresh}
        />
      </div>,
    );

    const trigger = screen.getByRole('button', { name: 'settings.api.addModel' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rect({
      left: 120,
      top: 300,
      bottom: 332,
      width: 240,
      height: 32,
    }));

    fireEvent.click(trigger);

    const panel = await waitFor(() => {
      const found = document.body.querySelector('[data-provider-model-dropdown="true"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });

    expect(container).not.toContainElement(panel);
    expect(panel).toHaveStyle({
      position: 'fixed',
      left: '120px',
      top: '336px',
      width: '320px',
    });
  });
});
