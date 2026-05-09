/** ChannelsPanel — 频道系统入口 + 保留组件（子组件在 ./channels/） */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../stores';
import { fetchConfig } from '../hooks/use-config';
import { useI18n } from '../hooks/use-i18n';
import { renderMarkdown } from '../utils/markdown';
import { MarkdownContent } from './chat/MarkdownContent';
import { loadChannels, sendChannelMessage } from '../stores/channel-actions';
import { resolveChannelMember, buildAgentMap, formatChannelTime, MemberAvatar } from './channels/ChannelList';
import type { MemberInfo } from './channels/ChannelList';
import styles from './channels/Channels.module.css';

/* eslint-disable @typescript-eslint/no-explicit-any -- isComposing 等 nativeEvent 字段需 as any */

const CHANNEL_SCROLL_THRESHOLD = 80;

export function ChannelsPanel() {
  const currentTab = useStore(s => s.currentTab);
  const channelsEnabled = useStore(s => s.channelsEnabled);
  const channels = useStore(s => s.channels);
  const activeServerConnection = useStore(s => s.activeServerConnection);

  // 启动时从后端读频道开关状态；开启时加载频道列表
  useEffect(() => {
    if (!activeServerConnection) return;
    fetchConfig().then(cfg => {
      // 默认关：只有显式 true 才算启用
      const enabled = cfg?.channels?.enabled === true;
      useStore.getState().setChannelsEnabled(enabled);
      if (enabled) loadChannels();
    }).catch(err => console.warn('[channels] init failed:', err));
  }, [activeServerConnection]);

  // 开关变化后加载频道列表
  useEffect(() => {
    if (channelsEnabled && activeServerConnection) loadChannels();
  }, [channelsEnabled, activeServerConnection]);

  return null;
}

// ── ChannelMessages — 消息列表

