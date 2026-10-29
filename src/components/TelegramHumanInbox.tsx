import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type Person = { id: string; full_name: string | null; email: string | null; role: string; active: boolean };
type Profile = Person | null;
type InboxChat = { chat_id: number; title: string; username: string | null; last_message_id: number; last_message_at: string | null; last_synced_at: string | null; read_outbox_max_id: number };
type InboxMessage = { chat_id: number; message_id: number; sender_id: number | null; outgoing: boolean; message_text: string; sent_at: string; reply_to_message_id: number | null };
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
  const [assignments, setAssignments] = useState<InboxAssignment[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncRequestedAt, setSyncRequestedAt] = useState<number | null>(null);
  const [selectedChat, setSelectedChat] = useState('');
  const [assignee, setAssignee] = useState('');
  const [draft, setDraft] = useState('');
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
      setOutbox([]);
      return;
    }
    const chatId = Number(selectedChat);
    const messageResult = await supabase.from('telegram_inbox_messages')
      .select('chat_id,message_id,sender_id,outgoing,message_text,sent_at,reply_to_message_id')
      .eq('chat_id', chatId).order('sent_at', { ascending: true }).limit(500);
    if (messageResult.error) setNotice('Could not load conversation: ' + messageResult.error.message);
    else setMessages((messageResult.data ?? []) as InboxMessage[]);
  }, [supabase, selectedChat, profile?.id, profile?.active]);

  useEffect(() => { void refreshChats(); }, [refreshChats]);
  useEffect(() => { void refreshConversation(); }, [refreshConversation]);

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
    if (!supabase || !profile?.id || !selectedChat || !draft.trim()) return;
    setSending(true);
    setNotice('');
    const { error } = await supabase.from('telegram_inbox_outbox').insert({
      chat_id: Number(selectedChat),
      requested_by: profile.id,
      message_text: draft.trim(),
      status: 'pending',
    });
    if (error) setNotice('Could not queue reply: ' + error.message);
    else {
      setDraft('');
      setNotice('Reply queued. It will be sent by the next scheduled GitHub Actions run; delivery may be delayed.');
      await refreshConversation();
    }
    setSending(false);
  }

  const selected = chats.find(chat => String(chat.chat_id) === selectedChat);
  const selectedAssignments = assignments.filter(item => String(item.chat_id) === selectedChat);
  const activeProfiles = profiles.filter(person => person.active && person.role.toLowerCase() !== 'admin');

  return <section style={panel}>
    <h2 style={{ marginTop: 0 }}>Human Telegram account inbox</h2>
    <p style={muted}>Uses your normal Telegram account, not a bot. The temporary GitHub Actions worker checks for messages every 10 minutes on a best-effort basis. Use Refresh after a poll to load the latest messages.</p>
    {notice && <p role="status" style={{ padding: 10, borderRadius: 8, background: '#202b3e', overflowWrap: 'anywhere' }}>{notice}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(210px, 0.8fr) minmax(0, 2fr)', gap: 14 }}>
      <aside style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <strong>Conversations ({chats.length})</strong>
          <button type="button" style={action} onClick={() => { void refreshChats(); void refreshConversation(); }} disabled={loading}>Refresh</button>
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
              <div style={{ fontSize: 11, color: '#b7c0d1', marginBottom: 4 }}>{message.outgoing ? 'Connected account' : selected.title} · {new Date(message.sent_at).toLocaleString()}</div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{message.message_text}</div>
            </article>)}
            {!messages.length && <p style={muted}>No messages loaded for this conversation yet.</p>}
          </div>
          <form onSubmit={queueReply} style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'stretch' }}>
            <textarea aria-label="Reply to Telegram customer" value={draft} onChange={event => setDraft(event.target.value)} maxLength={12000} rows={2} placeholder="Write a reply as the connected human Telegram account…" style={{ ...control, flex: 1, resize: 'vertical' }} />
            <button type="submit" style={action} disabled={sending || !draft.trim()}>{sending ? 'Queueing…' : 'Queue reply'}</button>
          </form>
          <p style={muted}>Replies are queued for the next GitHub Actions poll; this screen does not send directly from the browser.</p>
          {outbox.length > 0 && <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer' }}>Recent reply delivery status ({outbox.length})</summary><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}><thead><tr>{['Reply','Status','Time / error'].map(title => <th key={title} style={{ padding: 7, textAlign: 'left', borderBottom: '1px solid #344054' }}>{title}</th>)}</tr></thead><tbody>{outbox.map(item => <tr key={item.id}><td style={{ padding: 7, borderBottom: '1px solid #344054', whiteSpace: 'pre-wrap' }}>{item.message_text}</td><td style={{ padding: 7, borderBottom: '1px solid #344054' }}>{item.status}</td><td style={{ padding: 7, borderBottom: '1px solid #344054', overflowWrap: 'anywhere' }}>{item.error_message || (item.sent_at ? new Date(item.sent_at).toLocaleString() : new Date(item.created_at).toLocaleString())}</td></tr>)}</tbody></table></div></details>}
        </> : <div style={{ padding: 24, textAlign: 'center', border: '1px dashed #475467', borderRadius: 10, color: '#b7c0d1' }}>Select a conversation to view messages and reply.</div>}
      </div>
    </div>
  </section>;
}
