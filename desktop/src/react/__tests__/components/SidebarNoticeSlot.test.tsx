/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformApi, TrainUpdateStatus } from '../../types';

// The regression test below asserts the sidebar card ignores the shell
// auto-updater entirely: a downloaded shell update alone must not trigger the card. Stubbing
// the shell hook to report 'downloaded' makes that assertion meaningful
// regardless of whether SidebarNoticeSlot happens to import the hook at
// all — if a future change re-wires it in, this is what would catch it.
vi.mock('../../hooks/use-auto-update-state', () => ({
  useAutoUpdateState: () => ({
    status: 'downloaded',
    version: '2.0.0',
    releaseNotes: null,
    releaseUrl: null,
    downloadUrl: null,
    progress: null,
    error: null,
  }),
}));

import { SidebarNoticeSlot, SidebarUpdateNoticeCard } from '../../components/notices/SidebarNoticeSlot';

const labels: Record<string, string> = {
  'settings.about.trainStickerTitle': '有新版本可用',
  'settings.about.trainStickerDownloading': '下载中 {percent}%',
  'settings.about.trainStickerApplying': '正在应用更新…',
  'settings.about.shellStickerTitleBlocking': '完成此更新后才能继续接收新版本',
  'window.close': '关闭',
};

function translate(key: string, vars?: Record<string, string | number>): string {
  let value = labels[key] ?? key;
  for (const [name, replacement] of Object.entries(vars ?? {})) {
    value = value.replace(`{${name}}`, String(replacement));
  }
  return value;
}

