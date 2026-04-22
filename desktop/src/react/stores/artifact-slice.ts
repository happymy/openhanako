import type { Artifact } from '../types';

// ── Slice ──

export interface ArtifactSlice {
  /** 全局 artifact 池（user-level），所有 session 共享 */
  artifacts: Artifact[];
  /** 当前打开的 tab id 列表（user-level） */
  openTabs: string[];
  /** 当前激活的 tab id */
  activeTabId: string | null;
}

export const createArtifactSlice = (
  _set: (partial: Partial<ArtifactSlice> | ((s: ArtifactSlice) => Partial<ArtifactSlice>)) => void
): ArtifactSlice => ({
  artifacts: [],
  openTabs: [],
  activeTabId: null,
});

// ── Selectors ──

export const selectArtifacts = (s: ArtifactSlice): Artifact[] => s.artifacts;
export const selectOpenTabs = (s: ArtifactSlice): string[] => s.openTabs;
export const selectActiveTabId = (s: ArtifactSlice): string | null => s.activeTabId;
