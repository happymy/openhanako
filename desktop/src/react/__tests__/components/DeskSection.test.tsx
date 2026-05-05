/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';

const mocks = vi.hoisted(() => ({
  loadDeskFiles: vi.fn(async () => {}),
  loadDeskTreeFiles: vi.fn(async () => {}),
  deskMoveTreeFiles: vi.fn(async () => {}),
}));

vi.mock('../../stores/desk-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/desk-actions')>();
  return {
    ...actual,
    loadDeskFiles: mocks.loadDeskFiles,
    loadDeskTreeFiles: mocks.loadDeskTreeFiles,
    deskMoveTreeFiles: mocks.deskMoveTreeFiles,
  };
});

describe('DeskSection directory watching', () => {
  let emitFileChanged: ((filePath: string) => void) | null;
  let watchFile: ReturnType<typeof vi.fn>;
  let unwatchFile: ReturnType<typeof vi.fn>;
  let localStorageData: Record<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorageData = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => localStorageData[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageData[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageData[key];
      }),
      clear: vi.fn(() => {
        localStorageData = {};
      }),
    });
    emitFileChanged = null;
    watchFile = vi.fn(async () => true);
    unwatchFile = vi.fn(async () => true);
    window.t = ((key: string) => key === 'desk.workspaceTitle' ? '工作空间' : key) as typeof window.t;
    window.platform = {
      watchFile,
      unwatchFile,
      onFileChanged: vi.fn((callback: (filePath: string) => void) => {
        emitFileChanged = callback;
      }),
      startDrag: vi.fn(),
    } as unknown as typeof window.platform;
    useStore.setState({
      serverPort: 62950,
      deskBasePath: '/tmp/hana-desk',
      deskCurrentPath: 'notes',
      deskFiles: [],
      deskTreeFilesByPath: {
        '': [{ name: 'notes', isDir: true }],
        notes: [],
      },
      deskExpandedPaths: ['notes'],
      deskSelectedPath: '',
      deskJianContent: null,
      currentTab: 'chat',
      jianOpen: true,
      jianView: 'desk',
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('watches expanded tree directories and reloads only the matching tree key', async () => {
    const { DeskSection } = await import('../../components/DeskSection');

    render(<DeskSection />);

    expect(watchFile).toHaveBeenCalledWith('/tmp/hana-desk');
    expect(watchFile).toHaveBeenCalledWith('/tmp/hana-desk/notes');

    act(() => {
      emitFileChanged?.('/tmp/hana-desk/notes');
      vi.runOnlyPendingTimers();
    });

    expect(mocks.loadDeskTreeFiles).toHaveBeenCalledWith('notes', { force: true });
  });

  it('renders a single-column tree and expands folders by explicit subdir', async () => {
    useStore.setState({
      deskCurrentPath: '',
      deskTreeFilesByPath: {
        '': [
          { name: 'notes', isDir: true },
          { name: 'root.md', isDir: false },
        ],
      },
      deskExpandedPaths: [],
    } as never);
    const { DeskSection } = await import('../../components/DeskSection');

    render(<DeskSection />);

    expect(screen.getByRole('tree')).toBeTruthy();
    fireEvent.click(screen.getByRole('treeitem', { name: /notes/ }));

    expect(mocks.loadDeskTreeFiles).toHaveBeenCalledWith('notes');
    expect(useStore.getState().deskExpandedPaths).toEqual(['notes']);

    act(() => {
      useStore.setState({
        deskTreeFilesByPath: {
          '': [
            { name: 'notes', isDir: true },
            { name: 'root.md', isDir: false },
          ],
          notes: [{ name: 'chapter.md', isDir: false }],
        },
      } as never);
    });

    expect(screen.getByText('chapter.md')).toBeTruthy();
  });

  it('starts an app file drag from tree rows so workspace files can be moved or attached', async () => {
    useStore.setState({
      deskCurrentPath: 'drafts',
      deskTreeFilesByPath: {
        '': [
          { name: 'notes', isDir: true },
          { name: 'root.md', isDir: false },
        ],
      },
      deskExpandedPaths: [],
      deskSelectedPath: '',
    } as never);
    const { DeskSection } = await import('../../components/DeskSection');
    const { getActiveAppFileDragPayload } = await import('../../utils/app-file-drag');

    render(<DeskSection />);

    const rootFile = screen.getByRole('treeitem', { name: /root.md/ });
    fireEvent.dragStart(rootFile);

    expect(window.platform?.startDrag).toHaveBeenCalledWith('/tmp/hana-desk/root.md');
    expect(getActiveAppFileDragPayload()).toEqual(expect.objectContaining({
      source: 'workspace',
      files: [{
        id: 'workspace:root.md',
        name: 'root.md',
        path: '/tmp/hana-desk/root.md',
        sourceSubdir: '',
        isDirectory: false,
      }],
    }));
  });

  it('does not move a nested file to the workspace root when dropped back on its own row', async () => {
    useStore.setState({
      deskCurrentPath: '',
      deskTreeFilesByPath: {
        '': [{ name: 'notes', isDir: true }],
        notes: [{ name: 'chapter.md', isDir: false }],
      },
      deskExpandedPaths: ['notes'],
      deskSelectedPath: '',
    } as never);
    const { DeskSection } = await import('../../components/DeskSection');
    const { clearAppFileDragPayload } = await import('../../utils/app-file-drag');

    render(<DeskSection />);

    const chapter = screen.getByRole('treeitem', { name: /chapter.md/ });
    fireEvent.dragStart(chapter);
    fireEvent.drop(chapter);

    expect(mocks.deskMoveTreeFiles).not.toHaveBeenCalled();
    clearAppFileDragPayload();
  });

  it('uses shift ranges and command/control additive selection when dragging tree rows', async () => {
    useStore.setState({
      deskCurrentPath: '',
      deskTreeFilesByPath: {
        '': [
          { name: 'a.md', isDir: false },
          { name: 'b.md', isDir: false },
          { name: 'c.md', isDir: false },
          { name: 'd.md', isDir: false },
        ],
      },
      deskExpandedPaths: [],
      deskSelectedPath: '',
    } as never);
    const { DeskSection } = await import('../../components/DeskSection');
    const { clearAppFileDragPayload, getActiveAppFileDragPayload } = await import('../../utils/app-file-drag');

    render(<DeskSection />);

    fireEvent.click(screen.getByRole('treeitem', { name: /a.md/ }));
    fireEvent.click(screen.getByRole('treeitem', { name: /c.md/ }), { shiftKey: true });
    fireEvent.click(screen.getByRole('treeitem', { name: /d.md/ }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('treeitem', { name: /b.md/ }), { metaKey: true });
    fireEvent.dragStart(screen.getByRole('treeitem', { name: /c.md/ }));

    expect(getActiveAppFileDragPayload()?.files.map(file => file.name)).toEqual(['a.md', 'c.md', 'd.md']);
    expect(window.platform?.startDrag).toHaveBeenCalledWith([
      '/tmp/hana-desk/a.md',
      '/tmp/hana-desk/c.md',
      '/tmp/hana-desk/d.md',
    ]);
    clearAppFileDragPayload();
  });

  it('marks the right workspace card with the Jian drawer state for overlay layout', async () => {
    useStore.setState({ jianDrawerOpen: true } as never);
    const { RightWorkspacePanel } = await import('../../components/right-workspace/RightWorkspacePanel');

    render(<RightWorkspacePanel />);

    expect(document.querySelector('[data-right-workspace-card]')?.getAttribute('data-jian-open')).toBe('true');
  });

  it('uses the visible workspace root name as the sidebar title', async () => {
    const { DeskSection } = await import('../../components/DeskSection');

    render(<DeskSection />);

    expect(screen.getByText('工作空间 · hana-desk')).toBeTruthy();

    act(() => {
      useStore.setState({ deskBasePath: '/workspace/Desktop', deskCurrentPath: '' } as never);
    });

    expect(screen.getByText('工作空间 · Desktop')).toBeTruthy();
  });

  it('unwatches collapsed tree directories after the expanded set changes', async () => {
    const { DeskSection } = await import('../../components/DeskSection');

    render(<DeskSection />);
    expect(watchFile).toHaveBeenCalledWith('/tmp/hana-desk/notes');

    act(() => {
      useStore.setState({
        deskTreeFilesByPath: {
          '': [{ name: 'archive', isDir: true }],
          archive: [],
        },
        deskExpandedPaths: ['archive'],
      } as never);
    });

    expect(unwatchFile).toHaveBeenCalledWith('/tmp/hana-desk/notes');
    expect(watchFile).toHaveBeenCalledWith('/tmp/hana-desk/archive');

    mocks.loadDeskTreeFiles.mockClear();
    act(() => {
      emitFileChanged?.('/tmp/hana-desk/notes');
      vi.runOnlyPendingTimers();
    });

    expect(mocks.loadDeskTreeFiles).not.toHaveBeenCalled();
  });
});
