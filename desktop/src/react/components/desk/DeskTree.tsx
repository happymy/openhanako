/**
 * DeskTree — Obsidian-like single-column workspace tree.
 *
 * Tree state is keyed by explicit subdir strings in desk-slice. The component
 * never derives ownership from the current focused file or session.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../../stores';
import {
  deskMoveTreeFiles,
  deskUploadFilesToSubdir,
  loadDeskTreeFiles,
} from '../../stores/desk-actions';
import { openFilePreview } from '../../utils/file-preview';
import {
  clearAppFileDragPayload,
  readAppFileDragPayload,
  writeAppFileDragPayload,
} from '../../utils/app-file-drag';
import type { DeskFile } from '../../types';
import type { CtxMenuState, SortMode } from './desk-types';
import { ICONS, getFileIcon, sortDeskFiles } from './desk-types';
import s from './Desk.module.css';

function childSubdir(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function parentSubdir(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

function fullPath(basePath: string, subdir: string): string {
  if (!basePath) return subdir;
  return subdir ? `${basePath}/${subdir}` : basePath;
}

function isDescendant(path: string, parent: string): boolean {
  return path.startsWith(`${parent}/`);
}

function treeItemSubdir(sourceSubdir: string | undefined, name: string): string {
  return sourceSubdir ? `${sourceSubdir}/${name}` : name;
}

interface VisibleTreeEntry {
  file: DeskFile;
  parent: string;
  subdir: string;
  depth: number;
}

interface TreeSelectMeta {
  multi: boolean;
  shift: boolean;
}

function collectVisibleTreeEntries(
  files: DeskFile[],
  parent: string,
  depth: number,
  sortMode: SortMode,
  expandedPaths: string[],
  treeFilesByPath: Record<string, DeskFile[]>,
): VisibleTreeEntry[] {
  const entries: VisibleTreeEntry[] = [];
  for (const file of sortDeskFiles(files, sortMode)) {
    const subdir = childSubdir(parent, file.name);
    entries.push({ file, parent, subdir, depth });
    if (file.isDir && expandedPaths.includes(subdir)) {
      entries.push(...collectVisibleTreeEntries(
        treeFilesByPath[subdir] || [],
        subdir,
        depth + 1,
        sortMode,
        expandedPaths,
        treeFilesByPath,
      ));
    }
  }
  return entries;
}

function hasSelectedDirectoryAncestor(entry: VisibleTreeEntry, selectedDirs: Set<string>): boolean {
  let current = parentSubdir(entry.subdir);
  while (current) {
    if (selectedDirs.has(current)) return true;
    current = parentSubdir(current);
  }
  return false;
}

function compactDragEntries(entries: VisibleTreeEntry[]): VisibleTreeEntry[] {
  const selectedDirs = new Set(entries.filter(entry => entry.file.isDir).map(entry => entry.subdir));
  if (selectedDirs.size === 0) return entries;
  return entries.filter(entry => !hasSelectedDirectoryAncestor(entry, selectedDirs));
}

function buildMoveItemsForDest(files: Array<{
  sourceSubdir?: string;
  name: string;
  isDirectory?: boolean;
}>, destSubdir: string) {
  const normalizedDest = destSubdir.replace(/^\/+|\/+$/g, '');
  return files
    .filter(item => item.sourceSubdir !== undefined)
    .filter(item => {
      const sourceSubdir = (item.sourceSubdir || '').replace(/^\/+|\/+$/g, '');
      if (sourceSubdir === normalizedDest) return false;
      if (!item.isDirectory) return true;
      const itemSubdir = treeItemSubdir(sourceSubdir, item.name);
      return normalizedDest !== itemSubdir && !normalizedDest.startsWith(`${itemSubdir}/`);
    })
    .map(item => ({
      sourceSubdir: (item.sourceSubdir || '').replace(/^\/+|\/+$/g, ''),
      name: item.name,
      isDirectory: item.isDirectory,
    }));
}

function toggleExpanded(paths: string[], subdir: string): string[] {
  if (paths.includes(subdir)) {
    return paths.filter(path => path !== subdir && !isDescendant(path, subdir));
  }
  return [...paths, subdir];
}

function TreeDisclosureIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {expanded ? <polyline points="6 9 12 15 18 9" /> : <polyline points="9 6 15 12 9 18" />}
    </svg>
  );
}

function TreeNode({
  file,
  parent,
  depth,
  sortMode,
  onShowMenu,
  selectedPaths,
  onSelect,
  getDragEntries,
}: {
  file: DeskFile;
  parent: string;
  depth: number;
  sortMode: SortMode;
  onShowMenu: (state: CtxMenuState) => void;
  selectedPaths: Set<string>;
  onSelect: (subdir: string, meta: TreeSelectMeta) => void;
  getDragEntries: (subdir: string) => VisibleTreeEntry[];
}) {
  const deskBasePath = useStore(st => st.deskBasePath);
  const treeFilesByPath = useStore(st => st.deskTreeFilesByPath);
  const expandedPaths = useStore(st => st.deskExpandedPaths);
  const setDeskExpandedPaths = useStore(st => st.setDeskExpandedPaths);
  const subdir = childSubdir(parent, file.name);
  const expanded = file.isDir && expandedPaths.includes(subdir);
  const selected = selectedPaths.has(subdir);
  const children = treeFilesByPath[subdir] || [];
  const t = window.t ?? ((p: string) => p);
  const [dropTarget, setDropTarget] = useState(false);

  useEffect(() => {
    if (!dropTarget) return undefined;
    const clear = () => setDropTarget(false);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
      window.removeEventListener('blur', clear);
    };
  }, [dropTarget]);

  const toggleFolder = useCallback(() => {
    if (!file.isDir) return;
    setDeskExpandedPaths(toggleExpanded(expandedPaths, subdir));
    if (!expanded) void loadDeskTreeFiles(subdir);
  }, [expanded, expandedPaths, file.isDir, setDeskExpandedPaths, subdir]);

  const handleClick = useCallback((event: React.MouseEvent) => {
    const multi = event.metaKey || event.ctrlKey;
    onSelect(subdir, { multi, shift: event.shiftKey });
    if (file.isDir && !multi && !event.shiftKey) toggleFolder();
  }, [file.isDir, onSelect, subdir, toggleFolder]);

  const openFile = useCallback(() => {
    onSelect(subdir, { multi: false, shift: false });
    if (file.isDir) {
      if (!expanded) toggleFolder();
      return;
    }
    const path = fullPath(deskBasePath, subdir);
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    openFilePreview(path, file.name, ext, { origin: 'desk' });
  }, [deskBasePath, expanded, file, onSelect, subdir, toggleFolder]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedPaths.has(subdir)) onSelect(subdir, { multi: false, shift: false });
    const path = fullPath(deskBasePath, subdir);
    onShowMenu({
      position: { x: e.clientX, y: e.clientY },
      items: [
        {
          label: t(file.isDir ? 'desk.ctx.open' : 'desk.openWithDefault'),
          action: () => {
            if (file.isDir) {
              setDeskExpandedPaths(expandedPaths.includes(subdir) ? expandedPaths : [...expandedPaths, subdir]);
              void loadDeskTreeFiles(subdir);
            } else {
              window.platform?.openFile?.(path);
            }
          },
        },
        { label: t('desk.ctx.openInFinder'), action: () => window.platform?.showInFinder?.(path) },
        { label: t('desk.ctx.copyPath'), action: () => navigator.clipboard.writeText(path).catch(() => {}) },
      ],
    });
  }, [deskBasePath, expandedPaths, file.isDir, onSelect, onShowMenu, selectedPaths, setDeskExpandedPaths, subdir, t]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    if (!selectedPaths.has(subdir)) onSelect(subdir, { multi: false, shift: false });
    const dragEntries = getDragEntries(subdir);
    const draggedFiles = dragEntries.map(entry => ({
      id: `workspace:${entry.subdir}`,
      name: entry.file.name,
      path: fullPath(deskBasePath, entry.subdir),
      sourceSubdir: entry.parent,
      isDirectory: entry.file.isDir,
    }));
    if (draggedFiles.length === 0) return;
    const payload = writeAppFileDragPayload(e.dataTransfer, {
      source: 'workspace',
      files: draggedFiles,
    });
    e.currentTarget.addEventListener('dragend', () => clearAppFileDragPayload(payload.dragId), { once: true });
    e.preventDefault();
    const paths = draggedFiles.map(item => item.path);
    window.platform?.startDrag?.(paths.length === 1 ? paths[0] : paths);
  }, [deskBasePath, getDragEntries, onSelect, selectedPaths, subdir]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!file.isDir) return;
    const payload = readAppFileDragPayload(e.dataTransfer);
    const canMove = payload?.source !== 'workspace'
      || buildMoveItemsForDest(payload.files, subdir).length > 0;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = payload?.source === 'workspace'
      ? (canMove ? 'move' : 'none')
      : 'copy';
    setDropTarget(canMove);
  }, [file.isDir, subdir]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!file.isDir) return;
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(false);
  }, [file.isDir]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    if (!file.isDir) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(false);

    const payload = readAppFileDragPayload(e.dataTransfer);
    if (payload?.source === 'workspace') {
      clearAppFileDragPayload(payload.dragId);
      const items = buildMoveItemsForDest(payload.files, subdir);
      if (items.length > 0) await deskMoveTreeFiles(items, subdir);
      return;
    }

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const paths: string[] = [];
      for (const f of Array.from(files)) {
        const p = window.platform?.getFilePath?.(f);
        if (p) paths.push(p);
      }
      if (paths.length > 0) await deskUploadFilesToSubdir(paths, subdir);
    }
  }, [file.isDir, subdir]);

  return (
    <>
      <div
        className={`${s.treeItem}${selected ? ` ${s.treeItemSelected}` : ''}${dropTarget ? ` ${s.treeItemDropTarget}` : ''}`}
        role="treeitem"
        aria-label={file.name}
        aria-expanded={file.isDir ? expanded : undefined}
        data-desk-item=""
        data-selected={selected ? 'true' : 'false'}
        style={{ '--tree-depth': depth } as CSSProperties}
        onClick={handleClick}
        onDoubleClick={openFile}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={handleDragStart}
        onDragOver={file.isDir ? handleDragOver : undefined}
        onDragLeave={file.isDir ? handleDragLeave : undefined}
        onDrop={file.isDir ? handleDrop : undefined}
      >
        <span className={s.treeIndent} aria-hidden="true" />
        <span className={s.treeDisclosure} aria-hidden="true">
          {file.isDir ? <TreeDisclosureIcon expanded={expanded} /> : null}
        </span>
        <span
          className={s.itemIcon}
          dangerouslySetInnerHTML={{ __html: file.isDir ? ICONS.folder : getFileIcon(file.name) }}
        />
        <span className={s.itemName} title={file.name}>{file.name}</span>
      </div>
      {expanded && children.length > 0 && (
        <div role="group" className={s.treeGroup}>
          {sortDeskFiles(children, sortMode).map(child => (
            <TreeNode
              key={childSubdir(subdir, child.name)}
              file={child}
              parent={subdir}
              depth={depth + 1}
              sortMode={sortMode}
              onShowMenu={onShowMenu}
              selectedPaths={selectedPaths}
              onSelect={onSelect}
              getDragEntries={getDragEntries}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function DeskTree({ sortMode, onShowMenu }: {
  sortMode: SortMode;
  onShowMenu: (state: CtxMenuState) => void;
}) {
  const deskBasePath = useStore(s => s.deskBasePath);
  const rootFiles = useStore(s => s.deskTreeFilesByPath[''] || s.deskFiles);
  const treeFilesByPath = useStore(s => s.deskTreeFilesByPath);
  const expandedPaths = useStore(s => s.deskExpandedPaths);
  const setDeskSelectedPath = useStore(s => s.setDeskSelectedPath);
  const sortedRootFiles = useMemo(() => sortDeskFiles(rootFiles, sortMode), [rootFiles, sortMode]);
  const visibleEntries = useMemo(
    () => collectVisibleTreeEntries(rootFiles, '', 0, sortMode, expandedPaths, treeFilesByPath),
    [expandedPaths, rootFiles, sortMode, treeFilesByPath],
  );
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

  useEffect(() => {
    if (!deskBasePath) return;
    void loadDeskTreeFiles('');
  }, [deskBasePath]);

  useEffect(() => {
    const visible = new Set(visibleEntries.map(entry => entry.subdir));
    setSelectedPaths(prev => {
      const next = new Set([...prev].filter(path => visible.has(path)));
      return next.size === prev.size ? prev : next;
    });
    setSelectionAnchor(prev => (prev && visible.has(prev) ? prev : null));
  }, [visibleEntries]);

  const selectTreePath = useCallback((subdir: string, meta: TreeSelectMeta) => {
    setDeskSelectedPath(subdir);
    if (meta.shift && selectionAnchor) {
      const anchorIndex = visibleEntries.findIndex(entry => entry.subdir === selectionAnchor);
      const currentIndex = visibleEntries.findIndex(entry => entry.subdir === subdir);
      if (anchorIndex >= 0 && currentIndex >= 0) {
        const start = Math.min(anchorIndex, currentIndex);
        const end = Math.max(anchorIndex, currentIndex);
        setSelectedPaths(prev => {
          const next = meta.multi ? new Set(prev) : new Set<string>();
          for (let i = start; i <= end; i++) next.add(visibleEntries[i].subdir);
          return next;
        });
        return;
      }
    }

    if (meta.multi) {
      setSelectedPaths(prev => {
        const next = new Set(prev);
        if (next.has(subdir)) next.delete(subdir);
        else next.add(subdir);
        return next;
      });
      setSelectionAnchor(subdir);
      return;
    }

    setSelectedPaths(new Set([subdir]));
    setSelectionAnchor(subdir);
  }, [selectionAnchor, setDeskSelectedPath, visibleEntries]);

  const getDragEntries = useCallback((subdir: string): VisibleTreeEntry[] => {
    const entries = selectedPaths.has(subdir)
      ? visibleEntries.filter(entry => selectedPaths.has(entry.subdir))
      : visibleEntries.filter(entry => entry.subdir === subdir);
    return compactDragEntries(entries);
  }, [selectedPaths, visibleEntries]);

  return (
    <div className={s.tree} role="tree" data-desk-tree="" data-empty-text={window.t?.('common.noFiles') || ''}>
      {sortedRootFiles.map(file => (
        <TreeNode
          key={file.name}
          file={file}
          parent=""
          depth={0}
          sortMode={sortMode}
          onShowMenu={onShowMenu}
          selectedPaths={selectedPaths}
          onSelect={selectTreePath}
          getDragEntries={getDragEntries}
        />
      ))}
    </div>
  );
}
