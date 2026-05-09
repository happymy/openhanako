/**
 * channel-actions.ts — Channel 副作用操作（网络请求 + 状态联动）
 *
 * 从 channel-slice.ts 提取，所有函数通过 useStore.getState() / useStore.setState() 访问 store。
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- API 响应 JSON 及 catch(err: any) */

import { useStore } from './index';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { hasServerConnection } from '../services/server-connection';
import type { Channel, ChannelMessage } from '../types';

// ══════════════════════════════════════════════════════
// 加载频道列表
// ══════════════════════════════════════════════════════

export async function loadChannels(): Promise<void> {
  const s = useStore.getState();
  if (!hasServerConnection(s)) return;
  try {
    const [chRes, dmRes] = await Promise.all([
      hanaFetch('/api/channels'),
      hanaFetch('/api/dm'),
    ]);

    const chData = chRes.ok ? await chRes.json() : { channels: [] };
    const dmData = dmRes.ok ? await dmRes.json() : { dms: [] };

    const channels: Channel[] = (chData.channels || []).map((ch: any) => ({
      ...ch,
      isDM: false,
    }));

    const dms: Channel[] = (dmData.dms || []).map((dm: any) => ({
      id: `dm:${dm.peerId}`,
      name: dm.peerName || dm.peerId,
      members: [dm.peerId],
      lastMessage: dm.lastMessage || '',
      lastSender: dm.lastSender || '',
      lastTimestamp: dm.lastTimestamp || '',
      newMessageCount: 0,
      messageCount: dm.messageCount || 0,
      isDM: true,
      peerId: dm.peerId,
      peerName: dm.peerName,
    }));

    const allChannels = [...channels, ...dms];
    const totalUnread = allChannels.reduce((sum, ch) => sum + (ch.newMessageCount || 0), 0);
    useStore.setState({ channels: allChannels, channelTotalUnread: totalUnread });
  } catch (err) {
    console.error('[channels] load failed:', err);
  }
}

// ══════════════════════════════════════════════════════
// 打开频道
// ══════════════════════════════════════════════════════

export async function openChannel(channelId: string, isDM?: boolean): Promise<void> {
  const s = useStore.getState();
  const ch = s.channels.find((c: Channel) => c.id === channelId);
  const isThisDM = isDM ?? ch?.isDM ?? false;
  const t = window.t;

  // 立刻切换 + 清空旧数据，防止残留上一个频道的内容
  // DM 时从 channel 列表提取 peerId，即使 API 失败也能显示 agent 信息
  const peerId = isThisDM ? (ch?.peerId || channelId.replace('dm:', '')) : '';
  const peerName = isThisDM ? (ch?.name || peerId) : '';
  useStore.setState({
    currentChannel: channelId,
    channelMessages: [],
    channelMembers: isThisDM ? [peerId] : [],
    channelHeaderName: isThisDM ? peerName : '',
    channelHeaderMembersText: '',
    channelIsDM: isThisDM,
    channelInfoName: isThisDM ? peerName : '',
  });

  try {
    if (isThisDM) {
      const res = await hanaFetch(`/api/dm/${encodeURIComponent(peerId)}`);
      if (res.ok) {
        const data = await res.json();
        useStore.setState({
          channelMessages: data.messages || [],
          channelHeaderName: data.peerName || peerName,
          channelInfoName: data.peerName || peerName,
        });
      }
      // 404 = 没有历史，基本信息已在上方设置，不需要额外处理
    } else {
      const res = await hanaFetch(`/api/channels/${encodeURIComponent(channelId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const members = data.members || [];
      const displayMembers = [useStore.getState().userName || 'user', ...members];
      useStore.setState({
        channelMessages: data.messages || [],
        channelMembers: members,
        channelHeaderName: `# ${data.name || channelId}`,
        channelHeaderMembersText: `${displayMembers.length} ${t('channel.membersCount')}`,
        channelIsDM: false,
        channelInfoName: data.name || channelId,
      });

      // Mark as read
      const msgs = data.messages || [];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg) {
        hanaFetch(`/api/channels/${encodeURIComponent(channelId)}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timestamp: lastMsg.timestamp }),
        }).catch((err: unknown) => console.warn('[channel-actions] mark-as-read failed', err));

        // 重新取 store 最新状态，避免覆盖 await 期间的并发更新
        const fresh = useStore.getState();
        const freshCh = fresh.channels.find((c: Channel) => c.id === channelId);
        if (freshCh) {
          const newTotal = Math.max(0, fresh.channelTotalUnread - (freshCh.newMessageCount || 0));
          const updatedChannels = fresh.channels.map((c: Channel) =>
            c.id === channelId ? { ...c, newMessageCount: 0 } : c,
          );
          useStore.setState({ channelTotalUnread: newTotal, channels: updatedChannels });
        }
      }
    }
  } catch (err) {
    console.error('[channels] open failed:', err);
  }
}

function sameChannelMessage(a: ChannelMessage, b: ChannelMessage): boolean {
  return a.sender === b.sender && a.timestamp === b.timestamp && a.body === b.body;
}

function sortChannelsByRecent(channels: Channel[]): Channel[] {
  return [...channels].sort((a, b) =>
    (b.lastTimestamp || '').localeCompare(a.lastTimestamp || ''),
  );
}

// ══════════════════════════════════════════════════════
// 增量追加频道消息
// ══════════════════════════════════════════════════════

export function appendChannelMessage(channelId: string, message: ChannelMessage): void {
  if (
    !channelId
    || typeof message?.sender !== 'string'
    || typeof message.timestamp !== 'string'
    || typeof message.body !== 'string'
  ) return;

  const state = useStore.getState();
  const isCurrentChannel = state.currentChannel === channelId;
  const alreadyInCurrent = isCurrentChannel
    ? state.channelMessages.some((m: ChannelMessage) => sameChannelMessage(m, message))
    : false;

  let unreadDelta = 0;
  let readDelta = 0;
  const updatedChannels = state.channels.map((channel: Channel) => {
    if (channel.id !== channelId) return channel;

    const isDuplicatePreview =
      channel.lastSender === message.sender
      && channel.lastTimestamp === message.timestamp
      && channel.lastMessage === message.body.slice(0, 60);

    const previousUnread = channel.newMessageCount || 0;
    const nextUnread = isCurrentChannel
      ? 0
      : previousUnread + (isDuplicatePreview ? 0 : 1);

    if (isCurrentChannel) {
      readDelta = previousUnread;
    } else {
      unreadDelta += nextUnread - previousUnread;
    }

    return {
      ...channel,
      lastMessage: message.body.slice(0, 60),
      lastSender: message.sender,
      lastTimestamp: message.timestamp,
      messageCount: (channel.messageCount || 0) + (isDuplicatePreview ? 0 : 1),
      newMessageCount: nextUnread,
    };
  });

  const patch: Partial<ReturnType<typeof useStore.getState>> = {
    channels: sortChannelsByRecent(updatedChannels),
    channelTotalUnread: Math.max(0, state.channelTotalUnread + unreadDelta - readDelta),
  };

  if (isCurrentChannel && !alreadyInCurrent) {
    patch.channelMessages = [...state.channelMessages, message];
  }

  useStore.setState(patch);

  if (isCurrentChannel) {
    Promise.resolve(hanaFetch(`/api/channels/${encodeURIComponent(channelId)}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: message.timestamp }),
    })).catch((err: unknown) => console.warn('[channel-actions] mark-as-read failed', err));
  }
}

