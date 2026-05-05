import { useMemo } from 'react';
import { useStore } from '../../stores';
import { selectSessionFiles } from '../../stores/selectors/file-refs';
import type { FileRef } from '../../types/file-ref';
import { openFilePreview } from '../../utils/file-preview';
import { extOfName, isMediaKind } from '../../utils/file-kind';
import { openMediaViewerForRef } from '../../utils/open-media-viewer';
import styles from './RightWorkspacePanel.module.css';

const EMPTY_FILES: readonly FileRef[] = Object.freeze([]);

function statusLabel(file: FileRef): string {
  const t = window.t ?? ((p: string) => p);
  if (file.status === 'expired') return t('rightWorkspace.sessionFiles.status.expired');
  return t('rightWorkspace.sessionFiles.status.available');
}

function sourceLabel(file: FileRef): string {
  return file.source;
}

function formatKind(file: FileRef): string {
  return (file.ext || file.kind || 'file').toUpperCase();
}

function isExpired(file: FileRef): boolean {
  return file.status === 'expired';
}

function actionLabel(key: string, file: FileRef): string {
  const t = window.t ?? ((p: string) => p);
  return `${t(key)} ${file.name}`;
}

function ActionIcon({ type }: { type: 'preview' | 'open' | 'reveal' | 'copy' }) {
  if (type === 'preview') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  }
  if (type === 'open') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    );
  }
  if (type === 'reveal') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 6h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <circle cx="12" cy="14" r="2.5" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function SessionFileRow({ file, sessionPath }: { file: FileRef; sessionPath: string | null }) {
  const expired = isExpired(file);
  const ext = file.ext || extOfName(file.name) || '';
  const canPreview = !expired && (!!file.path || (isMediaKind(file.kind) && !!file.inlineData));
  const canUsePath = !expired && !!file.path;
  const canCopyPath = !!file.path;

  const handlePreview = () => {
    if (!canPreview) return;
    if (isMediaKind(file.kind)) {
      openMediaViewerForRef(file, { origin: 'session', sessionPath: sessionPath ?? undefined });
      return;
    }
    if (!file.path) return;
    void openFilePreview(file.path, file.name, ext, {
      origin: 'session',
      sessionPath: sessionPath ?? undefined,
      messageId: file.sessionMessageId,
      blockIdx: file.sessionBlockIdx,
    });
  };

  const handleOpen = () => {
    if (!canUsePath) return;
    window.platform?.openFile?.(file.path);
  };

  const handleReveal = () => {
    if (!canUsePath) return;
    window.platform?.showInFinder?.(file.path);
  };

  const handleCopyPath = () => {
    if (!canCopyPath) return;
    navigator.clipboard.writeText(file.path).catch(() => {});
  };

  return (
    <article className={styles.fileRow}>
      <div className={styles.fileIcon} aria-hidden="true">
        {formatKind(file).slice(0, 3)}
      </div>
      <div className={styles.fileMain}>
        <div className={styles.fileName} title={file.name}>{file.name}</div>
        <div className={styles.fileMeta}>
          <span>{sourceLabel(file)}</span>
          <span>{formatKind(file)}</span>
          <span>{statusLabel(file)}</span>
        </div>
      </div>
      <div className={styles.fileActions}>
        <button
          type="button"
          className={styles.fileAction}
          aria-label={actionLabel('rightWorkspace.sessionFiles.actions.preview', file)}
          title={actionLabel('rightWorkspace.sessionFiles.actions.preview', file)}
          disabled={!canPreview}
          onClick={handlePreview}
        >
          <ActionIcon type="preview" />
        </button>
        <button
          type="button"
          className={styles.fileAction}
          aria-label={actionLabel('rightWorkspace.sessionFiles.actions.open', file)}
          title={actionLabel('rightWorkspace.sessionFiles.actions.open', file)}
          disabled={!canUsePath}
          onClick={handleOpen}
        >
          <ActionIcon type="open" />
        </button>
        <button
          type="button"
          className={styles.fileAction}
          aria-label={actionLabel('rightWorkspace.sessionFiles.actions.reveal', file)}
          title={actionLabel('rightWorkspace.sessionFiles.actions.reveal', file)}
          disabled={!canUsePath}
          onClick={handleReveal}
        >
          <ActionIcon type="reveal" />
        </button>
        <button
          type="button"
          className={styles.fileAction}
          aria-label={actionLabel('rightWorkspace.sessionFiles.actions.copyPath', file)}
          title={actionLabel('rightWorkspace.sessionFiles.actions.copyPath', file)}
          disabled={!canCopyPath}
          onClick={handleCopyPath}
        >
          <ActionIcon type="copy" />
        </button>
      </div>
    </article>
  );
}

export function SessionRegistryFilesPanel() {
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const files = useStore(s => (
    s.currentSessionPath ? selectSessionFiles(s, s.currentSessionPath) : EMPTY_FILES
  ));
  const sortedFiles = useMemo(() => (
    [...files].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
  ), [files]);
  const t = window.t ?? ((p: string) => p);

  return (
    <section className={styles.sessionFilesPanel} aria-label={t('rightWorkspace.tabs.sessionFiles')}>
      {sortedFiles.length === 0 ? (
        <div className={styles.emptyState}>{t('rightWorkspace.sessionFiles.empty')}</div>
      ) : (
        <div className={styles.fileList}>
          {sortedFiles.map(file => (
            <SessionFileRow key={file.id} file={file} sessionPath={currentSessionPath} />
          ))}
        </div>
      )}
    </section>
  );
}
