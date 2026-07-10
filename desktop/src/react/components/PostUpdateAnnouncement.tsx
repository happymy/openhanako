/**
 * 升级后首启公告：主进程在打包环境下检测到版本变化时，首次启动返回
 * pending 公告（当前版本 + 随包 release digest），用户确认后写回
 * last-seen-version，不再弹。组件一次性：挂载时查询，确认即关闭。
 */
import { useEffect, useState } from 'react';
import type { ReleaseDigest } from '../types';
import { NoticeDialog } from '../ui';
import { useI18n } from '../hooks/use-i18n';
import { digestLocale, digestText, kindLabel } from './shared/release-digest-text';
import styles from './AutoUpdateStatus.module.css';

interface PendingAnnouncement {
  version: string;
  digest: ReleaseDigest | null;
}

export function PostUpdateAnnouncement() {
  const { t } = useI18n();
  const [announcement, setAnnouncement] = useState<PendingAnnouncement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.hana?.getPendingAnnouncement?.().then((pending) => {
      if (cancelled || !pending) return;
      setAnnouncement(pending);
      setOpen(true);
    });
    return () => { cancelled = true; };
  }, []);

  if (!announcement) return null;

  const { version, digest } = announcement;
  const locale = digestLocale();

  const handleConfirm = () => {
    setOpen(false);
    void window.hana?.ackAnnouncement?.();
  };

  return (
    <NoticeDialog
      open={open}
      scope="window"
      title={t('announcement.title', { version })}
      confirmLabel={t('announcement.confirm')}
      onConfirm={handleConfirm}
    >
      {digest ? (
        <>
          <p>{digestText(digest.summary, locale)}</p>
          <div className={styles.digestList}>
            {digest.items.map((item, index) => (
              <article key={item.id || `${item.kind}-${index}`} className={styles.digestItem}>
                <div className={styles.digestItemMeta}>
                  <span className={styles.digestKind}>{kindLabel(item.kind)}</span>
                </div>
                <h3 className={styles.digestItemTitle}>{digestText(item.title, locale)}</h3>
                <p className={styles.digestItemSummary}>{digestText(item.summary, locale)}</p>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p>{t('announcement.fallbackBody', { version })}</p>
      )}
    </NoticeDialog>
  );
}
