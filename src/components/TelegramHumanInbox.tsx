import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type Person = { id: string; full_name: string | null; email: string | null; role: string; active: boolean };
type Profile = Person | null;
type InboxChat = { chat_id: number; title: string; username: string | null; last_message_id: number; last_message_at: string | null; last_synced_at: string | null; read_outbox_max_id: number };
type InboxMessage = { chat_id: number; message_id: number; sender_id: number | null; outgoing: boolean; message_text: string; sent_at: string; reply_to_message_id: number | null; media_path: string | null; media_name: string | null; media_mime_type: string | null; media_size: number | null };
type PendingReply = { id: string; chat_id: number; message_text: string; created_at: string };
type InboxAssignment = { chat_id: number; profile_id: string; assigned_by: string | null; assigned_at: string };

const panel: CSSProperties = { padding: 0, margin: '8px 0 18px', background: 'transparent' };
const muted: CSSProperties = { color: '#b7c0d1', fontSize: 13 };
const control: CSSProperties = { padding: '8px 10px', border: '1px solid #343741', borderRadius: 7, color: '#f2f3f7', background: '#15161a', maxWidth: '100%' };
const action: CSSProperties = { ...control, border: 0, background: '#24252b', color: '#f2f3f7', fontWeight: 650, cursor: 'pointer' };

