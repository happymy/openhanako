import { useRef, useEffect, useState } from 'react';
import { hanaUrl } from '../../hooks/use-hana-fetch';
import type { PluginCardDetails } from '../../types';
import s from './PluginCardBlock.module.css';

interface Props { card: PluginCardDetails; }

export function PluginCardBlock({ card }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  const src = (() => {
    const theme = document.documentElement.dataset.theme || 'warm-paper';
    const cssUrl = hanaUrl(`/api/plugins/theme.css?theme=${encodeURIComponent(theme)}`);
    const base = hanaUrl(`/api/plugins/${card.pluginId}${card.route}`);
    const params = new URLSearchParams();
    if (card.data) params.set('data', JSON.stringify(card.data));
    params.set('hana-theme', theme);
    params.set('hana-css', cssUrl);
    return `${base}?${params}`;
  })();

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'ready') setReady(true);
      if (e.data?.type === 'resize-request' && typeof e.data.payload?.height === 'number') {
        const h = Math.max(100, Math.min(e.data.payload.height, 600));
        if (iframeRef.current) iframeRef.current.style.height = `${h}px`;
      }
    };
    window.addEventListener('message', onMessage);
    const timeout = setTimeout(() => setReady(true), 5000);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(timeout); };
  }, []);

  const height = Math.max(100, Math.min(card.height || 200, 600));

  // V1: only handle iframe type. Future types (inline, etc.) fall through to nothing.
  if (card.type && card.type !== 'iframe') return null;

  return (
    <div className={s.container}>
      {card.title && <div className={s.title}>{card.title}</div>}
      <iframe
        ref={iframeRef}
        className={s.iframe}
        src={src}
        sandbox="allow-scripts"
        style={{ height: `${height}px`, opacity: ready ? 1 : 0.3 }}
      />
    </div>
  );
}
