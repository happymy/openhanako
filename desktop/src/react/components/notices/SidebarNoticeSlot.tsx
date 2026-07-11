import { useEffect, useMemo, useState } from 'react';
import { useTrainUpdateState } from '../../hooks/use-train-update-state';
import type { TrainUpdatePhase, TrainUpdateProgressState } from '../../hooks/use-train-update-state';
import styles from './SidebarNoticeSlot.module.css';

/**
 * 左下角更新贴纸默认使用“内容更新”语境；壳更新只在
 * `minShellBlocked`（不更新壳收不到新列车）时才占用这张卡片。壳更新器
 * 自己下载好了这件事本身不再触发卡片——那安静躺在设置页，不来打扰这里。
 * 两种触发态互斥：`minShellBlocked` 为真时切到"需更新应用本体"形态
 * （点击走既有 autoUpdateInstall 流程，这是唯一允许从这张卡片走壳安装的
 * 情形），否则只要 `available` 非空就是默认的列车形态（点击 = applyNow，
 * 下载→验签→激活→重载一条龙，进行中的阶段/进度直接显示在卡面上）。
 *
 * 两种触发态的叉号语义不同：
 * - blocked（需更新应用本体）= "本 session 安静，下次启动重新出现" ——
 *   用组件内存状态（不落 localStorage），进程重启即天然重置。
 * - train（默认热更新）= 沿用既有 dismissed-key 机制（按 "version:X" 存
 *   localStorage），出现新版本自然重新弹出。
 */
const DISMISSED_TRAIN_UPDATE_KEY = 'hana-sidebar-train-update-dismissed-key';

type NoticeStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface SidebarUpdateNoticeCardProps {
  available: { version: string } | null;
  minShellBlocked: boolean;
  phase: TrainUpdatePhase;
  progress: TrainUpdateProgressState | null;
  onInstallShell?: () => void | Promise<unknown>;
  onApplyTrain?: () => void | Promise<unknown>;
  storage?: NoticeStorage | null;
}

const tr = (key: string, vars?: Record<string, string | number>) => window.t?.(key, vars) ?? key;

function safeStorage(): NoticeStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readDismissedKey(storage: NoticeStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeDismissedKey(storage: NoticeStorage | null, storageKey: string, value: string): void {
  try {
    storage?.setItem(storageKey, value);
  } catch {
    // Ignore storage failures; the in-memory dismissed state still hides the card for this mount.
  }
}

function trainNoticeKey(available: { version: string } | null): string | null {
  return available ? `version:${available.version}` : null;
}

function percentOf(progress: TrainUpdateProgressState | null): number {
  if (!progress || !progress.totalBytes) return 0;
  return Math.max(0, Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100)));
}

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

interface StickerContent {
  kind: 'blocked' | 'train';
  title: string;
  /** 内容版本号小字：显示已激活内容版本，不显示壳版本或 train 号。 */
  subtitle: string | null;
}

/**
 * 两态选择，minShellBlocked 优先：这是唯一"壳"相关的触发源，不再看
 * 壳自动更新器自己的 'downloaded' 状态。纯函数，独立可测。
 */
function resolveStickerContent({
  available,
  minShellBlocked,
  phase,
  progress,
}: Pick<SidebarUpdateNoticeCardProps, 'available' | 'minShellBlocked' | 'phase' | 'progress'>): StickerContent | null {
  if (minShellBlocked) {
    return {
      kind: 'blocked',
      title: tr('settings.about.shellStickerTitleBlocking'),
      subtitle: available ? `v${available.version}` : null,
    };
  }
  if (!available) return null;
  if (phase === 'downloading') {
    return {
      kind: 'train',
      title: tr('settings.about.trainStickerDownloading', { percent: percentOf(progress) }),
      subtitle: `v${available.version}`,
    };
  }
  if (phase === 'applying') {
    return {
      kind: 'train',
      title: tr('settings.about.trainStickerApplying'),
      subtitle: `v${available.version}`,
    };
  }
  return {
    kind: 'train',
    title: tr('settings.about.trainStickerTitle'),
    subtitle: `v${available.version}`,
  };
}

export function SidebarUpdateNoticeCard({
  available,
  minShellBlocked,
  phase,
  progress,
  onInstallShell,
  onApplyTrain,
  storage,
}: SidebarUpdateNoticeCardProps) {
  const resolvedStorage = storage === undefined ? safeStorage() : storage;

  // blocked 形态的叉号状态只活在组件内存里（不落 localStorage）：进程
  // 重启 = 组件重新挂载 = 天然重置为"未叉过"，这正是"下次启动重新出现"的实现。
  const [blockedDismissed, setBlockedDismissed] = useState(false);

  const trainKey = trainNoticeKey(available);
  const [trainDismissedKey, setTrainDismissedKey] = useState<string | null>(
    () => readDismissedKey(resolvedStorage, DISMISSED_TRAIN_UPDATE_KEY),
  );
  useEffect(() => {
    setTrainDismissedKey(readDismissedKey(resolvedStorage, DISMISSED_TRAIN_UPDATE_KEY));
  }, [trainKey, resolvedStorage]);

  const content = useMemo(
    () => resolveStickerContent({ available, minShellBlocked, phase, progress }),
    [available, minShellBlocked, phase, progress],
  );

  if (!content) return null;
  if (content.kind === 'blocked' && blockedDismissed) return null;
  if (content.kind === 'train' && trainKey && trainDismissedKey === trainKey) return null;

  const dismiss = () => {
    if (content.kind === 'blocked') {
      setBlockedDismissed(true);
      return;
    }
    if (trainKey) {
      writeDismissedKey(resolvedStorage, DISMISSED_TRAIN_UPDATE_KEY, trainKey);
      setTrainDismissedKey(trainKey);
    }
  };

  const handleAction = () => {
    if (content.kind === 'blocked') {
      void onInstallShell?.();
    } else {
      void onApplyTrain?.();
    }
  };

  return (
    <div className={styles.slot}>
      <section className={styles.card} role="status" aria-live="polite">
        <button type="button" className={styles.cardButton} onClick={handleAction}>
          <span className={styles.textBlock}>
            <span className={styles.title}>{content.title}</span>
            {content.subtitle && <span className={styles.subtitle}>{content.subtitle}</span>}
          </span>
          <span className={styles.refreshIcon}>
            <RefreshIcon />
          </span>
        </button>
        <button type="button" className={styles.closeButton} aria-label={tr('window.close')} onClick={dismiss}>
          <CloseIcon />
        </button>
      </section>
    </div>
  );
}

export function SidebarNoticeSlot() {
  const { available, minShellBlocked, phase, progress, applyNow } = useTrainUpdateState();

  return (
    <SidebarUpdateNoticeCard
      available={available}
      minShellBlocked={minShellBlocked}
      phase={phase}
      progress={progress}
      onInstallShell={() => window.hana?.autoUpdateInstall?.()}
      onApplyTrain={() => applyNow()}
    />
  );
}
