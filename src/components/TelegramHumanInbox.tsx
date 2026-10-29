import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type Person = { id: string; full_name: string | null; email: string | null; role: string; active: boolean };
type Profile = Person | null;
type InboxChat = { chat_id: number; title: string; username: string | null; last_message_id: number; last_message_at: string | null; last_synced_at: string | null; read_outbox_max_id: number };
type InboxMessage = { chat_id: number; message_id: number; sender_id: number | null; outgoing: boolean; message_text: string; sent_at: string; reply_to_message_id: number | null; media_path: string | null; media_name: string | null; media_mime_type: string | null; media_size: number | null };
type PendingReply = { id: string; chat_id: number; message_text: string; created_at: string };
type InboxAssignment = { chat_id: number; profile_id: string; assigned_by: string | null; assigned_at: string };

const panel: CSSProperties = { border: '1px solid #344054', borderRadius: 12, padding: 16, margin: '12px 0 24px', background: '#101828' };
const muted: CSSProperties = { color: '#b7c0d1', fontSize: 13 };
const control: CSSProperties = { padding: '9px 11px', border: '1px solid #475467', borderRadius: 8, color: '#f8fafc', background: '#182230', maxWidth: '100%' };
const action: CSSProperties = { ...control, border: 0, background: '#f97316', fontWeight: 700, cursor: 'pointer' };

