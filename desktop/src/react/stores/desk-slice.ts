import type { DeskFile } from '../types';

export interface DeskSkillInfo {
  name: string;
  enabled: boolean;
  source?: string;
  externalLabel?: string | null;
}

export interface DeskSlice {
  deskFiles: DeskFile[];
  deskBasePath: string;
  deskCurrentPath: string;
  deskJianContent: string | null;
  deskSkills: DeskSkillInfo[];
  setDeskFiles: (files: DeskFile[]) => void;
  setDeskBasePath: (path: string) => void;
  setDeskCurrentPath: (path: string) => void;
  setDeskJianContent: (content: string | null) => void;
  setDeskSkills: (skills: DeskSkillInfo[]) => void;
}

export const createDeskSlice = (
  set: (partial: Partial<DeskSlice>) => void
): DeskSlice => ({
  deskFiles: [],
  deskBasePath: '',
  deskCurrentPath: '',
  deskJianContent: null,
  deskSkills: [],
  setDeskFiles: (files) => set({ deskFiles: files }),
  setDeskBasePath: (path) => set({ deskBasePath: path }),
  setDeskCurrentPath: (path) => set({ deskCurrentPath: path }),
  setDeskJianContent: (content) => set({ deskJianContent: content }),
  setDeskSkills: (skills) => set({ deskSkills: skills }),
});
