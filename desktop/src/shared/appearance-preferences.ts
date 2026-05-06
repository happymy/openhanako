type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const PAPER_TEXTURE_STORAGE_KEY = 'hana-paper-texture';
export const PAPER_TEXTURE_CLASS = 'paper-texture';
export const LEGACY_NO_PAPER_TEXTURE_CLASS = 'no-paper-texture';

export function isPaperTextureEnabled(storage: PreferenceStorage = window.localStorage): boolean {
  return storage.getItem(PAPER_TEXTURE_STORAGE_KEY) === '1';
}

export function applyPaperTextureClass(
  enabled: boolean,
  body: HTMLElement = document.body,
): void {
  body.classList.toggle(PAPER_TEXTURE_CLASS, enabled);
  body.classList.remove(LEGACY_NO_PAPER_TEXTURE_CLASS);
}

export function setPaperTexturePreference(
  enabled: boolean,
  storage: PreferenceStorage = window.localStorage,
  body: HTMLElement = document.body,
): void {
  applyPaperTextureClass(enabled, body);
  storage.setItem(PAPER_TEXTURE_STORAGE_KEY, enabled ? '1' : '0');
}

export function loadPaperTexturePreference(
  storage: PreferenceStorage = window.localStorage,
  body: HTMLElement = document.body,
): boolean {
  const enabled = isPaperTextureEnabled(storage);
  applyPaperTextureClass(enabled, body);
  return enabled;
}
