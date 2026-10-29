
import { useCallback, useEffect, useState } from 'react';
import { Menu, X, MapPin, LayoutDashboard, Users, CalendarDays, MessageCircle, LogOut, ShieldAlert } from 'lucide-react';
import type { CSSProperties, FormEvent } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import ManagementTools from './components/ManagementTools';

type Attendance = {
  id: string;
  employee_id?: string;
  check_in: string;
  check_out: string | null;
  check_in_lat: number | null;
  check_in_lng: number | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  work_date: string | null;
  work_timezone: string | null;
};

type Shift = {
  id: string;
  starts_at: string;
  ends_at: string;
};

type InvitationDetails = { admin_panel_name: string; corporate_email: string; invited_role: string; expires_at: string; valid: boolean };

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  active: boolean;
};

type ManagerAssignment = { manager_id: string; employee_id: string };

type Screen = 'loading' | 'login' | 'set-password' | 'signed-in';
type CrmPage = 'dashboard' | 'attendance' | 'team' | 'telegram' | 'security';
type PasswordFlow = 'invite' | 'recovery' | null;

type Coordinates = {
  latitude: number;
  longitude: number;
};

const BREAK_MINUTES = 60;
const APPROVED_EMAIL_DOMAINS = [
  'mostbet.partners',
  'infradim.com',
  'starson.cloud',
  'double.global',
];

function readPasswordFlow(): PasswordFlow {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);

  if (hash.get('error_code') ?? query.get('error_code')) return null;

  const type = hash.get('type') ?? query.get('type');
  return type === 'invite' || type === 'recovery' ? type : null;
}

function formatDate(value: string, timezone?: string | null) {
  const date = new Date(value);

  if (timezone) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(date);
    } catch {
      // Fall back to browser-local formatting.
    }
  }

  return date.toLocaleString();
}

function getLocalDate(timezone: string, instant = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatDuration(milliseconds: number) {
  const totalMinutes = Math.floor(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
}


function csvCell(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function getSessionDuration(item: Attendance, now: number) {
  const start = new Date(item.check_in).getTime();

  if (!Number.isFinite(start)) {
    return {
      elapsed: 'Unavailable',
      worked: 'Unavailable',
      breakDeduction: 'Not applied',
      status: 'Invalid timestamp',
    };
  }

  const end = item.check_out
    ? new Date(item.check_out).getTime()
    : now;

  if (!Number.isFinite(end) || end < start) {
    return {
      elapsed: 'Unavailable',
      worked: 'Unavailable',
      breakDeduction: 'Not applied',
      status: 'Invalid timestamp',
    };
  }

  const elapsedMilliseconds = end - start;

  if (!item.check_out) {
    return {
      elapsed: formatDuration(elapsedMilliseconds),
      worked: 'Pending checkout',
      breakDeduction: 'Not applied yet',
      status: 'Open session',
    };
  }

  const breakMilliseconds = Math.min(
    BREAK_MINUTES * 60000,
    elapsedMilliseconds
  );

  const workedMilliseconds = Math.max(
    0,
    elapsedMilliseconds - BREAK_MINUTES * 60000
  );

  return {
    elapsed: formatDuration(elapsedMilliseconds),
    worked: formatDuration(workedMilliseconds),
    breakDeduction: formatDuration(breakMilliseconds),
    status: 'Completed',
  };
}

function getLocation(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not supported by this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (
          !Number.isFinite(coords.latitude) ||
          !Number.isFinite(coords.longitude) ||
          coords.latitude < -90 ||
          coords.latitude > 90 ||
          coords.longitude < -180 ||
          coords.longitude > 180
        ) {
          reject(new Error('The browser returned invalid coordinates.'));
          return;
        }

        resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error('Location permission was denied.'));
        } else if (error.code === error.TIMEOUT) {
          reject(new Error('Location request timed out. Please try again.'));
        } else {
          reject(new Error('Your current location is unavailable.'));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      }
    );
  });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Please try again.';
}

function isApprovedEmail(email: string) {
  const normalized = email.trim().toLowerCase();

  if (normalized === 'partnermbp@gmail.com') return true;

  const separator = normalized.lastIndexOf('@');
  if (separator < 1) return false;

  const domain = normalized.slice(separator + 1);
  return APPROVED_EMAIL_DOMAINS.includes(domain);
}


type SecurityActivity = {
  id: number;
  event_type: string;
  inviter_name: string | null;
  invitee_admin_panel_name: string | null;
  invitee_email: string | null;
  telegram_user_id: number | null;
  telegram_username: string | null;
  details: string;
  created_at: string;
};