export default function TelegramHumanInbox({ supabase, profile, profiles }: {
  supabase: SupabaseClient | null;
  profile: Profile;
  profiles: Person[];
}) {
  const [chats, setChats] = useState<InboxChat[]>([]);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [pendingReplies, setPendingReplies] = useState<PendingReply[]>([]);
  const [assignments, setAssignments] = useState<InboxAssignment[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncRequestedAt, setSyncRequestedAt] = useState<number | null>(null);
  const [selectedChat, setSelectedChat] = useState('');
  const [assignee, setAssignee] = useState('');
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
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
      setChats(rows);
      if (!selectedChat && rows.length) setSelectedChat(String(rows[0].chat_id));
    }
    if (assignmentResult.error) setNotice(current => current || 'Could not load inbox assignments: ' + assignmentResult.error.message);
    else setAssignments((assignmentResult.data ?? []) as InboxAssignment[]);
    setLoading(false);
  }, [supabase, profile?.id, profile?.active, selectedChat]);

  const refreshConversation = useCallback(async () => {
    if (!supabase || !selectedChat || !profile?.active) {
      setMessages([]);
      return;
    }
    const chatId = Number(selectedChat);
    const messageResult = await supabase.from('telegram_inbox_messages')
      .select('chat_id,message_id,sender_id,outgoing,message_text,sent_at,reply_to_message_id,media_path,media_name,media_mime_type,media_size')
      .eq('chat_id', chatId).order('sent_at', { ascending: true }).limit(500);
    if (messageResult.error) setNotice('Could not load conversation: ' + messageResult.error.message);
    else {
      const loaded = (messageResult.data ?? []) as InboxMessage[];
      setMessages(loaded);
      setPendingReplies(current => current.filter(pending =>
        !loaded.some(message => message.outgoing && message.chat_id === pending.chat_id &&
          message.message_text === pending.message_text && new Date(message.sent_at).getTime() >= new Date(pending.created_at).getTime() - 5000)
      ));
    }
  }, [supabase, selectedChat, profile?.id, profile?.active]);

  const checkWorkerStatus = useCallback(async () => {
    if (!supabase) return null;
    const { data, error } = await supabase.functions.invoke('telegram-inbox-status', { body: {} });
    if (error || data?.error) return null;
    return Boolean(data?.running);
  }, [supabase]);

  useEffect(() => { void refreshChats(); }, [refreshChats]);
  useEffect(() => { void refreshConversation(); }, [refreshConversation]);

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

  return <section style={panel}>
    <h2 style={{ marginTop: 0 }}>Human Telegram account inbox</h2>
    <p style={muted}>Uses your connected human Telegram account. Messages are checked on the five-minute schedule; use Sync now to request an immediate poll.</p>
    {notice && <p role="status" style={{ padding: 10, borderRadius: 8, background: '#202b3e', overflowWrap: 'anywhere' }}>{notice}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(210px, 0.8fr) minmax(0, 2fr)', gap: 14 }}>
      <aside style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <strong>Conversations ({chats.length})</strong>
          <button type="button" style={{ ...action, opacity: syncing ? 0.55 : 1 }} onClick={() => { void requestSync(); }} disabled={loading || syncing}>{syncing ? "Sync running…" : "Sync now"}</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 480, overflowY: 'auto' }}>
          {chats.map(chat => <button key={chat.chat_id} type="button" onClick={() => setSelectedChat(String(chat.chat_id))} style={{ ...control, textAlign: 'left', cursor: 'pointer', background: String(chat.chat_id) === selectedChat ? '#344054' : '#182230', borderColor: String(chat.chat_id) === selectedChat ? '#f97316' : '#475467' }}>
            <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{chat.title}</strong>
            <span style={{ display: 'block', ...muted }}>{chat.username ? '@' + chat.username : 'Private chat'} · {chat.last_message_at ? new Date(chat.last_message_at).toLocaleString() : 'No timestamp'}</span>
          </button>)}
          {!chats.length && <p style={muted}>{loading ? 'Loading conversations…' : 'No conversations synced yet. Configure the GitHub Actions secrets and run the poller.'}</p>}
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        {selected ? <>
          <header style={{ borderBottom: '1px solid #344054', paddingBottom: 10, marginBottom: 12 }}>
            <h3 style={{ margin: '0 0 5px' }}>{selected.title}</h3>
            <div style={muted}>{selected.username ? '@' + selected.username : 'Private Telegram chat'} · Last synced: {selected.last_synced_at ? new Date(selected.last_synced_at).toLocaleString() : 'Not synced'}</div>
          </header>
          {isAdmin && <div style={{ border: '1px solid #344054', borderRadius: 8, padding: 10, marginBottom: 12 }}>
            <strong>Assign to CRM employees</strong>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <select aria-label="Choose employee for conversation" style={{ ...control, flex: '1 1 200px' }} value={assignee} onChange={event => setAssignee(event.target.value)}>
                <option value="">Choose employee…</option>
                {activeProfiles.map(person => <option key={person.id} value={person.id}>{person.full_name || person.email || person.id} · {person.role}</option>)}
              </select>
              <button type="button" style={action} disabled={!assignee} onClick={() => void assignChat()}>Assign</button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {selectedAssignments.map(item => {
                const person = profiles.find(p => p.id === item.profile_id);
                return <span key={item.profile_id} style={{ ...control, fontSize: 12 }}>{person?.full_name || person?.email || item.profile_id} <button type="button" aria-label="Remove assignment" onClick={() => void removeAssignment(item.profile_id)} style={{ border: 0, color: '#fda29b', background: 'transparent', cursor: 'pointer' }}>×</button></span>;
              })}
              {!selectedAssignments.length && <span style={muted}>Not assigned yet.</span>}
            </div>
          </div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 390, overflowY: 'auto', padding: 10, border: '1px solid #344054', borderRadius: 10, background: '#0b1220' }}>
            {messages.map(message => <article key={message.chat_id + ':' + message.message_id} style={{ alignSelf: message.outgoing ? 'flex-end' : 'flex-start', maxWidth: '92%', padding: '9px 11px', borderRadius: 10, background: message.outgoing ? '#174c3b' : '#1b2b40', overflowWrap: 'anywhere' }}>
              <div style={{ fontSize: 11, color: '#b7c0d1', marginBottom: 4 }}>{message.outgoing ? 'Connected account' : selected.title} · {new Date(message.sent_at).toLocaleString()}{message.outgoing && <span title={message.message_id <= (selected.read_outbox_max_id ?? 0) ? 'Read on Telegram' : 'Sent, not yet marked as read'} aria-label={message.message_id <= (selected.read_outbox_max_id ?? 0) ? 'Read' : 'Sent'} style={{ marginLeft: 7, color: message.message_id <= (selected.read_outbox_max_id ?? 0) ? '#53bdeb' : '#98a2b3', fontWeight: 700, letterSpacing: -2 }}>{message.message_id <= (selected.read_outbox_max_id ?? 0) ? '✓✓' : '✓'}</span>}</div>
              {message.message_text && message.message_text !== '[Attachment]' && <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{message.message_text}</div>}
              {message.media_path && <div style={{ marginTop: 6 }}>
                {mediaUrls[message.chat_id + ':' + message.message_id] && message.media_mime_type?.startsWith('image/') ?
                  <a href={mediaUrls[message.chat_id + ':' + message.message_id]} target="_blank" rel="noreferrer"><img src={mediaUrls[message.chat_id + ':' + message.message_id]} alt={message.media_name || 'Telegram attachment'} style={{ display: 'block', maxWidth: 'min(100%, 360px)', maxHeight: 300, borderRadius: 8 }} /></a> :
                  <a href={mediaUrls[message.chat_id + ':' + message.message_id] || '#'} target="_blank" rel="noreferrer" style={{ color: '#fdbb74', overflowWrap: 'anywhere' }}>📎 {message.media_name || 'Open attachment'}{message.media_size ? ' · ' + Math.ceil(message.media_size / 1024) + ' KB' : ''}</a>}
              </div>}
            </article>)}
            {pendingReplies.filter(item => item.chat_id === Number(selectedChat)).map(item => <article key={'pending:' + item.id} style={{ alignSelf: 'flex-end', maxWidth: '92%', padding: '9px 11px', borderRadius: 10, background: '#8a6d1d', color: '#fff7d6', border: '1px solid #d6ad3c', overflowWrap: 'anywhere' }}>
              <div style={{ fontSize: 11, color: '#fff0b3', marginBottom: 4 }}>You · {new Date(item.created_at).toLocaleString()} · Waiting to sync</div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{item.message_text}</div>
            </article>)}
            {!messages.length && !pendingReplies.some(item => item.chat_id === Number(selectedChat)) && <p style={muted}>No messages loaded for this conversation yet.</p>}
          </div>
          <form onSubmit={queueReply} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, alignItems: 'stretch' }}>
            <textarea aria-label="Reply to Telegram customer" value={draft} onChange={event => setDraft(event.target.value)} maxLength={12000} rows={2} placeholder="Write a reply as the connected human Telegram account…" style={{ ...control, flex: 1, resize: 'vertical' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ ...control, cursor: 'pointer' }}>📎 Attach file<input type="file" aria-label="Attach a file" onChange={event => setAttachment(event.target.files?.[0] ?? null)} style={{ display: 'block', maxWidth: '100%', marginTop: 5 }} /></label>
              {attachment && <span style={muted}>{attachment.name} · {Math.ceil(attachment.size / 1024)} KB <button type="button" onClick={() => setAttachment(null)} style={{ ...control, padding: '2px 6px' }}>Remove</button></span>}
              <button type="submit" style={action} disabled={sending || (!draft.trim() && !attachment)}>{sending ? 'Queueing…' : 'Queue reply'}</button>
            </div>
          </form>
          <p style={muted}>✓ means sent. Blue ✓✓ means Telegram reports the outgoing message as read.</p>
        </> : <div style={{ padding: 24, textAlign: 'center', border: '1px dashed #475467', borderRadius: 10, color: '#b7c0d1' }}>Select a conversation to view messages and reply.</div>}
      </div>
    </div>
  </section>;
}