describe('SidebarUpdateNoticeCard', () => {
  beforeEach(() => {
    window.t = translate as typeof window.t;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('stays silent when nothing is available and the shell is not blocked', () => {
    const { container, rerender } = render(
      <SidebarUpdateNoticeCard available={null} minShellBlocked={false} phase="idle" progress={null} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<SidebarUpdateNoticeCard available={null} minShellBlocked={false} phase="checking" progress={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the default train form when a train is available, with the content version as subtitle', () => {
    const onApplyTrain = vi.fn();
    render(
      <SidebarUpdateNoticeCard
        available={{ version: '0.400.0' }}
        minShellBlocked={false}
        phase="idle"
        progress={null}
        onApplyTrain={onApplyTrain}
      />,
    );

    expect(screen.getByText('有新版本可用')).toBeInTheDocument();
    expect(screen.getByText('v0.400.0')).toBeInTheDocument();

    fireEvent.click(screen.getByText('有新版本可用'));
    expect(onApplyTrain).toHaveBeenCalledTimes(1);
  });

  it('renders download progress and applying phase text on the card while an apply is in flight', () => {
    const { rerender } = render(
      <SidebarUpdateNoticeCard
        available={{ version: '0.400.0' }}
        minShellBlocked={false}
        phase="downloading"
        progress={{ receivedBytes: 50, totalBytes: 200 }}
      />,
    );
    expect(screen.getByText('下载中 25%')).toBeInTheDocument();
    expect(screen.getByText('v0.400.0')).toBeInTheDocument();

    rerender(
      <SidebarUpdateNoticeCard
        available={{ version: '0.400.0' }}
        minShellBlocked={false}
        phase="applying"
        progress={{ receivedBytes: 200, totalBytes: 200 }}
      />,
    );
    expect(screen.getByText('正在应用更新…')).toBeInTheDocument();
  });

  it('switches to the blocked (shell-required) form when minShellBlocked is true, even if a train is also available', () => {
    const onInstallShell = vi.fn();
    const onApplyTrain = vi.fn();
    render(
      <SidebarUpdateNoticeCard
        available={{ version: '0.400.0' }}
        minShellBlocked
        phase="idle"
        progress={null}
        onInstallShell={onInstallShell}
        onApplyTrain={onApplyTrain}
      />,
    );

    expect(screen.getByText('完成此更新后才能继续接收新版本')).toBeInTheDocument();
    expect(screen.queryByText('有新版本可用')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('完成此更新后才能继续接收新版本'));
    expect(onInstallShell).toHaveBeenCalledTimes(1);
    expect(onApplyTrain).not.toHaveBeenCalled();
  });

  it('dismissing the train sticker hides it for that version only; a newer available version reappears', () => {
    const { container, rerender } = render(
      <SidebarUpdateNoticeCard available={{ version: '0.400.0' }} minShellBlocked={false} phase="idle" progress={null} />,
    );
    expect(screen.getByText('有新版本可用')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(container).toBeEmptyDOMElement();

    // Re-rendering with the SAME available version stays dismissed (persisted via storage).
    rerender(<SidebarUpdateNoticeCard available={{ version: '0.400.0' }} minShellBlocked={false} phase="idle" progress={null} />);
    expect(container).toBeEmptyDOMElement();

    // A newer available version reappears.
    rerender(<SidebarUpdateNoticeCard available={{ version: '0.401.0' }} minShellBlocked={false} phase="idle" progress={null} />);
    expect(screen.getByText('有新版本可用')).toBeInTheDocument();
  });

  it('dismissing the blocked sticker hides it for this mount only, without touching localStorage (session-only)', () => {
    const { container } = render(
      <SidebarUpdateNoticeCard available={null} minShellBlocked phase="idle" progress={null} />,
    );
    expect(screen.getByText('完成此更新后才能继续接收新版本')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(container).toBeEmptyDOMElement();
    expect(window.localStorage.length).toBe(0);
  });

  it('a fresh mount after a blocked dismissal (simulating next launch) shows the sticker again', () => {
    const first = render(<SidebarUpdateNoticeCard available={null} minShellBlocked phase="idle" progress={null} />);
    fireEvent.click(first.getByRole('button', { name: '关闭' }));
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();

    render(<SidebarUpdateNoticeCard available={null} minShellBlocked phase="idle" progress={null} />);
    expect(screen.getByText('完成此更新后才能继续接收新版本')).toBeInTheDocument();
  });
});

describe('SidebarNoticeSlot (wired to the real hook)', () => {
  beforeEach(() => {
    window.t = translate as typeof window.t;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function installHana(status: Partial<TrainUpdateStatus>) {
    window.hana = {
      trainUpdateStatus: vi.fn().mockResolvedValue({
        staged: false,
        train: null,
        version: null,
        minShellBlocked: false,
        available: null,
        lastError: null,
        lastCheckedAt: null,
        currentVersion: '0.388.0',
        ...status,
      }),
      trainUpdateCheck: vi.fn(),
      trainUpdateApply: vi.fn().mockResolvedValue({ ok: true }),
      onTrainUpdateAvailable: vi.fn(() => () => {}),
      onTrainUpdateProgress: vi.fn(() => () => {}),
      autoUpdateInstall: vi.fn(),
    } as unknown as PlatformApi;
  }

  it('regression: a shell auto-updater "downloaded" state alone must never surface the card — only `available`/`minShellBlocked` from the train status can', async () => {
    // The module-level mock above makes useAutoUpdateState() report
    // 'downloaded' for every test in this describe block — the old bug was
    // exactly "shell downloaded -> card shows". The train status here
    // deliberately supplies nothing shell-flavored (no available, not
    // blocked), so if the card is still driven by shell state in any form,
    // this is where it would show up.
    installHana({});

    const { container } = render(<SidebarNoticeSlot />);
    await waitFor(() => expect(window.hana?.trainUpdateStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the train card once the real hook resolves an available update', async () => {
    installHana({ available: { train: 9, version: '0.400.0', serverSha256: 'a'.repeat(64), rendererSha256: 'b'.repeat(64), sizes: { server: 1, renderer: 1 }, recordedAt: '2026-07-11T00:00:00.000Z' } });

    render(<SidebarNoticeSlot />);

    expect(await screen.findByText('有新版本可用')).toBeInTheDocument();
    expect(screen.getByText('v0.400.0')).toBeInTheDocument();
  });

  it('applying the update calls trainUpdateApply via the hook', async () => {
    const trainUpdateApply = vi.fn().mockResolvedValue({ ok: true });
    installHana({ available: { train: 9, version: '0.400.0', serverSha256: 'a'.repeat(64), rendererSha256: 'b'.repeat(64), sizes: { server: 1, renderer: 1 }, recordedAt: '2026-07-11T00:00:00.000Z' } });
    (window.hana as unknown as { trainUpdateApply: typeof trainUpdateApply }).trainUpdateApply = trainUpdateApply;

    render(<SidebarNoticeSlot />);
    const card = await screen.findByText('有新版本可用');
    fireEvent.click(card);

    expect(trainUpdateApply).toHaveBeenCalledTimes(1);
  });

  it('shows the blocked form and wires it to autoUpdateInstall when minShellBlocked is true', async () => {
    const autoUpdateInstall = vi.fn();
    installHana({ minShellBlocked: true });
    (window.hana as unknown as { autoUpdateInstall: typeof autoUpdateInstall }).autoUpdateInstall = autoUpdateInstall;

    render(<SidebarNoticeSlot />);
    const card = await screen.findByText('完成此更新后才能继续接收新版本');
    fireEvent.click(card);

    expect(autoUpdateInstall).toHaveBeenCalledTimes(1);
  });

  it('reacts to a background onTrainUpdateAvailable broadcast without a remount', async () => {
    type AvailablePayload = { version: string; minShellBlocked: boolean };
    const box: { deliver: ((payload: AvailablePayload) => void) | null } = { deliver: null };
    installHana({});
    (window.hana as unknown as { onTrainUpdateAvailable: (cb: (p: AvailablePayload) => void) => () => void }).onTrainUpdateAvailable = (cb) => {
      box.deliver = cb;
      return () => { box.deliver = null; };
    };

    render(<SidebarNoticeSlot />);
    await waitFor(() => expect(window.hana?.trainUpdateStatus).toHaveBeenCalled());
    expect(screen.queryByText('有新版本可用')).not.toBeInTheDocument();
    await waitFor(() => expect(box.deliver).not.toBeNull());

    box.deliver?.({ version: '0.402.0', minShellBlocked: false });

    expect(await screen.findByText('有新版本可用')).toBeInTheDocument();
    expect(screen.getByText('v0.402.0')).toBeInTheDocument();
  });
});
