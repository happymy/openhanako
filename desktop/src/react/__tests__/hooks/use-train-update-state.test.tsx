/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTrainUpdateState } from '../../hooks/use-train-update-state';
import type { PlatformApi, TrainUpdateAvailable, TrainUpdateProgress, TrainUpdateStatus } from '../../types';

let availableListener: ((payload: { version: string; minShellBlocked: boolean }) => void) | null = null;
let progressListener: ((progress: TrainUpdateProgress) => void) | null = null;

function baseStatus(partial: Partial<TrainUpdateStatus> = {}): TrainUpdateStatus {
  return {
    staged: false,
    train: null,
    version: null,
    minShellBlocked: false,
    available: null,
    lastError: null,
    lastCheckedAt: null,
    currentVersion: '0.388.0',
    ...partial,
  };
}

function available(version: string): TrainUpdateAvailable {
  return {
    train: 9,
    version,
    serverSha256: 'a'.repeat(64),
    rendererSha256: 'b'.repeat(64),
    sizes: { server: 100, renderer: 200 },
    recordedAt: '2026-07-11T00:00:00.000Z',
  };
}

function installHana(overrides: Partial<PlatformApi> = {}) {
  availableListener = null;
  progressListener = null;
  window.hana = {
    trainUpdateStatus: vi.fn().mockResolvedValue(baseStatus()),
    trainUpdateCheck: vi.fn().mockResolvedValue({ outcome: 'up-to-date' }),
    trainUpdateApply: vi.fn().mockResolvedValue({ ok: true }),
    onTrainUpdateAvailable: vi.fn((cb) => {
      availableListener = cb;
      return () => { availableListener = null; };
    }),
    onTrainUpdateProgress: vi.fn((cb) => {
      progressListener = cb;
      return () => { progressListener = null; };
    }),
    ...overrides,
  } as unknown as PlatformApi;
}

function Harness() {
  const { currentVersion, available: availableUpdate, minShellBlocked, lastError, lastCheckedAt, phase, progress, checkNow, applyNow } = useTrainUpdateState();
  return (
    <div>
      <div data-testid="currentVersion">{currentVersion || 'none'}</div>
      <div data-testid="available">{availableUpdate?.version ?? 'none'}</div>
      <div data-testid="minShellBlocked">{String(minShellBlocked)}</div>
      <div data-testid="lastError">{lastError ?? 'none'}</div>
      <div data-testid="lastCheckedAt">{lastCheckedAt ?? 'none'}</div>
      <div data-testid="phase">{phase}</div>
      <div data-testid="progress">{progress ? `${progress.receivedBytes}/${progress.totalBytes}` : 'none'}</div>
      <button onClick={() => void checkNow()}>check</button>
      <button onClick={() => void applyNow()}>apply</button>
    </div>
  );
}