export default function TelegramHumanInbox({ supabase, profile, profiles }: {
  supabase: SupabaseClient | null;
  profile: Profile;
  profiles: Person[];
}) {
  const [chats, setChats] = useState<InboxChat[]>([]);
  const chatsRef = useRef<InboxChat[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const preserveScrollRef = useRef<{ height: number; top: number } | null>(null);
  const olderCacheTimerRef = useRef<number | null>(null);
  const [pendingReplies, setPendingReplies] = useState<PendingReply[]>([]);
  const [assignments, setAssignments] = useState<InboxAssignment[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncRequestedAt, setSyncRequestedAt] = useState<number | null>(null);
  const [selectedChat, setSelectedChat] = useState('');
  const [assignee, setAssignee] = useState('');
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const isAdmin = profile?.active === true && profile.role.toLowerCase() === 'admin';

  const refreshChats = useCallback(async () => {
    if (!supabase || !profile?.active) return;
    setLoading(true);
    setNotice('');
    const [chatResult, assignmentResult] = await Promise.all([
      supabase.from('telegram_inbox_chats').select('chat_id,title,username,last_message_id,last_message_at,last_synced_at,read_outbox_max_id').order('last_message_at', { ascending: false }).limit(300),
      supabase.from('telegram_inbox_chat_assignments').select('chat_id,profile_id,assigned_by,assigned_at'),
    ]);
    if (chatResult.error) {
      setNotice('Could not load the human-account inbox. Apply the Telegram inbox migration in Supabase first. Details: ' + chatResult.error.message);
      setChats([]);
    } else {
      const rows = (chatResult.data ?? []) as InboxChat[];
      const previousById = new Map(chatsRef.current.map(chat => [chat.chat_id, chat]));
      const incomingCounts: Record<string, number> = {};
      await Promise.all(rows.map(async chat => {
        const previous = previousById.get(chat.chat_id);
        if (!previous || chat.last_message_id <= previous.last_message_id || String(chat.chat_id) === selectedChat) return;
        const { count } = await supabase.from('telegram_inbox_messages').select('message_id', { count: 'exact', head: true })
          .eq('chat_id', chat.chat_id).gt('message_id', previous.last_message_id).eq('outgoing', false);
        if (count && count > 0) incomingCounts[String(chat.chat_id)] = count;
      }));
      if (Object.keys(incomingCounts).length) {
        setUnreadCounts(current => {
          const next = { ...current };
          for (const [chatId, count] of Object.entries(incomingCounts)) next[chatId] = (next[chatId] ?? 0) + count;
          return next;
        });
      }
      chatsRef.current = rows;
      setChats(rows);
      if (!selectedChat && rows.length) setSelectedChat(String(rows[0].chat_id));
    }
    if (assignmentResult.error) setNotice(current => current || 'Could not load inbox assignments: ' + assignmentResult.error.message);
    else setAssignments((assignmentResult.data ?? []) as InboxAssignment[]);
    setLoading(false);
  }, [supabase, profile?.id, profile?.active, selectedChat]);

  const MESSAGE_PAGE_SIZE = 150;

  const refreshConversation = useCallback(async () => {
    if (!supabase || !selectedChat || !profile?.active) {
      setMessages([]);
      setHasMoreMessages(false);
      return;
    }
    const chatId = Number(selectedChat);
    let messageResult: any = await supabase.from('telegram_inbox_messages')
      .select('chat_id,message_id,sender_id,outgoing,message_text,sent_at,reply_to_message_id,media_path,media_name,media_mime_type,media_size')
      .eq('chat_id', chatId).order('message_id', { ascending: false }).limit(MESSAGE_PAGE_SIZE);
    let attachmentSchemaMissing = false;
    if (messageResult.error && /media_path|media_name|media_mime_type|media_size|column.*does not exist|schema cache/i.test(messageResult.error.message)) {
      attachmentSchemaMissing = true;
      messageResult = await supabase.from('telegram_inbox_messages')
        .select('chat_id,message_id,sender_id,outgoing,message_text,sent_at,reply_to_message_id')
        .eq('chat_id', chatId).order('message_id', { ascending: false }).limit(MESSAGE_PAGE_SIZE);
    }
    if (messageResult.error) setNotice('Could not load conversation: ' + messageResult.error.message);
    else {
      const newestFirst = ((messageResult.data ?? []) as InboxMessage[]).map(message => ({
        ...message,
        media_path: attachmentSchemaMissing ? null : message.media_path,
        media_name: attachmentSchemaMissing ? null : message.media_name,
        media_mime_type: attachmentSchemaMissing ? null : message.media_mime_type,
        media_size: attachmentSchemaMissing ? null : message.media_size,
      }));
      const loaded = newestFirst.reverse();
      setHasMoreMessages(loaded.length === MESSAGE_PAGE_SIZE);
      if (attachmentSchemaMissing) setNotice('Text chats are available. Attachment support needs the Telegram media migration applied in Supabase.');
      setMessages(current => {
        const combined = new Map<number, InboxMessage>();
        for (const message of current) if (message.chat_id === chatId) combined.set(message.message_id, message);
        for (const message of loaded) combined.set(message.message_id, message);
        return [...combined.values()].sort((a, b) => a.message_id - b.message_id);
      });
      setPendingReplies(current => current.filter(pending =>
        !loaded.some(message => message.outgoing && message.chat_id === pending.chat_id &&
          message.message_text === pending.message_text && new Date(message.sent_at).getTime() >= new Date(pending.created_at).getTime() - 5000)
      ));
    }
  }, [supabase, selectedChat, profile?.id, profile?.active]);

  const loadOlderMessages = useCallback(async () => {
    if (!supabase || !selectedChat || loadingOlderMessages) return;
    const chatId = Number(selectedChat);
    const container = messagesContainerRef.current;
    if (container) preserveScrollRef.current = { height: container.scrollHeight, top: container.scrollTop };
    const currentChatMessages = messages.filter(message => message.chat_id === chatId);
    const oldestMessageId = currentChatMessages.length
      ? Math.min(...currentChatMessages.map(message => message.message_id))
      : null;
    if (oldestMessageId === null) return;
    setLoadingOlderMessages(true);
    let result: any = await supabase.from('telegram_inbox_messages')
      .select('chat_id,message_id,sender_id,outgoing,message_text,sent_at,reply_to_message_id,media_path,media_name,media_mime_type,media_size')
      .eq('chat_id', chatId).lt('message_id', oldestMessageId)
      .order('message_id', { ascending: false }).limit(MESSAGE_PAGE_SIZE);
    let attachmentSchemaMissing = false;
    if (result.error && /media_path|media_name|media_mime_type|media_size|column.*does not exist|schema cache/i.test(result.error.message)) {
      attachmentSchemaMissing = true;
      result = await supabase.from('telegram_inbox_messages')
        .select('chat_id,message_id,sender_id,outgoing,message_text,sent_at,reply_to_message_id')
        .eq('chat_id', chatId).lt('message_id', oldestMessageId)
        .order('message_id', { ascending: false }).limit(MESSAGE_PAGE_SIZE);
    }
    if (result.error) setNotice('Could not load older messages: ' + result.error.message);
    else {
      const older = ((result.data ?? []) as InboxMessage[]).map(message => ({
        ...message,
        media_path: attachmentSchemaMissing ? null : message.media_path,
        media_name: attachmentSchemaMissing ? null : message.media_name,
        media_mime_type: attachmentSchemaMissing ? null : message.media_mime_type,
        media_size: attachmentSchemaMissing ? null : message.media_size,
      })).reverse();
      setMessages(current => {
        const combined = new Map<number, InboxMessage>();
        for (const message of older) combined.set(message.message_id, message);
        for (const message of current) if (message.chat_id === chatId) combined.set(message.message_id, message);
        return [...combined.values()].sort((a, b) => a.message_id - b.message_id);
      });
      setHasMoreMessages(older.length === MESSAGE_PAGE_SIZE);
      if (older.length) {
        if (olderCacheTimerRef.current !== null) window.clearTimeout(olderCacheTimerRef.current);
        olderCacheTimerRef.current = window.setTimeout(() => {
          setMessages(current => current
            .filter(message => message.chat_id === chatId)
            .sort((a, b) => b.message_id - a.message_id)
            .slice(0, MESSAGE_PAGE_SIZE)
            .sort((a, b) => a.message_id - b.message_id));
          setHasMoreMessages(true);
          olderCacheTimerRef.current = null;
        }, 60 * 60 * 1000);
      }
    }
    setLoadingOlderMessages(false);
  }, [supabase, selectedChat, loadingOlderMessages, messages]);
  const checkWorkerStatus = useCallback(async () => {
    if (!supabase) return null;
    const { data, error } = await supabase.functions.invoke('telegram-inbox-status', { body: {} });
    if (error || data?.error) return null;
    return Boolean(data?.running);
  }, [supabase]);

  useEffect(() => {
    setMediaUrls({});
    setDraft('');
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [selectedChat]);

  useEffect(() => { void refreshChats(); }, [refreshChats]);
  useEffect(() => { void refreshConversation(); }, [refreshConversation]);

  // Keep the conversation pinned to the newest message when opening a chat or loading updates.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (preserveScrollRef.current) {
      const previous = preserveScrollRef.current;
      container.scrollTop = container.scrollHeight - previous.height + previous.top;
      preserveScrollRef.current = null;
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [selectedChat, messages, pendingReplies]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const withMedia = messages.filter(message => message.media_path && !mediaUrls[message.chat_id + ':' + message.message_id]);
    if (!withMedia.length) return;
    void Promise.all(withMedia.map(async message => {
      const { data } = await supabase.storage.from('telegram-inbox-media').createSignedUrl(message.media_path!, 3600);
      return data?.signedUrl ? [message.chat_id + ':' + message.message_id, data.signedUrl] as const : null;
    })).then(results => {
      if (cancelled) return;
      setMediaUrls(current => {
        const next = { ...current };
        for (const result of results) if (result) next[result[0]] = result[1];
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [supabase, messages, mediaUrls]);

  useEffect(() => {
    if (!pendingReplies.some(item => item.chat_id === Number(selectedChat))) return;
    const timer = window.setInterval(() => { void refreshConversation(); }, 3000);
    return () => window.clearInterval(timer);
  }, [pendingReplies, selectedChat, refreshConversation]);

  useEffect(() => {
    if (!syncing) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      const running = await checkWorkerStatus();
      if (cancelled) return;
      if (running === true || running === null) {
        timer = window.setTimeout(() => { void poll(); }, 3000);
        return;
      }
      if (syncRequestedAt !== null && Date.now() - syncRequestedAt < 30000) {
        timer = window.setTimeout(() => { void poll(); }, 3000);
        return;
      }
      setSyncing(false);
      setSyncRequestedAt(null);
      setNotice('Telegram sync finished. Inbox refreshed.');
      await refreshChats();
      await refreshConversation();
    };
    void poll();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [syncing, syncRequestedAt, checkWorkerStatus, refreshChats, refreshConversation]);

  async function requestSync(force = false) {
    if (!supabase || (syncing && !force)) return;
    setSyncing(true);
    setSyncRequestedAt(Date.now());
    setNotice('Requesting Telegram sync…');
    const { data, error } = await supabase.functions.invoke('telegram-inbox-refresh', { body: {} });
    if (error || data?.error) {
      setSyncing(false);
      setSyncRequestedAt(null);
      setNotice('Could not start Telegram sync. Check the secure refresh function configuration.');
      return;
    }
    setNotice('Sync request accepted. Waiting for the worker to start…');
  }

  async function assignChat() {
    if (!supabase || !profile?.id || !isAdmin || !selectedChat || !assignee) return;
    setNotice('');
    const { error } = await supabase.from('telegram_inbox_chat_assignments').upsert({
      chat_id: Number(selectedChat), profile_id: assignee, assigned_by: profile.id,
    }, { onConflict: 'chat_id,profile_id' });
    if (error) setNotice('Could not assign conversation: ' + error.message);
    else {
      setNotice('Conversation assigned.');
      setAssignee('');
      await refreshChats();
    }
  }

  async function removeAssignment(profileId: string) {
    if (!supabase || !isAdmin || !selectedChat) return;
    const { error } = await supabase.from('telegram_inbox_chat_assignments').delete()
      .eq('chat_id', Number(selectedChat)).eq('profile_id', profileId);
    if (error) setNotice('Could not remove assignment: ' + error.message);
    else {
      setNotice('Assignment removed.');
      await refreshChats();
    }
  }

  async function queueReply(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !profile?.id || !selectedChat || (!draft.trim() && !attachment)) return;
    setSending(true);
    setNotice('');
    const textToSend = draft.trim();
    const queuedAt = new Date().toISOString();
    const chatId = Number(selectedChat);
    let attachmentPath: string | null = null;
    if (attachment) {
      if (attachment.size > 20 * 1024 * 1024) {
        setNotice('Attachments must be 20 MB or smaller.');
        setSending(false);
        return;
      }
      const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'attachment';
      attachmentPath = chatId + '/outbox/' + crypto.randomUUID() + '-' + safeName;
      const { error: uploadError } = await supabase.storage.from('telegram-inbox-media').upload(attachmentPath, attachment, {
        contentType: attachment.type || 'application/octet-stream', upsert: false,
      });
      if (uploadError) {
        setNotice('Could not upload attachment. Check the Telegram media migration and storage permissions: ' + uploadError.message);
        setSending(false);
        return;
      }
    }
    const { data, error } = await supabase.from('telegram_inbox_outbox').insert({
      chat_id: chatId,
      requested_by: profile.id,
      message_text: textToSend || (attachment ? attachment.name : ''),
      attachment_path: attachmentPath,
      attachment_name: attachment?.name ?? null,
      attachment_mime_type: attachment?.type || null,
      attachment_size: attachment?.size ?? null,
      status: 'pending',
    }).select('id').single();
    if (error) setNotice('Could not queue reply: ' + error.message);
    else {
      setDraft('');
      setAttachment(null);
      setPendingReplies(current => [...current, {
        id: String(data.id), chat_id: chatId, message_text: textToSend, created_at: queuedAt,
      }]);
      setNotice('Reply queued. Starting Telegram sync in 3 seconds…');
      // Keep a visible local copy until the worker sends it and the synced message appears.
      window.setTimeout(() => { void requestSync(true); }, 3000);
    }
    setSending(false);
  }

  const selected = chats.find(chat => String(chat.chat_id) === selectedChat);
  const selectedAssignments = assignments.filter(item => String(item.chat_id) === selectedChat);
  const activeProfiles = profiles.filter(person => person.active && person.role.toLowerCase() !== 'admin');

  return <section className={"telegram-human-inbox" + (mobileExpanded ? " is-mobile-expanded" : "")} style={{ ...panel, overflow: 'hidden', color: '#e7e8ed' }}>
    <header className="telegram-inbox-header" style={{ padding: '8px 0 14px', borderBottom: '1px solid #26272d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div><h2 style={{ margin: 0 }}>Human-account Telegram Inbox</h2><p style={{ ...muted, margin: '6px 0 0' }}>Private chats from the connected Telegram account. Messages refresh automatically.</p></div>
      <button className="telegram-desktop-sync" type="button" disabled={loading || syncing} style={{ ...action, background: '#1d2939', border: '1px solid #475467', opacity: syncing ? 0.6 : 1 }} onClick={() => { void requestSync(); }}>{syncing ? 'Sync running…' : 'Sync Now'}</button>
    </header>
    {notice && <p role="status" style={{ color: notice.toLowerCase().includes('could not') ? '#fda29b' : '#98a2b3', padding: '0 16px', overflowWrap: 'anywhere' }}>{notice}</p>}
    <div className="telegram-inbox-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(190px, 0.72fr) minmax(260px, 1.9fr)', minHeight: 420 }}>
      <aside className="telegram-conversation-list" style={{ borderRight: '1px solid #26272d', maxHeight: 620, overflowY: 'auto', minWidth: 0, paddingRight: 8 }}>
        <div className="telegram-chat-strip-heading" style={{ padding: '10px 8px', borderBottom: '1px solid #26272d', color: '#858894', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}><span>Chats ({chats.length})</span><button className="telegram-mobile-sync" type="button" aria-label={syncing ? 'Telegram sync running' : 'Sync Telegram chats'} title={syncing ? 'Sync running…' : 'Sync now'} disabled={loading || syncing} onClick={() => { void requestSync(); }}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/></svg></button><button className="telegram-mobile-expand" type="button" aria-label={mobileExpanded ? "Exit full-screen Telegram composer" : "Expand Telegram chat to full screen"} title={mobileExpanded ? "Exit full screen" : "Expand to full screen"} onClick={() => setMobileExpanded(value => !value)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{mobileExpanded ? <><path d="M8 3v5H3"/><path d="M16 3v5h5"/><path d="M3 16h5v5"/><path d="M21 16h-5v5"/></> : <><path d="M8 3H3v5"/><path d="M16 3h5v5"/><path d="M3 16v5h5"/><path d="M21 16v5h-5"/></>}</svg></button></div>
        {loading && <p style={{ padding: 14, ...muted }}>Loading conversations…</p>}
        {!loading && chats.length === 0 && <p style={{ padding: 14, ...muted }}>No conversations are available to your account. Admins can see all synced chats; employees need an assigned chat.</p>}
        {chats.map(chat => <button className={"telegram-chat-choice" + (String(chat.chat_id) === selectedChat ? " is-selected" : "")} key={chat.chat_id} type="button" onClick={() => { if (olderCacheTimerRef.current !== null) window.clearTimeout(olderCacheTimerRef.current); olderCacheTimerRef.current = null; setMessages([]); setHasMoreMessages(false); setSelectedChat(String(chat.chat_id)); setUnreadCounts(current => ({ ...current, [String(chat.chat_id)]: 0 })); }} style={{ width: '100%', display: 'block', textAlign: 'left', padding: '11px 8px', border: 0, borderBottom: '1px solid #202127', borderRadius: 7, cursor: 'pointer', background: String(chat.chat_id) === selectedChat ? '#202126' : 'transparent', color: '#f2f4f7' }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{chat.title || chat.username || chat.chat_id}</strong>
            {(unreadCounts[String(chat.chat_id)] ?? 0) > 0 && <span aria-label={unreadCounts[String(chat.chat_id)] + ' new messages'} style={{ flex: '0 0 auto', minWidth: 22, height: 22, padding: '0 6px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#f97316', color: '#fff', fontSize: 12, fontWeight: 800 }}>{unreadCounts[String(chat.chat_id)]}</span>}
          </span>
          {chat.username && <span style={{ display: 'block', ...muted }}>@{chat.username}</span>}
          <span style={{ display: 'block', ...muted, marginTop: 4 }}>{chat.last_message_at ? new Date(chat.last_message_at).toLocaleString() : 'No recent message'}</span>
        </button>)}
      </aside>
      <div className="telegram-conversation-panel" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 420 }}>
        {selected ? <>
          <div className="telegram-selected-chat-header" style={{ padding: '10px 14px', borderBottom: '1px solid #26272d' }}><strong>{selected.title}</strong><div style={muted}>Chat ID: {selected.chat_id} · Last synced: {selected.last_synced_at ? new Date(selected.last_synced_at).toLocaleString() : 'Not synced'}</div></div>
          {isAdmin && <div className="telegram-chat-assignment" style={{ borderBottom: '1px solid #26272d', padding: '8px 14px 12px', marginBottom: 4 }}>
            <strong>Assign to CRM employees</strong>
            <div className="telegram-assignment-controls" style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <select aria-label="Choose employee for conversation" style={{ ...control, flex: '1 1 200px' }} value={assignee} onChange={event => setAssignee(event.target.value)}>
                <option value="">Choose employee…</option>
                {activeProfiles.map(person => <option key={person.id} value={person.id}>{person.full_name || person.email || person.id} · {person.role}</option>)}
              </select>
              <button type="button" style={action} disabled={!assignee} onClick={() => void assignChat()}>Assign</button>
            </div>
            <div className="telegram-assignment-chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {selectedAssignments.map(item => {
                const person = profiles.find(p => p.id === item.profile_id);
                return <span key={item.profile_id} style={{ ...control, fontSize: 12 }}>{person?.full_name || person?.email || item.profile_id} <button type="button" aria-label="Remove assignment" onClick={() => void removeAssignment(item.profile_id)} style={{ border: 0, color: '#fda29b', background: 'transparent', cursor: 'pointer' }}>×</button></span>;
              })}
              {!selectedAssignments.length && <span style={muted}>Not assigned yet.</span>}
            </div>
          </div>}
          <div className="telegram-messages" ref={messagesContainerRef} style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', maxHeight: 520, minHeight: 260, background: 'transparent' }}>
            {hasMoreMessages && <button type="button" disabled={loadingOlderMessages} onClick={() => void loadOlderMessages()} style={{ ...action, alignSelf: 'center', fontSize: 12, marginBottom: 4, opacity: loadingOlderMessages ? 0.65 : 1 }}>{loadingOlderMessages ? 'Loading older messages…' : '↑ Load older messages'}</button>}
            {messages.map(message => <article key={message.chat_id + ':' + message.message_id} style={{ alignSelf: message.outgoing ? 'flex-end' : 'flex-start', maxWidth: '88%', padding: '9px 11px', borderRadius: 10, background: message.outgoing ? '#173b31' : '#191a20', border: '1px solid #292b32', overflowWrap: 'anywhere' }}>
              <div style={{ fontSize: 11, color: '#b7c0d1', marginBottom: 4 }}>{message.outgoing ? 'Connected account' : selected.title} · {new Date(message.sent_at).toLocaleString()}{message.outgoing && <span title={message.message_id <= (selected.read_outbox_max_id ?? 0) ? 'Read on Telegram' : 'Sent, not yet marked as read'} aria-label={message.message_id <= (selected.read_outbox_max_id ?? 0) ? 'Read' : 'Sent'} style={{ marginLeft: 7, color: message.message_id <= (selected.read_outbox_max_id ?? 0) ? '#53bdeb' : '#98a2b3', fontWeight: 700, letterSpacing: -2 }}>{message.message_id <= (selected.read_outbox_max_id ?? 0) ? '✓✓' : '✓'}</span>}</div>
              {message.message_text && message.message_text !== '[Attachment]' && <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{message.message_text}</div>}
              {message.media_path && <div style={{ marginTop: 6 }}>
                {mediaUrls[message.chat_id + ':' + message.message_id] && message.media_mime_type?.startsWith('image/') ?
                  <a href={mediaUrls[message.chat_id + ':' + message.message_id]} target="_blank" rel="noreferrer"><img src={mediaUrls[message.chat_id + ':' + message.message_id]} alt={message.media_name || 'Telegram attachment'} style={{ display: 'block', maxWidth: 'min(100%, 360px)', maxHeight: 300, borderRadius: 8 }} /></a> :
                  <a href={mediaUrls[message.chat_id + ':' + message.message_id] || '#'} target="_blank" rel="noreferrer" style={{ color: '#fdbb74', overflowWrap: 'anywhere' }}>📎 {message.media_name || 'Open attachment'}{message.media_size ? ' · ' + Math.ceil(message.media_size / 1024) + ' KB' : ''}</a>}
              </div>}
            </article>)}
            {pendingReplies.filter(item => item.chat_id === Number(selectedChat)).map(item => <article key={'pending:' + item.id} style={{ alignSelf: 'flex-end', maxWidth: '88%', padding: '9px 11px', borderRadius: 10, background: '#40371e', color: '#fff2c4', border: '1px solid #76612a', overflowWrap: 'anywhere' }}>
              <div style={{ fontSize: 11, color: '#fff0b3', marginBottom: 4 }}>You · {new Date(item.created_at).toLocaleString()} · Waiting to sync</div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{item.message_text}</div>
            </article>)}
            {!messages.length && !pendingReplies.some(item => item.chat_id === Number(selectedChat)) && <p style={muted}>No messages loaded for this conversation yet.</p>}
          </div>
          <form className="telegram-composer" onSubmit={queueReply} style={{ padding: '10px 14px 12px', borderTop: '1px solid #26272d', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea aria-label="Reply to Telegram customer" value={draft} onChange={event => setDraft(event.target.value)} maxLength={12000} rows={2} placeholder="Write a reply as the connected human Telegram account…" style={{ ...control, flex: 1, resize: 'vertical', borderColor: '#292b32', background: '#111216' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input ref={fileInputRef} type="file" aria-label="Choose attachment" onChange={event => setAttachment(event.target.files?.[0] ?? null)} style={{ display: 'none' }} />
              <button type="button" title="Attach file" aria-label="Attach file" onClick={() => fileInputRef.current?.click()} style={{ width: 38, height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #475467', borderRadius: 8, background: '#1d2939', color: '#e4e7ec', cursor: 'pointer', flex: '0 0 auto' }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21.4 11.1-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.9 1.9 0 0 1-2.6-2.6l8.5-8.5"/></svg>
              </button>
              {attachment && <span style={{ ...muted, flex: 1, overflowWrap: 'anywhere' }}>{attachment.name} · {Math.ceil(attachment.size / 1024)} KB <button type="button" aria-label="Remove attachment" onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} style={{ border: 0, background: 'transparent', color: '#fda29b', cursor: 'pointer' }}>×</button></span>}
              <button type="submit" style={{ ...control, background: '#1d2939', border: '1px solid #475467', fontWeight: 700, cursor: 'pointer', marginLeft: 'auto', minWidth: 84 }} disabled={sending || (!draft.trim() && !attachment)}>{sending ? 'Sending…' : 'Send'}</button>
            </div>
          </form>
        </> : <div style={{ padding: 24, textAlign: 'center', border: '0', borderRadius: 0, color: '#b7c0d1' }}>Select a conversation to view messages and reply.</div>}
      </div>
    </div>
    <footer style={{ padding: '8px 0', borderTop: '1px solid #26272d', ...muted }}>{isAdmin ? 'Admin access: all synced private human chats.' : 'Access is limited to chats assigned to you or your direct reports.'}</footer>
  </section>;
}