// ══════════════════════════════════════════════════════
// 发送消息
// ══════════════════════════════════════════════════════

export async function sendChannelMessage(text: string): Promise<void> {
  const s = useStore.getState();
  if (!text.trim() || !s.currentChannel) return;

  try {
    const res = await hanaFetch(`/api/channels/${encodeURIComponent(s.currentChannel)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.ok && data.timestamp) {
      // 重新取最新消息列表，避免覆盖 await 期间的并发更新
      const fresh = useStore.getState();
      useStore.setState({
        channelMessages: [...fresh.channelMessages, {
          sender: fresh.userName || 'user',
          timestamp: data.timestamp,
          body: text,
        }],
      });
    }
  } catch (err) {
    console.error('[channels] send failed:', err);
  }
}

// ══════════════════════════════════════════════════════
// 删除频道
// ══════════════════════════════════════════════════════

export async function deleteChannel(channelId: string): Promise<void> {
  const s = useStore.getState();
  try {
    const res = await hanaFetch(`/api/channels/${encodeURIComponent(channelId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.ok) {
      if (s.currentChannel === channelId) {
        useStore.setState({
          currentChannel: null,
          channelMessages: [],
          channelHeaderName: '',
          channelHeaderMembersText: '',
          channelIsDM: false,
        });
      }
      // Reload channels
      await loadChannels();
    } else {
      console.error('[channels] delete failed:', data.error);
    }
  } catch (err) {
    console.error('[channels] delete failed:', err);
  }
}

// ══════════════════════════════════════════════════════
// 切换频道功能开关
// ══════════════════════════════════════════════════════

export async function toggleChannelsEnabled(): Promise<boolean> {
  const s = useStore.getState();
  const newEnabled = !s.channelsEnabled;
  useStore.setState({ channelsEnabled: newEnabled });

  if (newEnabled) {
    await loadChannels();
  }

  try {
    await hanaFetch('/api/channels/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newEnabled }),
    });
  } catch (err) {
    console.error('[channels] toggle backend failed:', err);
  }

  return newEnabled;
}

// ══════════════════════════════════════════════════════
// 创建频道
// ══════════════════════════════════════════════════════

export async function createChannel(name: string, members: string[], intro?: string): Promise<string | null> {
  try {
    const res = await hanaFetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        members,
        intro: intro || undefined,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    await loadChannels();
    if (data.id) {
      await openChannel(data.id);
    }
    return data.id || null;
  } catch (err: any) {
    console.error('[channels] create failed:', err);
    throw err;
  }
}