describe('useTrainUpdateState', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    availableListener = null;
    progressListener = null;
  });

  it('hydrates currentVersion and a null available from the cached status on mount', async () => {
    installHana({ trainUpdateStatus: vi.fn().mockResolvedValue(baseStatus({ currentVersion: '0.388.0' })) });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('currentVersion').textContent).toBe('0.388.0'));
    expect(screen.getByTestId('available').textContent).toBe('none');
    expect(screen.getByTestId('phase').textContent).toBe('idle');
  });

  it('surfaces a cached available update, lastError and lastCheckedAt verbatim (no staged/downloaded mapping)', async () => {
    installHana({
      trainUpdateStatus: vi.fn().mockResolvedValue(baseStatus({
        currentVersion: '0.388.0',
        available: available('0.389.0'),
        lastError: 'network down',
        lastCheckedAt: '2026-07-11T08:00:00.000Z',
      })),
    });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('available').textContent).toBe('0.389.0'));
    expect(screen.getByTestId('lastError').textContent).toBe('network down');
    expect(screen.getByTestId('lastCheckedAt').textContent).toBe('2026-07-11T08:00:00.000Z');
  });

  it('never reads the legacy staged/train/version fields — only `available` decides whether an update is showing', async () => {
    // staged=true with no `available` (the shape a shell that only understood
    // the old contract might still emit) must NOT surface as an update.
    installHana({
      trainUpdateStatus: vi.fn().mockResolvedValue(baseStatus({ staged: true, train: 5, version: '0.400.0', available: null })),
    });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('currentVersion').textContent).toBe('0.388.0'));
    expect(screen.getByTestId('available').textContent).toBe('none');
  });

  it('lights up in real time when onTrainUpdateAvailable fires, without waiting for a remount', async () => {
    installHana();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('available').textContent).toBe('none'));

    act(() => {
      availableListener?.({ version: '0.390.0', minShellBlocked: false });
    });

    expect(screen.getByTestId('available').textContent).toBe('0.390.0');
    expect(screen.getByTestId('minShellBlocked').textContent).toBe('false');
  });

  it('checkNow goes checking -> idle and refreshes available/lastError/lastCheckedAt from a fresh read', async () => {
    let status = baseStatus({ currentVersion: '0.388.0' });
    installHana({
      trainUpdateStatus: vi.fn().mockImplementation(async () => status),
      trainUpdateCheck: vi.fn().mockImplementation(async () => {
        status = baseStatus({ currentVersion: '0.388.0', available: available('0.389.0'), lastCheckedAt: '2026-07-11T09:00:00.000Z' });
        return { outcome: 'available', train: 9, version: '0.389.0' };
      }),
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('idle'));

    await act(async () => {
      screen.getByText('check').click();
    });

    expect(screen.getByTestId('available').textContent).toBe('0.389.0');
    expect(screen.getByTestId('lastCheckedAt').textContent).toBe('2026-07-11T09:00:00.000Z');
    expect(screen.getByTestId('phase').textContent).toBe('idle');
  });

  it('checkNow surfaces an error outcome as lastError and returns phase to idle', async () => {
    installHana({
      trainUpdateCheck: vi.fn().mockResolvedValue({ outcome: 'error', error: 'network down' }),
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('idle'));

    await act(async () => {
      screen.getByText('check').click();
    });

    expect(screen.getByTestId('lastError').textContent).toBe('network down');
    expect(screen.getByTestId('phase').textContent).toBe('idle');
  });

  it('applyNow delegates straight to window.hana.trainUpdateApply and goes optimistically busy before the first progress event', async () => {
    const trainUpdateApply = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves in this test
    installHana({ trainUpdateApply });

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('idle'));

    act(() => {
      screen.getByText('apply').click();
    });

    expect(trainUpdateApply).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('phase').textContent).toBe('downloading');
  });

  it('onTrainUpdateProgress drives phase (downloading vs applying) and byte progress while apply is in flight', async () => {
    installHana();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('idle'));

    act(() => {
      progressListener?.({ phase: 'downloading', kind: 'server', receivedBytes: 50, totalBytes: 200 });
    });
    expect(screen.getByTestId('phase').textContent).toBe('downloading');
    expect(screen.getByTestId('progress').textContent).toBe('50/200');

    act(() => {
      progressListener?.({ phase: 'activating', kind: 'renderer', receivedBytes: 200, totalBytes: 200 });
    });
    expect(screen.getByTestId('phase').textContent).toBe('applying');
    expect(screen.getByTestId('progress').textContent).toBe('200/200');
  });

  it('applyNow surfaces a failed apply as lastError and returns to idle so the user can retry', async () => {
    installHana({ trainUpdateApply: vi.fn().mockResolvedValue({ ok: false, error: 'sha256 mismatch' }) });

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('idle'));

    await act(async () => {
      screen.getByText('apply').click();
    });

    expect(screen.getByTestId('lastError').textContent).toBe('sha256 mismatch');
    expect(screen.getByTestId('phase').textContent).toBe('idle');
  });
});