function SecurityActivityPanel() {
  const [events, setEvents] = useState<SecurityActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!supabase) {
        setError('Security log is unavailable because the database is not configured.');
        setLoading(false);
        return;
      }
      const { data, error: queryError } = await supabase
        .from('suspicious_activities')
        .select('id,event_type,inviter_name,invitee_admin_panel_name,invitee_email,telegram_user_id,telegram_username,details,created_at')
        .order('created_at', { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (queryError) setError('Could not load Suspicious Activities: ' + queryError.message);
      else setEvents((data ?? []) as SecurityActivity[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const cellStyle: CSSProperties = { padding: 10, borderBottom: '1px solid #344054', textAlign: 'left', verticalAlign: 'top', overflowWrap: 'anywhere' };
  return <section style={{ marginTop: 20 }}>
    <h1>Security</h1>
    <h2>Suspicious Activities</h2>
    <p style={{ color: '#b7c0d1' }}>Attempts to reuse a Telegram identity already registered to another CRM account. This audit log is visible to Admin only.</p>
    {loading && <p>Loading security events…</p>}
    {error && <p role="alert" style={{ color: '#fda29b' }}>{error}</p>}
    {!loading && !error && events.length === 0 && <p style={{ color: '#b7c0d1' }}>No suspicious activities recorded.</p>}
    {!loading && !error && events.length > 0 && <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
        <thead><tr>
          <th style={cellStyle}>Time</th><th style={cellStyle}>Activity</th><th style={cellStyle}>Inviter manager</th>
          <th style={cellStyle}>Invitee Admin Panel Name</th><th style={cellStyle}>Invitee email</th>
          <th style={cellStyle}>Telegram ID</th><th style={cellStyle}>Telegram username</th><th style={cellStyle}>Details</th>
        </tr></thead>
        <tbody>{events.map(event => <tr key={event.id}>
          <td style={cellStyle}>{new Date(event.created_at).toLocaleString()}</td>
          <td style={cellStyle}>{event.event_type.replaceAll('_', ' ')}</td>
          <td style={cellStyle}>{event.inviter_name || 'Unavailable'}</td>
          <td style={cellStyle}>{event.invitee_admin_panel_name || 'Unavailable'}</td>
          <td style={cellStyle}>{event.invitee_email || 'Unavailable'}</td>
          <td style={cellStyle}>{event.telegram_user_id ?? 'Unavailable'}</td>
          <td style={cellStyle}>{event.telegram_username ? '@' + event.telegram_username : 'Not provided'}</td>
          <td style={cellStyle}>{event.details}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}



// Telegram inbox sync controls and read receipts.
type HumanInboxChat = {
  chat_id: number; title: string; username: string | null;
  last_message_id: number; last_message_at: string | null; last_synced_at: string | null; read_outbox_max_id: number;
};
type HumanInboxMessage = {
  chat_id: number; message_id: number; sender_id: number | null;
  outgoing: boolean; message_text: string; sent_at: string;
};

function TelegramHumanInbox({ client, profile }: { client: SupabaseClient | null; profile: Profile | null }) {
  const [chats, setChats] = useState<HumanInboxChat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<HumanInboxMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncRequestedAt, setSyncRequestedAt] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const isAdmin = profile?.active === true && profile.role.toLowerCase() === 'admin';

  const checkWorkerStatus = useCallback(async () => {
    if (!client) return null;
    const { data, error } = await client.functions.invoke('telegram-inbox-status', { body: {} });
    if (error || data?.error) return null;
    return Boolean(data?.running);
  }, [client]);

  const loadChats = useCallback(async () => {
    if (!client) { setNotice('Supabase is not configured in this deployment.'); setLoadingChats(false); return; }
    const { data, error } = await client.from('telegram_inbox_chats')
      .select('chat_id,title,username,last_message_id,last_message_at,last_synced_at,read_outbox_max_id')
      .order('last_message_at', { ascending: false, nullsFirst: false }).limit(500);
    if (error) setNotice('Could not load human-account chats: ' + error.message);
    else {
      const rows = (data ?? []) as HumanInboxChat[];
      setChats(rows);
      setNotice('');
      setSelectedChatId(current => current !== null && rows.some(row => row.chat_id === current) ? current : (rows[0]?.chat_id ?? null));
    }
    setLoadingChats(false);
  }, [client]);

  const loadMessages = useCallback(async (chatId: number, showLoading = true) => {
    if (!client) return;
    if (showLoading) setLoadingMessages(true);
    const { data, error } = await client.from('telegram_inbox_messages')
      .select('chat_id,message_id,sender_id,outgoing,message_text,sent_at')
      .eq('chat_id', chatId).order('message_id', { ascending: false }).limit(200);
    if (error) setNotice('Could not load messages: ' + error.message);
    else setMessages(((data ?? []) as HumanInboxMessage[]).reverse());
    setLoadingMessages(false);
  }, [client]);

  useEffect(() => { void loadChats(); }, [loadChats]);
  useEffect(() => {
    if (selectedChatId === null) { setMessages([]); return; }
    void loadMessages(selectedChatId);
    const timer = window.setInterval(() => { void loadMessages(selectedChatId, false); }, 10000);
    return () => window.clearInterval(timer);
  }, [selectedChatId, loadMessages]);
  useEffect(() => {
    const timer = window.setInterval(() => { void loadChats(); }, 15000);
    return () => window.clearInterval(timer);
  }, [loadChats]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      const running = await checkWorkerStatus();
      if (cancelled) return;
      if (running === null) {
        if (syncing) timer = window.setTimeout(() => { void poll(); }, 3000);
        return;
      }
      setSyncing(running);
      if (!running && syncing && syncRequestedAt !== null && Date.now() - syncRequestedAt < 10000) {
        timer = window.setTimeout(() => { void poll(); }, 3000);
      } else if (!running) {
        setSyncRequestedAt(null);
        await loadChats();
        if (selectedChatId !== null) await loadMessages(selectedChatId, false);
      } else {
        timer = window.setTimeout(() => { void poll(); }, 3000);
      }
    };
    void poll();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [checkWorkerStatus, loadChats, loadMessages, selectedChatId, syncing, syncRequestedAt]);

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!client || !profile?.id || selectedChatId === null || !text || sending) return;
    setSending(true); setNotice('');
    const { error } = await client.from('telegram_inbox_outbox').insert({ chat_id: selectedChatId, requested_by: profile.id, message_text: text });
    if (error) setNotice('Could not queue reply: ' + error.message);
    else setDraft('');
    setSending(false);
  }

  const panelStyle: CSSProperties = { border: '1px solid #344054', borderRadius: 14, overflow: 'hidden', background: '#101828', color: '#f2f4f7', margin: '18px 0 24px' };
  const mutedStyle: CSSProperties = { color: '#98a2b3', fontSize: 13 };
  const actionStyle: CSSProperties = { border: '1px solid #475467', borderRadius: 8, padding: '9px 12px', background: '#1d2939', color: '#f9fafb', cursor: 'pointer' };
  const selected = chats.find(chat => chat.chat_id === selectedChatId) ?? null;

  return <section style={panelStyle} aria-label="Human Telegram inbox">
    <header style={{ padding: 18, borderBottom: '1px solid #344054', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div><h2 style={{ margin: 0 }}>Human-account Telegram Inbox</h2><p style={{ ...mutedStyle, margin: '6px 0 0' }}>Private chats from the connected Telegram account. Messages refresh automatically.</p></div>
      <button type="button" disabled={syncing} style={{ ...actionStyle, opacity: syncing ? 0.6 : 1 }} onClick={async () => {
        if (!client || syncing) return;
        setSyncing(true);
        setSyncRequestedAt(Date.now());
        setNotice('Requesting Telegram sync…');
        try {
          const { data, error } = await client.functions.invoke('telegram-inbox-refresh', { body: {} });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          await loadChats();
          if (selectedChatId !== null) await loadMessages(selectedChatId, false);
          setNotice('Sync requested. Waiting for the worker to finish…');
          setSyncing(true);

        } catch (error) {
          setSyncing(false);
          setSyncRequestedAt(null);
          setNotice('Could not start Telegram sync. Check that the secure refresh function is deployed and configured.');
        }
      }}>{syncing ? 'Sync running…' : 'Sync now'}</button>
    </header>
    {notice && <p role="alert" style={{ color: '#fda29b', padding: '0 16px' }}>{notice}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 0.8fr) minmax(260px, 1.7fr)', minHeight: 420 }}>
      <aside style={{ borderRight: '1px solid #344054', maxHeight: 560, overflowY: 'auto' }}>
        {loadingChats && <p style={{ padding: 14 }}>Loading conversations…</p>}
        {!loadingChats && chats.length === 0 && <p style={{ padding: 14, ...mutedStyle }}>No conversations are available to your account. Admins can see all synced chats; employees need an assigned chat.</p>}
        {chats.map(chat => <button key={chat.chat_id} type="button" onClick={() => setSelectedChatId(chat.chat_id)} style={{ width: '100%', display: 'block', textAlign: 'left', padding: 14, border: 0, borderBottom: '1px solid #344054', cursor: 'pointer', background: selectedChatId === chat.chat_id ? '#344054' : 'transparent', color: '#f2f4f7' }}>
          <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{chat.title || chat.username || chat.chat_id}</strong>
          {chat.username && <span style={mutedStyle}>@{chat.username}</span>}
          <span style={{ display: 'block', ...mutedStyle, marginTop: 4 }}>{chat.last_message_at ? new Date(chat.last_message_at).toLocaleString() : 'No recent message'}</span>
        </button>)}
      </aside>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 420 }}>
        {selected ? <>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #344054' }}><strong>{selected.title}</strong><div style={mutedStyle}>Chat ID: {selected.chat_id} · Latest message ID: {selected.last_message_id}</div></div>
          <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 390 }}>
            {loadingMessages && <p style={mutedStyle}>Loading messages…</p>}
            {!loadingMessages && messages.length === 0 && <p style={mutedStyle}>No messages found for this conversation.</p>}
            {messages.map(message => <div key={message.chat_id + ':' + message.message_id} style={{ alignSelf: message.outgoing ? 'flex-end' : 'flex-start', maxWidth: '88%', background: message.outgoing ? '#184e3b' : '#1d2939', border: '1px solid #475467', borderRadius: 12, padding: '9px 12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              <div>{message.message_text}</div><div style={{ ...mutedStyle, marginTop: 5, textAlign: 'right' }}>{new Date(message.sent_at).toLocaleString()} · #{message.message_id}{message.outgoing && <span title={message.message_id <= (selected?.read_outbox_max_id ?? 0) ? 'Read on Telegram' : 'Sent, not yet marked as read'} aria-label={message.message_id <= (selected?.read_outbox_max_id ?? 0) ? 'Read' : 'Sent'} style={{ marginLeft: 7, color: message.message_id <= (selected?.read_outbox_max_id ?? 0) ? '#53bdeb' : '#98a2b3', fontWeight: 700, letterSpacing: -2 }}>{message.message_id <= (selected?.read_outbox_max_id ?? 0) ? '✓✓' : '✓'}</span>}</div>
            </div>)}
          </div>
          <form onSubmit={sendReply} style={{ padding: 12, borderTop: '1px solid #344054', display: 'flex', gap: 8 }}>
            <input value={draft} onChange={event => setDraft(event.target.value)} maxLength={12000} placeholder="Write a reply…" aria-label="Reply message" style={{ flex: 1, minWidth: 0, border: '1px solid #475467', borderRadius: 8, padding: '10px 12px', background: '#101828', color: '#f2f4f7' }} />
            <button type="submit" disabled={!draft.trim() || sending} style={{ ...actionStyle, opacity: !draft.trim() || sending ? 0.55 : 1 }}>{sending ? 'Queueing…' : 'Send'}</button>
          </form>
          <div style={{ ...mutedStyle, padding: '0 14px 12px' }}>Replies are queued securely. Use Sync now to request an immediate worker run, or wait for the five-minute scheduled poll.</div>
        </> : <div style={{ padding: 18, ...mutedStyle }}>Select a conversation to view its messages.</div>}
      </div>
    </div>
    <footer style={{ padding: 12, borderTop: '1px solid #344054', ...mutedStyle }}>{isAdmin ? 'Admin access: all synced private human chats.' : 'Access is limited to chats assigned to you or your direct reports.'}</footer>
  </section>;
}

export default function App() {
  // Give every CRM button visible feedback, including controls whose action is handled
  // in child components. The press animation is handled by the shared stylesheet.
  useEffect(() => {
    const showButtonFeedback = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const clickedButton = target.closest('button');
      if (!(clickedButton instanceof HTMLButtonElement) || clickedButton.disabled) return;
      const parent = clickedButton.parentElement;
      if (!parent) return;
      const previous = clickedButton.nextElementSibling;
      if (previous instanceof HTMLElement && previous.classList.contains('button-action-feedback')) {
        previous.remove();
      }
      const feedback = document.createElement('span');
      feedback.className = 'button-action-feedback';
      feedback.setAttribute('role', 'status');
      feedback.textContent = 'Done';
      clickedButton.insertAdjacentElement('afterend', feedback);
      window.setTimeout(() => {
        if (feedback.isConnected) feedback.remove();
      }, 1800);
    };
    document.addEventListener('click', showButtonFeedback);
    return () => document.removeEventListener('click', showButtonFeedback);
  }, []);

  const [passwordFlow, setPasswordFlow] =
    useState<PasswordFlow>(readPasswordFlow);
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite') || '');
  const [inviteRedeemed, setInviteRedeemed] = useState(false);
  const [inviteDetails, setInviteDetails] = useState<InvitationDetails | null>(null);
  const [inviteChallenge, setInviteChallenge] = useState('');
  const [inviteOtp, setInviteOtp] = useState('');
  const [inviteTelegramVerified, setInviteTelegramVerified] = useState(false);
  const [invitePasswordStep, setInvitePasswordStep] = useState(false);
  const [registrationTicket, setRegistrationTicket] = useState('');
  const [screen, setScreen] = useState<Screen>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [telegramOtp, setTelegramOtp] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [mapPreview, setMapPreview] = useState<{ title: string; latitude: number; longitude: number } | null>(null);
  const [navOpen, setNavOpen] = useState(true);
  const [activePage, setActivePage] = useState<CrmPage>('dashboard');
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [managerAssignments, setManagerAssignments] = useState<ManagerAssignment[]>([]);
  const [expandedManagerIds, setExpandedManagerIds] = useState<Set<string>>(() => new Set());
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('all');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [draftStartDate, setDraftStartDate] = useState('');
  const [draftEndDate, setDraftEndDate] = useState('');
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [telegramLinkUrl, setTelegramLinkUrl] = useState('');
  const [telegramLinked, setTelegramLinked] = useState<boolean | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClockNow(Date.now());
    }, 30000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!supabase || !inviteToken) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc('get_manager_invitation_details', { invitation_token: inviteToken });
      if (cancelled) return;
      if (error || !data?.length) {
        setMessage('This invitation link is invalid or unavailable.');
        return;
      }
      const details = data[0] as InvitationDetails;
      setInviteDetails(details);
      setEmail(details.corporate_email);
      const savedTicket = sessionStorage.getItem('mbp_registration_ticket_' + inviteToken) || '';
      const savedChallenge = sessionStorage.getItem('mbp_invite_challenge_' + inviteToken) || '';
      if (savedChallenge) {
        setInviteChallenge(savedChallenge);
      }
      if (savedTicket) {
        setRegistrationTicket(savedTicket);
        setInviteTelegramVerified(true);
        setInvitePasswordStep(true);
      }
      if (!details.valid) setMessage('This invitation has expired or has already been used.');
    })();
    return () => { cancelled = true; };
  }, [inviteToken]);

  const loadDashboard = useCallback(async (userId: string) => {
    if (!supabase) return;
    setLoadingDashboard(true);

    try {
      const profileResult = await supabase
        .from('profiles')
        .select('id, email, full_name, role, active')
        .eq('id', userId)
        .maybeSingle();

      if (profileResult.error) {
        setProfile(null);
        setMessage(`Could not load account role: ${profileResult.error.message}`);
        return;
      }

      let currentProfile = profileResult.data as Profile | null;
      if (inviteToken && !inviteRedeemed && currentProfile?.active) {
        const { data: authResult } = await supabase.auth.getUser();
        const ticket = typeof authResult.user?.user_metadata?.registration_ticket === 'string'
          ? authResult.user.user_metadata.registration_ticket
          : sessionStorage.getItem('mbp_registration_ticket_' + inviteToken) || '';
        if (ticket) {
          const { error: inviteError } = await supabase.rpc('redeem_manager_invitation', {
            invitation_token: inviteToken,
            registration_ticket: ticket,
          });
          if (inviteError) {
            setMessage('Invitation could not be redeemed: ' + inviteError.message);
          } else {
            setInviteRedeemed(true);
            sessionStorage.removeItem('mbp_registration_ticket_' + inviteToken);
            sessionStorage.removeItem('mbp_invite_challenge_' + inviteToken);
            await supabase.auth.updateUser({ data: { registration_ticket: null } });
            setMessage('Invitation accepted. Your verified Telegram identity and manager relationship are now active.');
            const refreshed = await supabase.from('profiles').select('id, email, full_name, role, active').eq('id', userId).maybeSingle();
            if (!refreshed.error && refreshed.data) currentProfile = refreshed.data as Profile;
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } else {
          setMessage('Before this invitation can be accepted, complete Telegram verification on the invitation page and register using the invited corporate email.');
        }
      }
      setProfile(currentProfile);
      // The auth function is the source of truth for Telegram-account linkage.
      try {
        const { data: telegramStatus } = await supabase.functions.invoke('telegram-auth', { body: { action: 'link_status' } });
        setTelegramLinked(telegramStatus?.ok === true && telegramStatus?.linked === true ? true : telegramStatus?.ok === true && telegramStatus?.linked === false ? false : null);
      } catch {
        setTelegramLinked(null);
      }
      const isAdmin = currentProfile?.active === true &&
        String(currentProfile.role).toLowerCase() === 'admin';

      if (isAdmin) {
        const [peopleResult, attendanceResult, assignmentsResult] = await Promise.all([
          supabase.from('profiles')
            .select('id, email, full_name, role, active')
            .order('full_name', { ascending: true })
            .limit(500),
          supabase.from('attendance')
            .select('id, employee_id, check_in, check_out, check_in_lat, check_in_lng, check_out_lat, check_out_lng, work_date, work_timezone')
            .order('check_in', { ascending: false })
            .limit(1000),
          supabase.from('manager_employee_assignments')
            .select('manager_id, employee_id')
            .limit(2000),
        ]);

        if (peopleResult.error) {
          setProfiles([]);
          setMessage(`Could not load employee list: ${peopleResult.error.message}`);
        } else {
          setProfiles((peopleResult.data ?? []) as Profile[]);
        }

        if (attendanceResult.error) {
          setAttendance([]);
          setMessage(current => current || `Could not load team attendance: ${attendanceResult.error.message}`);
        } else {
          setAttendance((attendanceResult.data ?? []) as Attendance[]);
        }
        if (assignmentsResult.error) {
          setManagerAssignments([]);
          setMessage(current => current || `Could not load reporting hierarchy: ${assignmentsResult.error.message}`);
        } else {
          setManagerAssignments((assignmentsResult.data ?? []) as ManagerAssignment[]);
        }
        setShifts([]);
      } else {
        setProfiles([]);
        setManagerAssignments([]);
        setExpandedManagerIds(new Set());
        const [attendanceResult, shiftsResult] = await Promise.all([
          supabase.from('attendance')
            .select('id, check_in, check_out, work_date, work_timezone')
            .eq('employee_id', userId)
            .order('check_in', { ascending: false })
            .limit(100),
          supabase.from('shifts')
            .select('id, starts_at, ends_at')
            .eq('employee_id', userId)
            .order('starts_at', { ascending: true })
            .limit(100),
        ]);

        if (attendanceResult.error) setMessage(`Could not load attendance: ${attendanceResult.error.message}`);
        else setAttendance((attendanceResult.data ?? []) as Attendance[]);
        if (shiftsResult.error) setMessage(current => current || `Could not load shifts: ${shiftsResult.error.message}`);
        else setShifts((shiftsResult.data ?? []) as Shift[]);
      }
    } catch {
      setMessage('Unable to load dashboard data. Please refresh.');
    } finally {
      setLoadingDashboard(false);
    }
  }, [inviteToken, inviteRedeemed]);

  useEffect(() => {
    if (!supabase) {
      setScreen('login');
      return;
    }

    let alive = true;

    const applySession = (nextSession: Session | null) => {
      if (!alive) return;

      setSession(nextSession);

      if (nextSession?.user.email) {
        setEmail(nextSession.user.email);
      }

      if (nextSession && passwordFlow) {
        setScreen('set-password');
      } else if (nextSession) {
        setScreen('signed-in');
        void loadDashboard(nextSession.user.id);
      } else {
        setScreen('login');
      }
    };

    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) setMessage(error.message);
      applySession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!alive) return;

      if (event === 'PASSWORD_RECOVERY') {
        setPasswordFlow('recovery');
        setSession(nextSession);
        setScreen('set-password');
        return;
      }

      if (event === 'SIGNED_IN' && passwordFlow === 'invite') {
        setSession(nextSession);
        if (nextSession?.user.email) setEmail(nextSession.user.email);
        setScreen('set-password');
        return;
      }

      if (event === 'SIGNED_OUT') {
        setSession(null);
        setScreen('login');
        setAttendance([]);
        setShifts([]);
        return;
      }

      applySession(nextSession);
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [loadDashboard, passwordFlow]);

  async function handleStartInviteTelegram() {
    if (!supabase || !inviteToken || !inviteDetails?.valid) return;
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await supabase.functions.invoke('telegram-auth', {
        body: { action: 'create_invite_telegram_challenge', invitation_token: inviteToken },
      });
      if (error || !data?.ok || !data?.bot_url) {
        setMessage(data?.error || error?.message || 'Unable to start Telegram verification.');
        return;
      }
      const challenge = new URL(data.bot_url).searchParams.get('start') || '';
      setInviteChallenge(challenge);
      sessionStorage.setItem('mbp_invite_challenge_' + inviteToken, challenge);
      setInviteTelegramVerified(false);
      setInviteOtp('');
      setMessage('Telegram opened. Press Start in the bot; your verification code will appear in that chat.');
      window.location.assign(data.bot_url);
    } catch (error) {
      setMessage('Unable to start Telegram verification: ' + getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyInviteTelegram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !inviteToken || !inviteChallenge) return;
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await supabase.functions.invoke('telegram-auth', {
        body: { action: 'verify_invite_telegram_otp', invitation_token: inviteToken, challenge: inviteChallenge, otp: inviteOtp },
      });
      if (error || !data?.ok || !data?.registration_ticket) {
        setMessage(data?.error || error?.message || 'Telegram verification failed.');
        return;
      }
      setRegistrationTicket(data.registration_ticket);
      sessionStorage.setItem('mbp_registration_ticket_' + inviteToken, data.registration_ticket);
      setInviteTelegramVerified(true);
      setInvitePasswordStep(true);
      setInviteOtp('');
      setMessage('Telegram verified. Create and confirm your password to finish registration.');
    } catch (error) {
      setMessage('Telegram verification failed: ' + getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !inviteToken) return;
    const normalizedEmail = email.trim().toLowerCase();
    const ticket = registrationTicket || sessionStorage.getItem('mbp_registration_ticket_' + inviteToken) || '';
    if (!inviteDetails?.valid) {
      setMessage('This invitation is invalid, expired, or already used.');
      return;
    }
    if (!inviteTelegramVerified || !ticket) {
      setMessage('Verify your Telegram account with @mbpauthbot before registering.');
      return;
    }
    if (normalizedEmail !== inviteDetails.corporate_email.trim().toLowerCase()) {
      setMessage('Use the exact corporate email assigned by your inviter: ' + inviteDetails.corporate_email);
      return;
    }
    if (!isApprovedEmail(normalizedEmail)) {
      setMessage('This email address is not on the approved account list.');
      return;
    }
    if (password.length < 8) {
      setMessage('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setMessage('The passwords do not match. Please confirm your password.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const redirectTo = window.location.origin + window.location.pathname + '?invite=' + encodeURIComponent(inviteToken);
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { emailRedirectTo: redirectTo, data: { full_name: inviteDetails.admin_panel_name, admin_panel_name: inviteDetails.admin_panel_name, invitation_token: inviteToken, registration_ticket: ticket } },
      });
      if (error) setMessage('Registration failed: ' + error.message);
      else if (data.session && data.user) {
        setMessage('Account created. Finishing sign-in and redeeming your invitation…');
      } else {
        setMessage('Registration started. Confirm your email using the link sent to you, then return to this invitation link and sign in to redeem it.');
      }
    } catch {
      setMessage('Registration could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    const normalizedEmail = email.trim().toLowerCase();

    if (!isApprovedEmail(normalizedEmail)) {
      setMessage('This email address is not on the approved account list.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        setMessage(error.message);
      } else {
        setPassword('');
        setPasswordFlow(null);
        setMessage('Signed in successfully.');
      }
    } catch {
      setMessage('Unable to sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestTelegramCode() {
    if (!supabase) return;

    const normalizedEmail = email.trim().toLowerCase();

    if (!isApprovedEmail(normalizedEmail)) {
      setMessage('Enter an approved work email address first.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { data, error } = await supabase.functions.invoke('telegram-auth', {
        body: {
          action: 'request_login_code',
          email: normalizedEmail,
        },
      });

      if (error) {
        setMessage(`Could not request a Telegram code: ${error.message}`);
        return;
      }

      if (data?.ok) {
        setOtpRequested(true);
        setTelegramOtp('');
        setMessage(
          data.message ||
            'If this is an active account with linked Telegram, a login code will be sent shortly.'
        );
      } else {
        setMessage(data?.error || 'Unable to request a Telegram code. Please try again.');
      }
    } catch (error) {
      setMessage(`Could not request a Telegram code: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyTelegramCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    const normalizedEmail = email.trim().toLowerCase();
    const code = telegramOtp.trim();

    if (!isApprovedEmail(normalizedEmail)) {
      setMessage('Enter an approved work email address first.');
      return;
    }

    if (!/^\d{6,10}$/.test(code)) {
      setMessage('Enter the numeric login code sent to your Telegram.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: code,
        type: 'email',
      });

      if (error || !data.session) {
        setMessage(error?.message || 'The code could not be verified. Request a new code and try again.');
        return;
      }

      setSession(data.session);
      setPasswordFlow(null);
      setTelegramOtp('');
      setOtpRequested(false);
      setMessage('Signed in successfully with Telegram.');
      setScreen('signed-in');
      await loadDashboard(data.session.user.id);
    } catch (error) {
      setMessage(`Unable to verify the Telegram code: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    if (password.length < 8) {
      setMessage('Use a password with at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setMessage('The passwords do not match.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const { data, error: userError } = await supabase.auth.getUser();

      if (userError || !data.user) {
        setMessage(
          'Your invitation session has expired. Ask the administrator for a new invitation.'
        );
        return;
      }

      if (
        !data.user.email ||
        !isApprovedEmail(data.user.email)
      ) {
        setMessage('This account email is not approved for this application.');
        return;
      }

      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setMessage(error.message);
        return;
      }

      setEmail(data.user.email ?? email);
      setPassword('');
      setConfirmPassword('');
      setPasswordFlow(null);

      const { error: signOutError } = await supabase.auth.signOut();

      if (signOutError) {
        setMessage(
          'Password saved. Please sign out and log in with your new password.'
        );
        return;
      }

      window.history.replaceState({}, document.title, window.location.pathname);
      setScreen('login');
      setMessage('Password created. Please sign in with your new password.');
    } catch {
      setMessage('Unable to save the password. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTelegramLink() {
    if (!supabase || !session) {
      setMessage('Please sign in before linking Telegram.');
      return;
    }

    setBusy(true);
    setMessage('');
    setTelegramLinkUrl('');

    try {
      const { data, error } = await supabase.functions.invoke('telegram-auth', {
        body: { action: 'create_link_token' },
      });

      if (error) {
        let details = error.message || 'The request failed.';
        try {
          const responseText = await error.context?.text?.();
          if (responseText) {
            const parsed = JSON.parse(responseText);
            if (typeof parsed?.error === 'string') details = parsed.error;
          }
        } catch {
          // Keep the original function error message.
        }
        setMessage(`Could not create a Telegram linking link: ${details}`);
        return;
      }

      if (data?.ok !== true || typeof data?.bot_url !== 'string') {
        setMessage(
          typeof data?.error === 'string'
            ? data.error
            : 'The server did not return a valid Telegram linking link.',
        );
        return;
      }

      setTelegramLinkUrl(data.bot_url);
      setMessage(
        'Your Telegram linking link is ready. Open it in Telegram within 10 minutes. This link can be used only once.',
      );
    } catch (error) {
      setMessage(`Unable to request a Telegram link: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }


  async function handleCheckIn() {
    if (!supabase || !session) return;

    setBusy(true);
    setMessage('');

    try {
      let coords: Coordinates;

      try {
        coords = await getLocation();
      } catch (error) {
        setMessage(
          `Check-in blocked: GPS location is required. ${getErrorMessage(error)} Allow location access and try again.`
        );
        return;
      }

      const { data: timezoneData, error: timezoneError } =
        await supabase.functions.invoke('resolve-timezone', {
          body: {
            latitude: coords.latitude,
            longitude: coords.longitude,
          },
        });

      if (timezoneError) {
        setMessage(
          `Could not determine your timezone: ${timezoneError.message}`
        );
        return;
      }

      const timezone = timezoneData?.timezone;

      if (typeof timezone !== 'string' || !timezone.trim()) {
        setMessage(
          'The timezone service did not return a valid timezone. Check-in was not recorded.'
        );
        return;
      }

      const { error: checkInError } = await supabase.rpc(
        'check_in_with_timezone',
        {
          p_latitude: coords.latitude,
          p_longitude: coords.longitude,
          p_timezone: timezone,
        }
      );

      if (checkInError) {
        setMessage(`Check-in failed: ${checkInError.message}`);
        return;
      }

      setMessage(`Check-in recorded successfully. Timezone: ${timezone}.`);
      await loadDashboard(session.user.id);
    } catch (error) {
      setMessage(`Unable to check in: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckOut(attendanceId: string) {
    if (!supabase || !session) return;

    setBusy(true);
    setMessage('');

    try {
      let coords: Coordinates;

      try {
        coords = await getLocation();
      } catch (error) {
        setMessage(
          `Check-out blocked: GPS location is required. ${getErrorMessage(error)} Allow location access and try again.`
        );
        return;
      }

      const { error } = await supabase.rpc('check_out_attendance', {
        p_attendance_id: attendanceId,
        p_latitude: coords.latitude,
        p_longitude: coords.longitude,
      });

      if (error) {
        setMessage(`Check-out failed: ${error.message}`);
        return;
      }

      setMessage('Check-out recorded successfully with GPS coordinates.');
      await loadDashboard(session.user.id);
    } catch (error) {
      setMessage(`Unable to check out: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    if (!supabase) return;

    setMapPreview(null);
    setAttendance([]); setShifts([]); setProfiles([]); setManagerAssignments([]); setExpandedManagerIds(new Set()); setProfile(null);
    setReportStartDate(''); setReportEndDate(''); setDraftStartDate(''); setDraftEndDate('');
    setBusy(true);
    setMessage('');

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        setMessage(error.message);
        return;
      }

      setSession(null);
      setPassword('');
      setConfirmPassword('');
      setTelegramOtp('');
      setOtpRequested(false);
      setPasswordFlow(null);
      setScreen('login');
      setMessage('You have signed out.');
    } catch {
      setMessage('Unable to sign out. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const pageStyle: React.CSSProperties = {
    minHeight: '100vh',
    padding: 20,
    boxSizing: 'border-box',
    background: '#0b0b0c',
    color: '#f7f7f5',
    fontFamily: 'Arial, Helvetica, sans-serif',
  };

  function handleExportCsv() {
    const rows = [
      ['Employee', 'Employee email', 'Work date', 'Check-in', 'Check-out', 'Status', 'Elapsed minutes', 'Worked minutes', 'Timezone', 'Check-in map', 'Check-out map'],
      ...reportAttendance.map((item) => {
        const person = profiles.find((p) => p.id === item.employee_id);
        const start = new Date(item.check_in).getTime();
        const end = item.check_out ? new Date(item.check_out).getTime() : NaN;
        const elapsedMinutes = Number.isFinite(start) && Number.isFinite(end) && end >= start
          ? Math.floor((end - start) / 60000)
          : '';
        const workedMinutes = elapsedMinutes === '' ? '' : Math.max(0, Number(elapsedMinutes) - BREAK_MINUTES);
        const checkInMap = item.check_in_lat != null && item.check_in_lng != null
          ? `https://www.google.com/maps?q=${item.check_in_lat},${item.check_in_lng}`
          : '';
        const checkOutMap = item.check_out_lat != null && item.check_out_lng != null
          ? `https://www.google.com/maps?q=${item.check_out_lat},${item.check_out_lng}`
          : '';
        const workDate = item.work_date ?? (item.work_timezone
          ? getLocalDate(item.work_timezone, new Date(item.check_in))
          : item.check_in.slice(0, 10));
        return [
          person?.full_name || person?.email || item.employee_id || 'Unknown employee',
          person?.email || '',
          workDate,
          formatDate(item.check_in, item.work_timezone),
          item.check_out ? formatDate(item.check_out, item.work_timezone) : '',
          item.check_out ? 'Checked out' : 'Open session',
          elapsedMinutes,
          workedMinutes,
          item.work_timezone || '',
          checkInMap,
          checkOutMap,
        ];
      }),
    ];
    const csv = '\uFEFF' + rows.map((row) => row.map((value) => csvCell(value as string | number | null | undefined)).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const start = reportStartDate || 'all-dates';
    const end = reportEndDate || 'all-dates';
    link.href = url;
    link.download = `attendance-report-${start}-to-${end}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const panelStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 1440,
    margin: '24px auto',
    padding: 24,
    boxSizing: 'border-box',
    borderRadius: 3,
    border: '1px solid #34302c',
    background: '#151413',
  };

  const inputStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    marginTop: 7,
    padding: 12,
    border: '1px solid #475467',
    borderRadius: 2,
    background: '#0b0b0c',
    color: '#fff',
    fontSize: 16,
  };

  const buttonStyle: React.CSSProperties = {
    padding: '12px 16px',
    border: 0,
    borderRadius: 2,
    background: '#c4511b',
    color: '#fff',
    fontSize: 15,
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.7 : 1,
  };

  // Only today's open session in its own saved timezone is the active session.
  // Older open sessions remain in history and are not automatically checked out.
  const normalizedRole = String(profile?.role || '').toLowerCase().replaceAll('_', ' ');
  const isAdmin = profile?.active === true && normalizedRole === 'admin';
  const canManageTeam = profile?.active === true && ['junior', 'middle', 'senior', 'team leader'].includes(normalizedRole);
  const selectedAttendance = isAdmin && selectedEmployeeId !== 'all'
    ? attendance.filter(item => item.employee_id === selectedEmployeeId)
    : attendance;
  const reportAttendance = selectedAttendance.filter((item) => {
    const date = item.work_date ?? (item.work_timezone
      ? getLocalDate(item.work_timezone, new Date(item.check_in))
      : item.check_in.slice(0, 10));
    if (reportStartDate && date < reportStartDate) return false;
    if (reportEndDate && date > reportEndDate) return false;
    return true;
  });

  const completedReportRecords = reportAttendance.filter((item) => item.check_out);
  const reportWorkedMilliseconds = completedReportRecords.reduce((total, item) => {
    const start = new Date(item.check_in).getTime();
    const end = item.check_out ? new Date(item.check_out).getTime() : start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return total;
    return total + Math.max(0, end - start - BREAK_MINUTES * 60000);
  }, 0);
  const reportOpenSessions = reportAttendance.filter((item) => !item.check_out).length;

  const openRecord = attendance
    .filter((item) => {
      if (item.check_out || !item.work_date || !item.work_timezone) {
        return false;
      }

      try {
        return getLocalDate(item.work_timezone, new Date(clockNow)) === item.work_date;
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.check_in.localeCompare(a.check_in))[0];

  if (!supabase) {
    return (
      <main style={pageStyle}>
        <section style={{ ...panelStyle, maxWidth: 430 }}>
          <h1>Attendance CRM</h1>
          <p>Supabase is not configured. Check the GitHub Actions secrets.</p>
        </section>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <style>{`@media (max-width: 760px) { .crm-layout { display:block !important; } .crm-sidebar { position:relative !important; top:auto !important; min-height:0 !important; width:auto !important; margin-bottom:12px; padding:8px !important; } .crm-sidebar nav { flex-direction:row !important; flex-wrap:wrap; gap:4px !important; } .crm-sidebar nav button { width:auto !important; flex:1 1 auto; min-width:44px; justify-content:center !important; padding:9px !important; gap:6px !important; font-size:0; } .crm-sidebar nav button svg { flex-shrink:0; } .crm-menu-label { display:none !important; } .crm-sidebar > button[title="Sign out"] { width:auto !important; min-height:40px !important; padding:8px !important; } .crm-sidebar > div:first-child { margin-bottom:8px !important; } .crm-layout > :not(.crm-sidebar) { min-width:0; } .crm-layout table { max-width:100%; } } @media (max-width: 480px) { main { padding:10px !important; } .crm-layout { gap:8px !important; } .crm-layout section { padding:12px !important; } .crm-layout input[type=date] { font-size:16px; min-height:44px; } }`}</style>
      <header style={{ maxWidth: 1440, margin: '0 auto' }}>
        <p style={{ color: '#82b4ff', fontWeight: 700 }}>ATTENDANCE CRM</p>
      </header>

      {screen === 'loading' && (
        <section style={panelStyle}>Checking your session…</section>
      )}

      {screen === 'login' && (
        <section style={{ ...panelStyle, maxWidth: 430 }}>
          {!inviteToken && <>
          <h1>Welcome back</h1>
          <p style={{ color: '#b7c0d1' }}>
            Sign in with your approved account.
          </p>

          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={inputStyle}
          />

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleRequestTelegramCode()}
            style={{ ...buttonStyle, width: '100%', marginTop: 16 }}
          >
            {busy ? 'Please wait…' : 'Send login code to Telegram'}
          </button>

          {otpRequested && (
            <form onSubmit={handleVerifyTelegramCode}>
              <label
                htmlFor="telegram-otp"
                style={{ display: 'block', marginTop: 18 }}
              >
                Telegram login code
              </label>
              <input
                id="telegram-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6,10}"
                maxLength={10}
                required
                value={telegramOtp}
                onChange={(event) => setTelegramOtp(event.target.value.replace(/\D/g, ''))}
                style={inputStyle}
              />
              <button
                type="submit"
                disabled={busy}
                style={{ ...buttonStyle, width: '100%', marginTop: 12 }}
              >
                {busy ? 'Verifying…' : 'Verify code and sign in'}
              </button>
            </form>
          )}

          <details style={{ marginTop: 24 }}>
            <summary style={{ cursor: 'pointer', color: '#b7c0d1' }}>
              Use password instead
            </summary>
            <form onSubmit={handleLogin}>
              <label
                htmlFor="login-password"
                style={{ display: 'block', marginTop: 16 }}
              >
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={inputStyle}
              />
              <button
                type="submit"
                disabled={busy}
                style={{ ...buttonStyle, width: '100%', marginTop: 16 }}
              >
                {busy ? 'Signing in…' : 'Sign in with password'}
              </button>
            </form>
          </details>
          </>}
          {inviteToken && <div style={{marginTop:4}}>
            <h1 style={{fontSize:26,marginBottom:8}}>Complete your invitation</h1>
            {inviteDetails ? <>
              <div style={{padding:12,margin:'12px 0',border:'1px solid #475467',borderRadius:8,background:'#151413'}}>
                <p style={{margin:'4px 0'}}> <strong>Admin Panel Name:</strong> {inviteDetails.admin_panel_name}</p>
                <p style={{margin:'4px 0',overflowWrap:'anywhere'}}><strong>Corporate Email:</strong> {inviteDetails.corporate_email}</p>
                <p style={{margin:'4px 0'}}><strong>Assigned role:</strong> {inviteDetails.invited_role.replaceAll('_',' ')}</p>
              </div>
              {!inviteDetails.valid ? <p style={{color:'#fda29b'}}>This invitation is expired or has already been used.</p> : <>
                {!invitePasswordStep ? <>
                  <p style={{color:'#b7c0d1',fontSize:13}}>Verify the Telegram account belonging to this employee before creating the CRM account.</p>
                  {!inviteTelegramVerified ? <button type="button" onClick={handleStartInviteTelegram} disabled={busy} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:10,width:'100%',marginTop:8,padding:'13px 18px',border:0,borderRadius:999,background:'#229ED9',color:'#fff',fontWeight:700,fontSize:16,cursor:busy?'wait':'pointer',boxShadow:'0 4px 12px rgba(34,158,217,.25)'}}><MessageCircle size={20}/>{busy?'Opening Telegram…':'Authenticate with Telegram'}<span aria-hidden="true">↗</span></button> : null}
                  {inviteChallenge && !inviteTelegramVerified && <form onSubmit={handleVerifyInviteTelegram} style={{marginTop:14}}>
                    <label htmlFor="invite-telegram-otp">Six-digit code from Telegram</label>
                    <input id="invite-telegram-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={inviteOtp} onChange={event=>setInviteOtp(event.target.value.replace(/\D/g,'').slice(0,6))} style={inputStyle}/>
                    <button type="submit" disabled={busy || inviteOtp.length!==6} style={{...buttonStyle,width:'100%',marginTop:10}}>Verify Telegram</button>
                  </form>}
                </> : <>
                  <p style={{color:'#86efac'}}>Telegram identity verified.</p>
                  <form onSubmit={handleRegister} style={{marginTop:16}}>
                    <label htmlFor="register-email">Corporate email</label>
                    <input id="register-email" type="email" autoComplete="email" required readOnly value={inviteDetails.corporate_email} onChange={event=>setEmail(event.target.value)} style={inputStyle}/>
                    <label htmlFor="register-password" style={{display:'block',marginTop:12}}>Create password (at least 8 characters)</label>
                    <input id="register-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event=>setPassword(event.target.value)} style={inputStyle}/>
                    <label htmlFor="register-confirm-password" style={{display:'block',marginTop:12}}>Confirm password</label>
                    <input id="register-confirm-password" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} style={inputStyle}/>
                    <button type="submit" disabled={busy || !inviteTelegramVerified} style={{...buttonStyle,width:'100%',marginTop:14}}>{busy?'Creating account…':'Complete registration'}</button>
                  </form>
                </>}
                <p style={{textAlign:'center',marginTop:24,color:'#b7c0d1',fontSize:13}}>Already registered? <a href={window.location.pathname} style={{color:'#82b4ff'}}>Sign in</a></p>
              </>}
            </> : <p style={{color:'#b7c0d1'}}>Loading invitation details…</p>}
          </div>}
        </section>
      )}

      {screen === 'set-password' && (
        <section style={{ ...panelStyle, maxWidth: 430 }}>
          <h1>Create your password</h1>
          <p style={{ color: '#b7c0d1' }}>
            Create a password for your invited account.
          </p>

          <form onSubmit={handleSetPassword}>
            <label htmlFor="invited-email">Invited email</label>
            <input
              id="invited-email"
              type="email"
              value={email}
              readOnly
              style={inputStyle}
            />

            <label
              htmlFor="new-password"
              style={{ display: 'block', marginTop: 18 }}
            >
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={inputStyle}
            />

            <label
              htmlFor="confirm-password"
              style={{ display: 'block', marginTop: 18 }}
            >
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              style={inputStyle}
            />

            <button
              type="submit"
              disabled={busy}
              style={{ ...buttonStyle, width: '100%', marginTop: 20 }}
            >
              {busy ? 'Saving password…' : 'Create password'}
            </button>
          </form>
        </section>
      )}

      {screen === 'signed-in' && session && (
        <div className="crm-layout" style={{display:'grid',gridTemplateColumns:navOpen?'250px minmax(0,1fr)':'64px minmax(0,1fr)',gap:18,alignItems:'start',width:'100%',maxWidth:1600,margin:'0 auto'}}>
          <aside className={`crm-sidebar ${navOpen ? 'is-open' : ''}`} style={{position:'sticky',top:12,alignSelf:'start',minHeight:'calc(100vh - 24px)',padding:12,background:'#151413',border:'1px solid #344054',borderRadius:4,color:'#dce4f2'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:navOpen?'space-between':'center',gap:8,marginBottom:20,color:'#fff',fontWeight:700}}>{navOpen&&<span>Partner CRM</span>}<button type="button" aria-label="Toggle sidebar" onClick={()=>setNavOpen(v=>!v)} style={{display:'grid',placeItems:'center',width:40,height:40,border:'1px solid #344054',borderRadius:9,background:'#201a16',color:'#fff',cursor:'pointer'}}>{navOpen?<X size={20}/>:<Menu size={20}/>}</button></div>
            <nav aria-label="CRM pages" style={{display:'flex',flexDirection:'column',gap:6}}>
              {[{label:'Dashboard',icon:<LayoutDashboard size={18}/>,id:'dashboard' as CrmPage},{label:'Attendance & reports',icon:<CalendarDays size={18}/>,id:'attendance' as CrmPage},{label:'Team management',icon:<Users size={18}/>,id:'team' as CrmPage},{label:'Telegram chats & analytics',icon:<MessageCircle size={18}/>,id:'telegram' as CrmPage},{label:'Security',icon:<ShieldAlert size={18}/>,id:'security' as CrmPage}].filter(item=>item.id==='dashboard'||item.id==='attendance'||(item.id==='security'&&isAdmin)||(item.id==='team'&&(isAdmin||canManageTeam))||(item.id==='telegram'&&(isAdmin||canManageTeam))).map(item=><button key={item.id} type="button" title={item.label} onClick={()=>{setActivePage(item.id);setMapPreview(null);setNavOpen(false);window.scrollTo(0,0)}} style={{display:'flex',alignItems:'center',justifyContent:navOpen?'flex-start':'center',gap:12,width:'100%',padding:12,textAlign:'left',border:0,borderRadius:9,background:activePage===item.id?'#7c3216':'transparent',color:activePage===item.id?'#fff':'#cbd5e1',cursor:'pointer'}}>{item.icon}{navOpen&&<span className="crm-menu-label">{item.label}</span>}</button>)}
            </nav>
            <button type="button" title="Sign out" aria-label="Sign out" disabled={busy} onClick={() => void handleLogout()} style={{display:'flex',alignItems:'center',justifyContent:navOpen?'flex-start':'center',gap:12,width:'100%',padding:12,marginTop:18,border:'1px solid #7c3216',borderRadius:2,background:'#c4511b',color:'#fff',fontWeight:700,cursor:busy?'wait':'pointer'}}><LogOut size={18}/>{navOpen&&(busy?'Please wait…':'Sign out')}</button>
            {navOpen&&<div style={{marginTop:18,color:'#98a2b3',fontSize:12,overflowWrap:'anywhere'}}>{profile?.full_name||session.user.email}</div>}
          </aside>
          <main style={{minWidth:0}}>
          <section style={panelStyle}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:18,color:'#98a2b3',fontSize:13}}>Partner CRM / <strong style={{color:'#fff'}}>{{dashboard:'Dashboard',attendance:'Attendance & reports',team:'Team management',telegram:'Telegram chats & analytics',security:'Security'}[activePage]}</strong></div>
          {activePage === 'dashboard' && <>
          <h1>{isAdmin ? 'Admin attendance dashboard' : 'Employee dashboard'}</h1>
          <p
            style={{
              color: '#b7c0d1',
              overflowWrap: 'anywhere',
            }}
          >
            Signed in as {profile?.full_name || session.user.email} · {profile?.role || 'Role unavailable'}
          </p>

          {isAdmin && (
            <section style={{ padding: 18, margin: '20px 0', borderRadius: 12, border: '1px solid #344054' }}>
              <h2 style={{ marginTop: 0 }}>Team overview</h2>
              <p style={{ color: '#b7c0d1' }}>Attendance visibility is controlled by Supabase access policies.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <article style={{ padding: 14, border: '1px solid #344054', borderRadius: 10 }}>
                  <div style={{ color: '#b7c0d1' }}>Active employees</div>
                  <strong style={{ fontSize: 24 }}>{profiles.filter(person => person.active && String(person.role).toLowerCase() !== 'admin').length}</strong>
                </article>
                <article style={{ padding: 14, border: '1px solid #344054', borderRadius: 10 }}>
                  <div style={{ color: '#b7c0d1' }}>Open sessions</div>
                  <strong style={{ fontSize: 24 }}>{attendance.filter(item => !item.check_out).length}</strong>
                </article>
                <article style={{ padding: 14, border: '1px solid #344054', borderRadius: 10 }}>
                  <div style={{ color: '#b7c0d1' }}>Loaded records</div>
                  <strong style={{ fontSize: 24 }}>{attendance.length}</strong>
                </article>
              </div>
            </section>
          )}

          {!isAdmin && <section
            style={{
              padding: 18,
              margin: '20px 0',
              borderRadius: 3,
              border: '1px solid #34302c',
            }}
          >
            <h2 style={{ marginTop: 0 }}>Telegram account</h2>
            <p style={{ color: telegramLinked === true ? '#86efac' : '#d1cbc5' }}>
              {telegramLinked === true
                ? '✓ Telegram is linked to your account. You can use Telegram login from the sign-in screen.'
                : telegramLinked === false
                  ? 'Telegram is not linked to your account yet. Create a link below to connect it.'
                  : 'Unable to verify Telegram link status right now. You can refresh the page or create a link if you have not linked Telegram yet.'}
            </p>
            {telegramLinked !== true && <button
              type="button"
              disabled={busy || loadingDashboard}
              onClick={() => void handleCreateTelegramLink()}
              style={buttonStyle}
            >
              {busy ? 'Please wait…' : 'Create Telegram linking link'}
            </button>}
            {telegramLinkUrl && (
              <div style={{ marginTop: 14 }}>
                <a
                  href={telegramLinkUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-block',
                    padding: '10px 14px',
                    borderRadius: 2,
                    background: '#c4511b',
                    color: '#fff',
                    textDecoration: 'none',
                    fontWeight: 600,
                    overflowWrap: 'anywhere',
                  }}
                >
                  Open Telegram to link account
                </a>
                <p
                  style={{
                    color: '#b7c0d1',
                    fontSize: 13,
                    overflowWrap: 'anywhere',
                  }}
                >
                  The link contains a temporary one-time token. Do not share it.
                  If it expires, request a new one.
                </p>
              </div>
            )}
          </section>}

          {!isAdmin && <section
            style={{
              padding: 18,
              margin: '20px 0',
              borderRadius: 12,
              border: '1px solid #344054',
            }}
          >
            <h2 style={{ marginTop: 0 }}>Attendance session</h2>

            {openRecord ? (
              <>
                <p>
                  Check-in:{' '}
                  {formatDate(openRecord.check_in, openRecord.work_timezone)}
                </p>
                <p style={{ color: '#b7c0d1' }}>
                  Work date: {openRecord.work_date}
                  {' · '}
                  {openRecord.work_timezone}
                </p>
                <p>
                  Elapsed time:{' '}
                  <strong>
                    {getSessionDuration(openRecord, clockNow).elapsed}
                  </strong>
                </p>
                <p style={{ color: '#b7c0d1' }}>
                  Final worked time and break deduction will be calculated after
                  checkout.
                </p>
                <p>
                  Status: <strong>Not checked out</strong>
                </p>

                <button
                  disabled={busy || loadingDashboard}
                  onClick={() => void handleCheckOut(openRecord.id)}
                  style={buttonStyle}
                >
                  {busy ? 'Please wait…' : 'Check out'}
                </button>
              </>
            ) : (
              <>
                <p>
                  No open session was found for the current work date in its
                  saved timezone. Older open sessions remain in attendance
                  history and will not be closed automatically.
                </p>

                <button
                  disabled={busy || loadingDashboard}
                  onClick={() => void handleCheckIn()}
                  style={buttonStyle}
                >
                  {busy ? 'Processing…' : 'Check in'}
                </button>
              </>
            )}

            <p style={{ marginTop: 16, color: '#98a2b3', fontSize: 13 }}>
              Your browser will request location permission when you check in or out. Location is captured for that attendance action.
            </p>
          </section>}

          </>}
          {(isAdmin || canManageTeam) && activePage === 'team' && <ManagementTools supabase={supabase} profile={profile} profiles={profiles} page="team" />}
          {(isAdmin || canManageTeam) && activePage === 'telegram' && <><ManagementTools supabase={supabase} profile={profile} profiles={profiles} page="telegram" /><TelegramHumanInbox client={supabase} profile={profile} /></>}
          {isAdmin && activePage === 'security' && <SecurityActivityPanel />}

          {!isAdmin && <section style={{ marginTop: 28 }}>
            <h2>Scheduled shifts</h2>

            {loadingDashboard && <p>Loading shifts…</p>}

            {!loadingDashboard && shifts.length === 0 && (
              <p>No shifts are scheduled for this account yet.</p>
            )}

            {shifts.map((shift) => (
              <article
                key={shift.id}
                style={{
                  padding: 14,
                  marginBottom: 10,
                  border: '1px solid #344054',
                  borderRadius: 10,
                }}
              >
                <p style={{ margin: '0 0 6px' }}>
                  Start: {formatDate(shift.starts_at)}
                </p>
                <p style={{ margin: 0 }}>
                  End: {formatDate(shift.ends_at)}
                </p>
              </article>
            ))}
          </section>}

          {activePage === 'attendance' && <>
          <section style={{ marginTop: 28 }}>
            <h2>{isAdmin ? 'Team attendance report' : 'Attendance report'}</h2>
            <p style={{ color: '#b7c0d1' }}>
              {isAdmin ? 'Filter the latest team attendance records by employee and date.' : 'Filter the attendance records currently loaded for your account. This report uses the latest 100 records available to this dashboard.'}
            </p>
            {isAdmin && (
              <label style={{ display: 'block', maxWidth: 420, margin: '14px 0' }}>
                Employee
                <select value={selectedEmployeeId} onChange={event => setSelectedEmployeeId(event.target.value)} style={inputStyle}>
                  <option value="all">All employees</option>
                  {profiles.filter(person => String(person.role).toLowerCase() !== 'admin').map(person => (
                    <option key={person.id} value={person.id}>{person.full_name || person.email || person.id}{person.active ? '' : ' (inactive)'}</option>
                  ))}
                </select>
              </label>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '16px 0' }}>
              <label>
                From date
                <input
                  aria-label="Report start date"
                  type="date"
                  value={draftStartDate}
                  max={draftEndDate || undefined}
                  onChange={(event) => setDraftStartDate(event.target.value)}
                  onClick={(event) => { const input = event.currentTarget as HTMLInputElement & { showPicker?: () => void }; try { input.showPicker?.(); } catch { /* Native picker may require a direct gesture. */ } }}
                  style={{ ...inputStyle, colorScheme: 'dark', minWidth: 0 }}
                />
              </label>
              <label>
                To date
                <input
                  aria-label="Report end date"
                  type="date"
                  min={reportStartDate || undefined}
                  value={draftEndDate}
                  onChange={(event) => setDraftEndDate(event.target.value)}
                  onClick={(event) => { const input = event.currentTarget as HTMLInputElement & { showPicker?: () => void }; try { input.showPicker?.(); } catch { /* Native picker may require a direct gesture. */ } }}
                  style={{ ...inputStyle, colorScheme: 'dark', minWidth: 0 }}
                />
              </label>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
              <button type="button" style={buttonStyle} onClick={() => { if (draftStartDate && draftEndDate && draftStartDate > draftEndDate) { setMessage('The start date must be on or before the end date.'); return; } setReportStartDate(draftStartDate); setReportEndDate(draftEndDate); setMessage('Attendance dates applied.'); }}>
                Apply dates
              </button>
              <button type="button" style={{ ...buttonStyle, background: '#475467' }} onClick={() => { setDraftStartDate(''); setDraftEndDate(''); setReportStartDate(''); setReportEndDate(''); setMessage('Date filters cleared.'); }}>
                Clear dates
              </button>
              <button type="button" onClick={handleExportCsv} style={buttonStyle}>
                Export CSV for Excel
              </button>
              <button type="button" style={{ ...buttonStyle, background: '#475467' }} onClick={() => {
                const today = new Date();
                const end = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
                const startDate = new Date(today);
                startDate.setDate(startDate.getDate() - 6);
                const start = new Date(startDate.getTime() - startDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
                setDraftStartDate(start);
                setDraftEndDate(end);
                setReportStartDate(start);
                setReportEndDate(end);
              }}>
                Last 7 days
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 12, marginBottom: 20 }}>
              <article style={{ padding: 16, border: '1px solid #344054', borderRadius: 10 }}>
                <p style={{ color: '#b7c0d1', margin: '0 0 8px' }}>Records</p>
                <strong style={{ fontSize: 24 }}>{reportAttendance.length}</strong>
              </article>
              <article style={{ padding: 16, border: '1px solid #344054', borderRadius: 10 }}>
                <p style={{ color: '#b7c0d1', margin: '0 0 8px' }}>Completed shifts</p>
                <strong style={{ fontSize: 24 }}>{completedReportRecords.length}</strong>
              </article>
              <article style={{ padding: 16, border: '1px solid #344054', borderRadius: 10 }}>
                <p style={{ color: '#b7c0d1', margin: '0 0 8px' }}>Worked time*</p>
                <strong style={{ fontSize: 24 }}>{formatDuration(reportWorkedMilliseconds)}</strong>
              </article>
              <article style={{ padding: 16, border: '1px solid #344054', borderRadius: 10 }}>
                <p style={{ color: '#b7c0d1', margin: '0 0 8px' }}>Open sessions</p>
                <strong style={{ fontSize: 24 }}>{reportOpenSessions}</strong>
              </article>
            </div>
            <p style={{ color: '#98a2b3', fontSize: 12 }}>
              *Worked time totals completed shifts after the existing fixed one-hour break deduction. Open sessions are excluded from worked-time totals.
            </p>

            <h2 id="attendance-records" style={{ marginTop: 26 }}>Attendance records</h2>
            {loadingDashboard && <p>Loading attendance…</p>}

            {!loadingDashboard && reportAttendance.length === 0 && (
              <p>No attendance records match this date range.</p>
            )}

            {isAdmin && (() => {
              const today = getLocalDate(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
              const defaultStart = new Date(`${today}T12:00:00`);
              defaultStart.setDate(defaultStart.getDate() - 6);
              const startKey = reportStartDate || `${defaultStart.getFullYear()}-${String(defaultStart.getMonth()+1).padStart(2,'0')}-${String(defaultStart.getDate()).padStart(2,'0')}`;
              const endKey = reportEndDate || today;
              const dateKeys: string[] = [];
              const cursor = new Date(`${startKey}T12:00:00`);
              const finalDate = new Date(`${endKey}T12:00:00`);
              while (cursor <= finalDate && dateKeys.length < 93) {
                dateKeys.push(`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`);
                cursor.setDate(cursor.getDate()+1);
              }
              const allPeople = profiles.filter(person => String(person.role).toLowerCase() !== 'admin');
              const peopleById = new Map(allPeople.map(person => [person.id, person]));
              const childrenByManager = new Map<string, string[]>();
              managerAssignments.forEach(assignment => {
                if (!peopleById.has(assignment.manager_id) || !peopleById.has(assignment.employee_id)) return;
                const children = childrenByManager.get(assignment.manager_id) ?? [];
                if (!children.includes(assignment.employee_id)) children.push(assignment.employee_id);
                childrenByManager.set(assignment.manager_id, children);
              });
              const peopleWithParents = new Set(managerAssignments.map(assignment => assignment.employee_id));
              const topLevelRoles = new Set(['team_leader', 'senior', 'telemarketing']);
              const topLevelPeople = allPeople.filter(person =>
                topLevelRoles.has(String(person.role).toLowerCase()) && !peopleWithParents.has(person.id)
              );
              const visiblePeople: Array<{ person: Profile; depth: number; hasChildren: boolean }> = [];
              const appendBranch = (person: Profile, depth: number, path: Set<string>) => {
                if (path.has(person.id)) return;
                const childIds = childrenByManager.get(person.id) ?? [];
                visiblePeople.push({ person, depth, hasChildren: childIds.some(id => peopleById.has(id)) });
                if (!expandedManagerIds.has(person.id)) return;
                const nextPath = new Set(path);
                nextPath.add(person.id);
                childIds.forEach(id => {
                  const child = peopleById.get(id);
                  if (child) appendBranch(child, depth + 1, nextPath);
                });
              };
              if (selectedEmployeeId !== 'all') {
                const selectedPerson = peopleById.get(selectedEmployeeId);
                if (selectedPerson) visiblePeople.push({ person: selectedPerson, depth: 0, hasChildren: false });
              } else {
                topLevelPeople.forEach(person => appendBranch(person, 0, new Set()));
              }
              const people = visiblePeople;
              const timeOnly = (value: string | null, timezone: string | null) => value ? new Intl.DateTimeFormat(undefined, {hour:'2-digit',minute:'2-digit',hour12:false,...(timezone ? {timeZone:timezone} : {})}).format(new Date(value)) : '—';
              const gpsButton = (lat: number | null, lng: number | null, title: string) => lat != null && lng != null
                ? <button type="button" aria-label={title} title={title} onClick={() => setMapPreview({title,latitude:lat,longitude:lng})} style={{display:'inline-grid',placeItems:'center',width:23,height:23,padding:0,color:'#ff9b62',background:'#211711',border:'1px solid #7c3216',borderRadius:2,cursor:'pointer',verticalAlign:'middle'}}><MapPin size={14}/></button>
                : null;
              return <>
                <div style={{overflowX:'auto',border:'1px solid #38302a',marginTop:12}}>
                <table style={{borderCollapse:'separate',borderSpacing:0,width:'100%',minWidth:Math.max(620,180+dateKeys.length*154),textAlign:'left'}}>
                  <thead><tr style={{background:'#211711'}}>
                    <th style={{position:'sticky',left:0,zIndex:2,background:'#211711',padding:12,borderBottom:'1px solid #493023',minWidth:180}}>Employee</th>
                    {dateKeys.map(date => <th key={date} style={{padding:10,borderBottom:'1px solid #493023',whiteSpace:'nowrap',textAlign:'center'}}>{new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',day:'2-digit',month:'short'})}</th>)}
                  </tr></thead>
                  <tbody>{people.map(({ person, depth, hasChildren }) => <tr key={person.id}>
                    <th scope="row" style={{position:'sticky',left:0,zIndex:1,background:'#151413',padding:8,borderBottom:'1px solid #38302a',fontWeight:600,minWidth:110,maxWidth:150}}><div style={{display:'flex',alignItems:'center',gap:8,paddingLeft:depth*16}}>{hasChildren ? <button type="button" aria-label={expandedManagerIds.has(person.id) ? 'Collapse team' : 'Expand team'} title={expandedManagerIds.has(person.id) ? 'Collapse team' : 'Expand team'} onClick={() => setExpandedManagerIds(current => { const next = new Set(current); if (next.has(person.id)) next.delete(person.id); else next.add(person.id); return next; })} style={{display:'grid',placeItems:'center',width:16,height:24,padding:0,flexShrink:0,border:0,background:'transparent',color:'#ffb36b',fontSize:18,fontWeight:800,cursor:'pointer'}}>{expandedManagerIds.has(person.id) ? '▾' : '▸'}</button> : <span aria-hidden="true" style={{display:'inline-block',width:16,flexShrink:0}}/>}<span aria-hidden="true" style={{display:'grid',placeItems:'center',width:30,height:30,flexShrink:0,background:'#352116',border:'1px solid #8a5318',color:'#ffd18a',fontWeight:800}}>{(person.full_name || person.email || '?').trim().charAt(0).toUpperCase()}</span><span style={{display:'flex',flexDirection:'column',minWidth:0}}><span style={{fontSize:12,overflowWrap:'anywhere'}}>{person.full_name || 'Employee'}</span><span style={{fontSize:9,fontWeight:400,color:'#ffb36b',marginTop:2}}>{String(person.role).replace(/_/g,' ')}</span>{person.email && <span title={person.email} style={{fontSize:9,fontWeight:400,color:'#aaa29b',overflowWrap:'anywhere',lineHeight:1.2,marginTop:3}}>{person.email}</span>}</span></div></th>
                    {dateKeys.map(date => {
                      const records = reportAttendance.filter(item => item.employee_id === person.id && (item.work_date ?? (item.work_timezone ? getLocalDate(item.work_timezone,new Date(item.check_in)) : item.check_in.slice(0,10))) === date);
                      const record = records[0];
                      const completed = Boolean(record?.check_out);
                      const present = Boolean(record);
                      const bg = !present ? '#541b20' : completed ? '#153c2a' : '#4b2d10';
                      const fg = !present ? '#ffb4b4' : completed ? '#8ce2ae' : '#ffd18a';
                      return <td key={date} style={{padding:6,borderBottom:'1px solid #38302a',textAlign:'center',minWidth:154}}>
                        <div title={!present?'Absent':completed?'Signed in and out':'Signed in; not signed out'} style={{display:'inline-flex',alignItems:'stretch',justifyContent:'space-between',gap:8,padding:'7px 9px',width:142,minHeight:54,boxSizing:'border-box',background:bg,color:fg,border:'1px solid '+(!present?'#8b2d35':completed?'#286947':'#8a5318'),borderRadius:4,fontSize:12,fontWeight:700,textAlign:'left'}}>
                          {!present ? <span style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%'}}>Absent</span> : <>
                            <span style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:4,lineHeight:1.2}}>
                              <span>IN&nbsp; {timeOnly(record.check_in,record.work_timezone)}</span>
                              <span>OUT {timeOnly(record.check_out,record.work_timezone)}</span>
                            </span>
                            <span style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:5,flexShrink:0}}>
                              {gpsButton(record.check_in_lat,record.check_in_lng,'Check-in location')}
                              {gpsButton(record.check_out_lat,record.check_out_lng,'Check-out location')}
                            </span>
                          </>}
                        </div>
                      </td>;
                    })}
                  </tr>)}
                  {people.length===0 && <tr><td colSpan={dateKeys.length+1} style={{padding:18,color:'#b7aaa0'}}>No employees match this filter.</td></tr>}
                </tbody></table>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',margin:'10px 12px',fontSize:12,color:'#b7aaa0'}}>
                  <span style={{display:'inline-flex',alignItems:'center',gap:6}}><span aria-hidden="true" style={{width:10,height:10,borderRadius:'50%',background:'#22c55e'}}/>Completed shift</span>
                  <span style={{display:'inline-flex',alignItems:'center',gap:6}}><span aria-hidden="true" style={{width:10,height:10,borderRadius:'50%',background:'#f79009'}}/>Incomplete shift</span>
                  <span style={{display:'inline-flex',alignItems:'center',gap:6}}><span aria-hidden="true" style={{width:10,height:10,borderRadius:'50%',background:'#f04438'}}/>Absent</span>
                  <span>Showing up to 93 dates; defaults to the last 7 days.</span>
                </div>
              </>;
            })()}
            {!isAdmin && reportAttendance.map((item) => {
              const duration = getSessionDuration(item, clockNow);

              return (
                <article
                  key={item.id}
                  style={{
                    padding: 14,
                    marginBottom: 10,
                    border: '1px solid #344054',
                    borderRadius: 10,
                  }}
                >
                  <p style={{ margin: '0 0 6px' }}>
                    Work date: {item.work_date ?? 'Not assigned'}
                  </p>

                  <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'8px 0 12px'}}>
                    <span style={{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 11px',borderRadius:999,background:'#123b2c',border:'1px solid #23734d',color:'#a6f4c5',fontSize:13,fontWeight:700}}>
                      IN · {formatDate(item.check_in, item.work_timezone)}
                    </span>
                    <span style={{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 11px',borderRadius:999,background:item.check_out?'#172f4b':'#4a2a12',border:'1px solid '+(item.check_out?'#315d88':'#a65b18'),color:item.check_out?'#b2d7ff':'#ffd7a3',fontSize:13,fontWeight:700}}>
                      OUT · {item.check_out ? formatDate(item.check_out, item.work_timezone) : 'Not checked out'}
                    </span>
                  </div>

                  <p style={{ margin: '0 0 6px' }}>
                    Elapsed time: {duration.elapsed}
                  </p>

                  <p style={{ margin: '0 0 6px' }}>
                    Worked time: {duration.worked}
                  </p>

                  <p style={{ margin: '0 0 6px' }}>
                    Break deduction: {duration.breakDeduction}
                  </p>

                  <p style={{ margin: '0 0 6px' }}>
                    Status: {duration.status}
                  </p>

                  <p
                    style={{
                      margin: '0 0 6px',
                      color: '#b7c0d1',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    Timezone: {item.work_timezone ?? 'Not recorded'}
                  </p>

                  {isAdmin && (
                    <>
                      <p style={{ margin: '0 0 6px', color: '#b7c0d1', overflowWrap: 'anywhere' }}>
                        Employee: {profiles.find(person => person.id === item.employee_id)?.full_name || profiles.find(person => person.id === item.employee_id)?.email || item.employee_id || session.user.email}
                      </p>
                      <p style={{ margin: '0 0 6px', color: '#b7c0d1', overflowWrap: 'anywhere' }}>
                        Check-in GPS: {item.check_in_lat != null && item.check_in_lng != null ? `${item.check_in_lat.toFixed(5)}, ${item.check_in_lng.toFixed(5)}` : 'Not recorded'}
                      </p>
                      <p style={{ margin: 0, color: '#b7c0d1', overflowWrap: 'anywhere' }}>
                        Check-out GPS: {item.check_out_lat != null && item.check_out_lng != null ? `${item.check_out_lat.toFixed(5)}, ${item.check_out_lng.toFixed(5)}` : 'Not recorded'}
                      </p>
                    </>
                  )}
                </article>
              );
            })}
          </section>

          </>}
        </section>
          </main>
        </div>
      )}

      {mapPreview && <div role="dialog" aria-modal="true" aria-label={mapPreview.title} onClick={() => setMapPreview(null)} style={{position:'fixed',inset:0,zIndex:100,display:'grid',placeItems:'center',padding:18,background:'#0009'}}><section onClick={e=>e.stopPropagation()} style={{width:'min(760px,100%)',background:'#151e30',color:'#f8fafc',border:'1px solid #475467',borderRadius:14,overflow:'hidden',boxShadow:'0 20px 70px #0008'}}><header style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 18px'}}><strong>{mapPreview.title}</strong><button type="button" onClick={()=>setMapPreview(null)} aria-label="Close map" style={{background:'transparent',border:0,color:'#fff',cursor:'pointer'}}><X/></button></header><iframe title={mapPreview.title} src={`https://www.openstreetmap.org/export/embed.html?bbox=${mapPreview.longitude-0.008}%2C${mapPreview.latitude-0.005}%2C${mapPreview.longitude+0.008}%2C${mapPreview.latitude+0.005}&layer=mapnik&marker=${mapPreview.latitude}%2C${mapPreview.longitude}`} style={{width:'100%',height:420,border:0,display:'block'}} loading="lazy"/><p style={{margin:0,padding:'10px 18px',color:'#b7c0d1',fontSize:12}}>Coordinates: {mapPreview.latitude.toFixed(5)}, {mapPreview.longitude.toFixed(5)}</p></section></div>}
      {message && (
        <p
          role="status"
          style={{
            maxWidth: 760,
            margin: '12px auto',
            padding: 12,
            borderRadius: 8,
            background: '#202b3e',
            overflowWrap: 'anywhere',
          }}
        >
          {message}
        </p>
      )}

      <p
        style={{
          maxWidth: 760,
          margin: '20px auto',
          color: '#98a2b3',
          fontSize: 13,
        }}
      >
        Authorized accounts only. Employees are asked for browser location permission when they check in or out. Active sessions show elapsed time; completed sessions deduct the fixed one-hour break.
      </p>
    </main>
  );
}
