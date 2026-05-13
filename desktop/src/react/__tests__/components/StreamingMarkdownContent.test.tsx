// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingMarkdownContent } from '../../components/chat/StreamingMarkdownContent';

let rafCallbacks: FrameRequestCallback[] = [];

function installRaf() {
  rafCallbacks = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
    rafCallbacks[id - 1] = () => {};
  });
}

function flushRaf(frameTime: number) {
  const callbacks = rafCallbacks;
  rafCallbacks = [];
  callbacks.forEach((cb) => cb(frameTime));
}

describe('StreamingMarkdownContent', () => {
  beforeEach(() => {
    installRaf();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders streaming prose progressively and marks only the visible tail for fade', () => {
    const { container, rerender } = render(
      <StreamingMarkdownContent source="旧正文" html="<p>旧正文</p>" active />,
    );

    rerender(
      <StreamingMarkdownContent source="旧正文新正文继续出现" html="<p>旧正文新正文继续出现</p>" active />,
    );

    act(() => {
      flushRaf(0);
    });

    const text = container.textContent || '';
    expect(text.length).toBeGreaterThan('旧正文'.length);
    expect(text.length).toBeLessThan('旧正文新正文继续出现'.length);
    expect(container.querySelectorAll('[data-stream-tail-char="true"]').length).toBeGreaterThan(0);
  });

  it('does not typewriter complex markdown blocks', () => {
    const source = '```ts\nconst x = 1;\n```';
    const html = '<pre><code>const x = 1;</code></pre>';

    const { container } = render(
      <StreamingMarkdownContent source={source} html={html} active />,
    );

    expect(container.textContent).toContain('const x = 1;');
    expect(container.querySelector('[data-stream-tail-char="true"]')).toBeNull();
  });
});
