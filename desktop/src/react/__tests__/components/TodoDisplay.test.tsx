// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodoDisplay } from '../../components/input/TodoDisplay';

describe('TodoDisplay', () => {
  beforeEach(() => {
    window.t = ((key: string) => {
      if (key === 'common.allDone') return '全部完成';
      if (key === 'common.completeAndDismiss') return '完成并收起';
      return key;
    }) as typeof window.t;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('calls onCompleteAll from the X control without toggling the todo list', () => {
    const onCompleteAll = vi.fn();
    render(
      <TodoDisplay
        todos={[{ content: '写测试', activeForm: '正在写测试', status: 'in_progress' }]}
        onCompleteAll={onCompleteAll}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '完成并收起' }));

    expect(onCompleteAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('写测试')).not.toBeInTheDocument();
  });
});
