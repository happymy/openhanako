import { useStore } from './index';
import type { PreviewItem } from '../types';
import type { EditorView } from '@codemirror/view';

/**
 * 捕获 previewItem 中的文本选中。
 * CM 模式传入 cmView，DOM 模式不传。
 */
export function captureSelection(previewItem: PreviewItem, cmView?: EditorView): void {
  if (cmView) {
    captureCMSelection(previewItem, cmView);
  } else {
    captureDOMSelection(previewItem);
  }
}

function captureCMSelection(previewItem: PreviewItem, view: EditorView): void {
  const { from, to } = view.state.selection.main;
  if (from === to) {
    clearSelection();
    return;
  }
  const rawText = view.state.sliceDoc(from, to);
  const text = rawText.trim();
  if (!text) {
    clearSelection();
    return;
  }
  const leadingTrimmed = rawText.length - rawText.trimStart().length;
  const trailingTrimmed = rawText.length - rawText.trimEnd().length;
  const textStart = from + leadingTrimmed;
  const textEnd = to - trailingTrimmed;
  const lineStart = view.state.doc.lineAt(textStart).number;
  const lineEnd = view.state.doc.lineAt(Math.max(textStart, textEnd - 1)).number;

  useStore.getState().setQuotedSelection({
    text,
    sourceTitle: previewItem.title,
    sourceFilePath: previewItem.filePath,
    lineStart,
    lineEnd,
    charCount: text.length,
  });
}

function captureDOMSelection(previewItem: PreviewItem): void {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (!text) {
    clearSelection();
    return;
  }
  const clipped = text.length > 2000 ? text.slice(0, 2000) : text;

  useStore.getState().setQuotedSelection({
    text: clipped,
    sourceTitle: previewItem.title,
    charCount: text.length,
  });
}

export function clearSelection(): void {
  const s = useStore.getState();
  if (s.quotedSelection) s.clearQuotedSelection();
}