export function ChannelMessages() {
  const { t } = useI18n();
  const messages = useStore(s => s.channelMessages);
  const currentChannel = useStore(s => s.currentChannel);
  const channels = useStore(s => s.channels);
  const agents = useStore(s => s.agents);
  const userName = useStore(s => s.userName);
  const userAvatarUrl = useStore(s => s.userAvatarUrl);
  const currentAgentId = useStore(s => s.currentAgentId);
  const agentMap = useMemo(() => buildAgentMap(agents), [agents]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const previousChannelRef = useRef<string | null>(null);
  const previousLengthRef = useRef(0);
  const [showNewMessages, setShowNewMessages] = useState(false);

  const getScrollContainer = useCallback(() => (
    wrapperRef.current?.closest('.channel-messages') as HTMLElement | null
  ), []);

  const checkNearBottom = useCallback(() => {
    const el = getScrollContainer();
    if (!el) return true;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= CHANNEL_SCROLL_THRESHOLD;
    isNearBottomRef.current = near;
    if (near) setShowNewMessages(false);
    return near;
  }, [getScrollContainer]);

  const scrollToBottom = useCallback(() => {
    const el = getScrollContainer();
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isNearBottomRef.current = true;
    setShowNewMessages(false);
  }, [getScrollContainer]);

  useEffect(() => {
    isNearBottomRef.current = true;
    previousChannelRef.current = null;
    previousLengthRef.current = 0;
    setShowNewMessages(false);
  }, [currentChannel]);

  useEffect(() => {
    const el = getScrollContainer();
    if (!el) return;
    const onScroll = () => { checkNearBottom(); };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [checkNearBottom, getScrollContainer, messages.length]);

  useEffect(() => {
    const el = getScrollContainer();
    const channelChanged = previousChannelRef.current !== currentChannel;
    const previousLength = previousLengthRef.current;
    const grew = messages.length > previousLength;

    if (el && messages.length > 0) {
      if (channelChanged || previousLength === 0) {
        scrollToBottom();
      } else if (grew) {
        const nearNow = el.scrollHeight - el.scrollTop - el.clientHeight <= CHANNEL_SCROLL_THRESHOLD;
        if (isNearBottomRef.current || nearNow) {
          scrollToBottom();
        } else {
          setShowNewMessages(true);
        }
      }
    }

    previousChannelRef.current = currentChannel;
    previousLengthRef.current = messages.length;
  }, [currentChannel, getScrollContainer, messages.length, scrollToBottom]);

  if (!currentChannel || messages.length === 0) {
    return <div className={styles.channelWelcome}>{t('channel.noMessages')}</div>;
  }

  const ch = channels.find((c) => c.id === currentChannel);
  const isDM = ch?.isDM ?? false;
  let lastSender: string | null = null;

  return (
    <>
      <div ref={wrapperRef}>
        {messages.map((msg, idx) => {
          const isContinuation = msg.sender === lastSender;
          const senderInfo = resolveChannelMember(msg.sender, userName, userAvatarUrl, agents, currentAgentId, agentMap);
          const isSelf = senderInfo.isUser || (isDM && msg.sender === (currentAgentId || ''));
          const el = (
            <div
              key={`${msg.timestamp}-${msg.sender}-${idx}`}
              className={
                styles.channelMsg
                + (isContinuation ? ` ${styles.channelMsgContinuation}` : '')
                + (isSelf ? ` ${styles.channelMsgSelf}` : '')
              }
            >
              <div className={styles.channelMsgAvatar}>
                <MemberAvatar info={senderInfo} className={styles.channelMsgAvatarImg} />
              </div>
              <div className={styles.channelMsgBody}>
                {!isContinuation && (
                  <div className={styles.channelMsgHeader}>
                    <span className={styles.channelMsgSender}>{senderInfo.displayName}</span>
                    <span className={styles.channelMsgTime}>{formatChannelTime(msg.timestamp)}</span>
                  </div>
                )}
                <MarkdownContent
                  className={styles.channelMsgText}
                  html={renderMarkdown(msg.body || '')}
                />
              </div>
            </div>
          );
          lastSender = msg.sender;
          return el;
        })}
      </div>
      {showNewMessages && (
        <button
          type="button"
          className={styles.channelNewMessagesBtn}
          onClick={scrollToBottom}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="m19 12-7 7-7-7" />
          </svg>
          <span>{t('channel.newMessages')}</span>
        </button>
      )}
    </>
  );
}

// ── ChannelMembers — 右侧面板成员列表

function MemberItem({ info }: { info: MemberInfo }) {
  return (
    <div className={styles.channelMemberItem}>
      {info.avatarUrl
        ? <MemberAvatar info={info} className={styles.channelMemberAvatarImg} />
        : <div className={styles.channelMemberAvatar}>{(info.displayName || '?').charAt(0).toUpperCase()}</div>}
      <div className={styles.channelMemberName}>{info.displayName}</div>
    </div>
  );
}

export function ChannelMembers() {
  const currentChannel = useStore(s => s.currentChannel);
  const channelMembers = useStore(s => s.channelMembers);
  const isDM = useStore(s => s.channelIsDM);
  const agents = useStore(s => s.agents);
  const userName = useStore(s => s.userName);
  const userAvatarUrl = useStore(s => s.userAvatarUrl);
  const currentAgentId = useStore(s => s.currentAgentId);

  const agentMap = useMemo(() => buildAgentMap(agents), [agents]);

  if (!currentChannel) return null;

  const resolve = (id: string) => resolveChannelMember(id, userName, userAvatarUrl, agents, currentAgentId, agentMap);

  if (isDM) {
    const peerInfo = resolve(channelMembers[0] || '');
    const selfInfo = resolve(currentAgentId || '');
    return <>{[peerInfo, selfInfo].map(i => <MemberItem key={i.id} info={i} />)}</>;
  }

  return (
    <>
      {[userName || 'user', ...channelMembers].map((m, idx) => (
        <MemberItem key={`${m}-${idx}`} info={resolve(m)} />
      ))}
    </>
  );
}

// ── ChannelInput — 输入区域 + @mention

export function ChannelInput() {
  const currentChannel = useStore(s => s.currentChannel);
  const isDM = useStore(s => s.channelIsDM);
  const channelMembers = useStore(s => s.channelMembers);
  const agents = useStore(s => s.agents);
  const userName = useStore(s => s.userName);
  const userAvatarUrl = useStore(s => s.userAvatarUrl);
  const currentAgentId = useStore(s => s.currentAgentId);

  const agentMap = useMemo(() => buildAgentMap(agents), [agents]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionItems, setMentionItems] = useState<MemberInfo[]>([]);
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(-1);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    if (sending || !inputValue.trim()) return;
    setSending(true);
    try { await sendChannelMessage(inputValue.trim()); setInputValue(''); }
    finally { setSending(false); }
  }, [sending, inputValue]);

  const checkMention = useCallback(() => {
    if (!inputRef.current) return;
    const val = inputRef.current.value;
    const pos = inputRef.current.selectionStart ?? 0;
    const before = val.slice(0, pos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0 || (atIdx > 0 && /\S/.test(before[atIdx - 1]))) { setMentionActive(false); return; }
    const keyword = before.slice(atIdx + 1).toLowerCase();
    setMentionStartPos(atIdx);
    const members = (channelMembers || [])
      .map(id => resolveChannelMember(id, userName, userAvatarUrl, agents, currentAgentId, agentMap))
      .filter(m => !m.isUser);
    const filtered = keyword
      ? members.filter(m => m.displayName.toLowerCase().includes(keyword) || (m.yuan || '').toLowerCase().includes(keyword))
      : members;
    if (filtered.length === 0) { setMentionActive(false); return; }
    setMentionItems(filtered);
    setMentionSelectedIdx(0);
    setMentionActive(true);
  }, [channelMembers, agents, agentMap, userName, userAvatarUrl, currentAgentId]);

  const insertMention = useCallback((name: string) => {
    if (!inputRef.current || mentionStartPos < 0) return;
    const val = inputRef.current.value;
    const pos = inputRef.current.selectionStart ?? 0;
    const before = val.slice(0, mentionStartPos);
    const inserted = `@${name} `;
    setInputValue(before + inserted + val.slice(pos));
    setMentionActive(false);
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      const c = before.length + inserted.length;
      inputRef.current.setSelectionRange(c, c);
      inputRef.current.focus();
    });
  }, [mentionStartPos]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing) {
      e.preventDefault();
      if (mentionActive) { const s = mentionItems[mentionSelectedIdx]; if (s) insertMention(s.displayName); }
      else handleSend();
      return;
    }
    if (!mentionActive) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionSelectedIdx(i => (i + 1) % mentionItems.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setMentionSelectedIdx(i => (i - 1 + mentionItems.length) % mentionItems.length); }
    if (e.key === 'Escape') { e.preventDefault(); setMentionActive(false); }
  }, [mentionActive, mentionItems, mentionSelectedIdx, insertMention, handleSend]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    requestAnimationFrame(() => checkMention());
  }, [checkMention]);

  if (isDM || !currentChannel) return null;

  return (
    <div className={styles.channelInputWrapper}>
      {mentionActive && mentionItems.length > 0 && (
        <div className={styles.channelMentionDropdown}>
          {mentionItems.map((m) => (
            <div
              key={m.id}
              className={`${styles.channelMentionItem}${mentionItems.indexOf(m) === mentionSelectedIdx ? ` ${styles.channelMentionItemActive}` : ''}`}
              data-name={m.displayName}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(m.displayName);
              }}
            >
              <div className={styles.channelMentionAvatar}>
                <MemberAvatar info={m} />
              </div>
              <span>{m.displayName}</span>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        className={styles.channelInputBox}
        placeholder={window.t?.('channel.inputPlaceholder') || 'Send a message...'}
        rows={1}
        spellCheck={false}
        value={inputValue}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
      />
      <button
        className={styles.channelSendBtn}
        disabled={!inputValue.trim() || sending}
        onClick={handleSend}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </div>
  );
}

// ── ChannelReadonly

export function ChannelReadonly() {
  const isDM = useStore(s => s.channelIsDM);
  const currentChannel = useStore(s => s.currentChannel);

  if (!isDM || !currentChannel) return null;

  return (
    <span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 4 }}>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      {window.t?.('channel.readOnly') || '这是 Agent 之间的私信，仅可查看'}
    </span>
  );
}
