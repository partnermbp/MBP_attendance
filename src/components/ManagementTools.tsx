import TelegramHumanInbox from './TelegramHumanInbox';
import KnowMore from './KnowMore';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type Person = { id: string; full_name: string | null; email: string | null; role: string; active: boolean };
type Assignment = { manager_id: string; employee_id: string; created_at: string };
type TeamNode = { id: string; email: string | null; full_name: string | null; role: string; active: boolean; manager_id: string; depth: number };
type Message = { telegram_chat_id: number; telegram_message_id: number; display_name: string | null; username: string | null; message_text: string | null; message_date: string; reply_to_message_id: number | null; raw_update?: Record<string, any> | null; message_kind?: string | null };
type Metric = { telegram_chat_id: number; question_message_id: number; question_user_id: number | null; first_reply_user_id: number | null; response_seconds: number | null; calculated_at: string };
type GroupActivity = { telegram_user_id: number; display_name: string | null; username: string | null; message_count: number; last_message_at: string };
type DailyActivity = { telegram_user_id: number; display_name: string | null; username: string | null; activity_date: string; message_count: number };
type ParticipantResponse = { telegram_user_id: number; display_name: string | null; username: string | null; reply_count: number; avg_reply_seconds: number | null; reaction_count: number; avg_reaction_seconds: number | null };
type MessageReaction = { telegram_chat_id: number; telegram_message_id: number; telegram_user_id: number; display_name: string | null; username: string | null; reactions: any[] };
type MessageReactionCount = { telegram_chat_id: number; telegram_message_id: number; reactions: any[] };
type Group = { telegram_chat_id: number; title: string; enabled: boolean };
type TelegramMember = { id: number; telegram_chat_id: number; telegram_user_id: number; username: string | null; display_name: string | null; profile_id: string | null };
type GroupAnalyticsOption = { team_leader_id: string | null; team_leader_name: string | null; owner_profile_id: string; owner_name: string; telegram_chat_id: number | null; group_title: string | null };

const panel: CSSProperties = { padding: 18, margin: '20px 0', border: '1px solid #344054', borderRadius: 12 };
const input: CSSProperties = { display: 'block', width: '100%', marginTop: 6, padding: 10, color: '#f8fafc', background: '#101828', border: '1px solid #475467', borderRadius: 8, boxSizing: 'border-box' };
const button: CSSProperties = { padding: '9px 13px', border: 0, borderRadius: 8, color: '#fff', background: 'var(--crm-accent-strong)', cursor: 'pointer', fontWeight: 600 };
const muted: CSSProperties = { color: '#b7c0d1', fontSize: 13 };
const cell: CSSProperties = { padding: 10, borderBottom: '1px solid #344054', textAlign: 'left', verticalAlign: 'top' };
const CRM_WEB_APP_URL = 'https://attendence.dpdns.org/';
const GROUP_MESSAGE_PAGE_SIZE = 150;

function reactionIdentity(reaction: any): string {
  const type = reaction?.type?.type ?? reaction?.type ?? 'unknown';
  if (type === 'emoji') return 'emoji:' + String(reaction?.type?.emoji ?? reaction?.emoji ?? '');
  if (type === 'custom_emoji') return 'custom_emoji:' + String(reaction?.type?.custom_emoji_id ?? reaction?.custom_emoji_id ?? '');
  if (type === 'paid') return 'paid';
  return String(type);
}

function reactionText(reaction: any): string {
  const type = reaction?.type?.type ?? reaction?.type ?? 'unknown';
  if (type === 'emoji') return String(reaction?.type?.emoji ?? reaction?.emoji ?? 'Reaction');
  if (type === 'custom_emoji') return 'Custom emoji';
  if (type === 'paid') return '⭐';
  return 'Reaction';
}

function friendlyInvitationError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const message = raw.toLowerCase();
  if (message.includes('enter a valid corporate email')) return 'The invitation service rejected this email address. This can happen when the database invitation validator is outdated. Ask the CRM Admin to apply the latest invitation SQL migration in Supabase, then retry.';
  if (message.includes('already exists') || message.includes('registered crm account')) return 'An account may already exist with this email or Admin Panel Name. Check the employee list or ask an Admin to review the existing account.';
  if (message.includes('not on the approved accounts list') || message.includes('domain is not approved')) return 'This email domain is not approved for the CRM. Check the corporate email address or ask an Admin to confirm the approved domain.';
  if (message.includes('valid admin panel name')) return 'Enter a valid Admin Panel Name (2–120 characters).';
  if (message.includes('only admin can invite telemarketing')) return 'Only an Admin can invite Telemarketing staff.';
  if (message.includes('middle can invite junior only')) return 'Your role can invite Junior employees only.';
  if (message.includes('senior can invite middle or junior only')) return 'Your role can invite Middle or Junior employees only.';
  if (message.includes('team leader can invite senior, middle, or junior only')) return 'Your role can invite Senior, Middle, or Junior employees only.';
  if (message.includes('active crm profile is required') || message.includes('permission denied') || message.includes('row-level security')) return 'Your account does not currently have permission to create this invitation. Ask an Admin to check your role and account status.';
  if (message.includes('create_manager_invitation') && (message.includes('schema cache') || message.includes('could not find the function') || message.includes('function public.create_manager_invitation'))) return 'The invitation service has not been updated in the database yet. Ask the CRM Admin to apply the latest invitation SQL migration in Supabase.';
  if (message.includes('failed to fetch') || message.includes('network')) return 'The CRM could not reach the invitation service. Check your connection and try again.';
  return 'We couldn’t generate the invitation link. Please try again; if it still fails, contact the CRM Admin to check the invitation service.';
}

function prettyDuration(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return seconds + ' sec';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' min';
  return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
}

export default function ManagementTools({ supabase, profile, profiles, page = 'all' }: {
  supabase: SupabaseClient | null;
  profile: Person | null;
  profiles: Person[];
  page?: 'all' | 'team' | 'team-roles' | 'team-links' | 'team-assignments' | 'team-invitations' | 'telegram-human' | 'telegram-analytics';
}) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [managerId, setManagerId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [teamAttendance, setTeamAttendance] = useState<any[]>([]);
  const [teamTree, setTeamTree] = useState<TeamNode[]>([]);
  const [roleSelections, setRoleSelections] = useState<Record<string, string>>({});
  const [inviteRole, setInviteRole] = useState('junior');
  const [inviteAdminPanelName, setInviteAdminPanelName] = useState('');
  const [inviteCorporateEmail, setInviteCorporateEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [analyticsOptions, setAnalyticsOptions] = useState<GroupAnalyticsOption[]>([]);
  const [selectedTeamLeader, setSelectedTeamLeader] = useState('');
  const [selectedGroupOwner, setSelectedGroupOwner] = useState('');
  const [telegramMembers, setTelegramMembers] = useState<TelegramMember[]>([]);
  const [memberProfileSelections, setMemberProfileSelections] = useState<Record<number, string>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [groupActivity, setGroupActivity] = useState<GroupActivity[]>([]);
  const [dailyActivity, setDailyActivity] = useState<DailyActivity[]>([]);
  const [participantResponses, setParticipantResponses] = useState<ParticipantResponse[]>([]);
  const [messageReactions, setMessageReactions] = useState<MessageReaction[]>([]);
  const [messageReactionCounts, setMessageReactionCounts] = useState<MessageReactionCount[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [translationTarget, setTranslationTarget] = useState('EN-US');
  const [translationActivated, setTranslationActivated] = useState(false);
  const [messageSourceOverrides, setMessageSourceOverrides] = useState<Record<string, string>>({});
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationNotice, setTranslationNotice] = useState('');
  const [groupMessagesHasMore, setGroupMessagesHasMore] = useState(false);
  const [groupMessagesLoadingOlder, setGroupMessagesLoadingOlder] = useState(false);
  const [groupMessagesAtTop, setGroupMessagesAtTop] = useState(false);
  const groupMessagesContainerRef = useRef<HTMLDivElement>(null);
  const groupInitialScrollPendingRef = useRef(false);
  const groupScrollRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const groupOlderCacheTimerRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [assignmentNotice, setAssignmentNotice] = useState('');
  const [humanAccessIds, setHumanAccessIds] = useState<Set<string>>(() => new Set());
  const [activeMedia, setActiveMedia] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [mediaLoading, setMediaLoading] = useState('');
  const [mediaErrors, setMediaErrors] = useState<Record<string, string>>({});
  const isAdmin = profile?.active === true && profile.role.toLowerCase() === 'admin';
  const isSupervisor = profile?.active === true && profile.role.toLowerCase() === 'supervisor';
  const normalizedRole = String(profile?.role || '').toLowerCase().replaceAll('_', ' ');
  const isManager = profile?.active === true && ['supervisor', 'junior', 'middle', 'senior', 'team leader'].includes(normalizedRole);

  async function load() {
    if (!supabase || (!isAdmin && !isManager)) return;
    setLoading(true);
    setNotice('');
    try {
      const [assignmentResult, groupResult, metricResult, treeResult, analyticsOptionsResult] = await Promise.all([
        supabase.from('manager_employee_assignments').select('manager_id,employee_id,created_at'),
        supabase.from('telegram_groups').select('telegram_chat_id,title,enabled').order('title'),
        supabase.from('telegram_response_metrics').select('telegram_chat_id,question_message_id,question_user_id,first_reply_user_id,response_seconds,calculated_at').order('calculated_at', { ascending: false }).limit(500),
        supabase.rpc('get_my_team_hierarchy'),
        supabase.rpc('get_telegram_group_analytics_options'),
      ]);
      if (isAdmin) {
        const memberResult = await supabase.from('telegram_group_members')
          .select('id,telegram_chat_id,telegram_user_id,username,display_name,profile_id')
          .order('display_name').limit(1000);
        if (memberResult.error) setNotice((current) => current || 'Telegram members: ' + memberResult.error.message);
        else {
          const rows = (memberResult.data ?? []) as TelegramMember[];
          setTelegramMembers(rows);
          setMemberProfileSelections((current) => {
            const next = { ...current };
            for (const row of rows) if (next[row.id] === undefined) next[row.id] = row.profile_id ?? '';
            return next;
          });
        }
      }
      if (assignmentResult.error) setNotice('Assignments: ' + assignmentResult.error.message);
      else setAssignments((assignmentResult.data ?? []) as Assignment[]);
      if (treeResult.error) setNotice((current) => current || 'Team hierarchy: ' + treeResult.error.message);
      else setTeamTree((treeResult.data ?? []) as TeamNode[]);
      if (groupResult.error) setNotice((current) => current || 'Telegram groups: ' + groupResult.error.message);
      else setGroups((groupResult.data ?? []) as Group[]);
      if (metricResult.error) setNotice((current) => current || 'Telegram metrics: ' + metricResult.error.message);
      else setMetrics((metricResult.data ?? []) as Metric[]);
      if (analyticsOptionsResult.error) setNotice((current) => current || 'Telegram group ownership: ' + analyticsOptionsResult.error.message);
      else setAnalyticsOptions((analyticsOptionsResult.data ?? []) as GroupAnalyticsOption[]);
      const chosen = selectedGroup ? [Number(selectedGroup)] : [];
      if (chosen.length) {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const [messageResult, activityResult, dailyResult, responseResult] = await Promise.all([
          supabase.from('telegram_messages')
            .select('telegram_chat_id,telegram_message_id,display_name,username,message_text,message_date,reply_to_message_id,raw_update,message_kind')
            .in('telegram_chat_id', chosen).order('message_date', { ascending: false }).limit(GROUP_MESSAGE_PAGE_SIZE),
          supabase.rpc('get_telegram_group_user_activity', {
            p_chat_id: Number(selectedGroup),
            p_days: 7,
          }),
          supabase.rpc('get_telegram_group_daily_user_activity', {
            p_chat_id: Number(selectedGroup),
            p_days: 7,
            p_timezone: timeZone,
          }),
          supabase.rpc('get_telegram_group_response_summary', {
            p_chat_id: Number(selectedGroup),
            p_days: 7,
          }),
        ]);
        if (messageResult.error) {
          setNotice((current) => current || 'Telegram messages: ' + messageResult.error.message);
          setMessageReactions([]);
          setMessageReactionCounts([]);
        } else {
          const rows = (messageResult.data ?? []) as Message[];
          if (!messages.some(message => String(message.telegram_chat_id) === selectedGroup)) groupInitialScrollPendingRef.current = true;
          setMessages(previous => {
            const byId = new Map<number, Message>();
            for (const message of previous) if (String(message.telegram_chat_id) === selectedGroup) byId.set(message.telegram_message_id, message);
            for (const message of rows) byId.set(message.telegram_message_id, message);
            return [...byId.values()].sort((a, b) => a.telegram_message_id - b.telegram_message_id);
          });
          setGroupMessagesHasMore(rows.length === GROUP_MESSAGE_PAGE_SIZE);
          setGroupMessagesAtTop(false);
          const messageIds = rows.map(message => message.telegram_message_id);
          if (messageIds.length) {
            const [reactionResult, reactionCountResult] = await Promise.all([
              supabase.from('telegram_message_reactions')
                .select('telegram_chat_id,telegram_message_id,telegram_user_id,display_name,username,reactions')
                .eq('telegram_chat_id', Number(selectedGroup)).in('telegram_message_id', messageIds),
              supabase.from('telegram_message_reaction_counts')
                .select('telegram_chat_id,telegram_message_id,reactions')
                .eq('telegram_chat_id', Number(selectedGroup)).in('telegram_message_id', messageIds),
            ]);
            if (reactionResult.error) setNotice(current => current || 'Could not load message reactions: ' + reactionResult.error.message);
            setMessageReactions((reactionResult.data ?? []) as MessageReaction[]);
            if (reactionCountResult.error) setNotice(current => current || 'Could not load anonymous reaction counts: ' + reactionCountResult.error.message);
            setMessageReactionCounts((reactionCountResult.data ?? []) as MessageReactionCount[]);
          } else {
            setMessageReactions([]);
            setMessageReactionCounts([]);
          }
        }
        if (activityResult.error) {
          setGroupActivity([]);
          setNotice((current) => current || 'Could not load participant activity. Apply the Telegram group activity migration. ' + activityResult.error.message);
        } else setGroupActivity((activityResult.data ?? []) as GroupActivity[]);
        if (dailyResult.error) {
          setDailyActivity([]);
          setNotice(current => current || 'Could not load daily participant activity. Apply the daily and reaction analytics migration. ' + dailyResult.error.message);
        } else setDailyActivity((dailyResult.data ?? []) as DailyActivity[]);
        if (responseResult.error) {
          setParticipantResponses([]);
          setNotice(current => current || 'Could not load response-time analytics. Apply the daily and reaction analytics migration. ' + responseResult.error.message);
        } else setParticipantResponses((responseResult.data ?? []) as ParticipantResponse[]);
      } else {
        setMessages([]);
        setGroupActivity([]);
        setDailyActivity([]);
        setParticipantResponses([]);
        setMessageReactions([]);
        setMessageReactionCounts([]);
        setGroupMessagesHasMore(false);
        setGroupMessagesAtTop(false);
      }
      if (isManager) {
        const mine = [...new Set(((treeResult.data ?? []) as TeamNode[]).map(person => person.id))];
        if (mine.length) {
          // The server returns city/country labels only; exact GPS coordinates never
          // enter the manager's browser response.
          const attendanceResult = await supabase.functions.invoke('manager-team-attendance');
          if (attendanceResult.error) {
            setNotice((current) => current || 'Team attendance location service is not deployed or returned an error. Ask the CRM Admin to deploy the manager-team-attendance Edge Function.');
            setTeamAttendance([]);
          } else setTeamAttendance(Array.isArray(attendanceResult.data?.records) ? attendanceResult.data.records : []);
        } else setTeamAttendance([]);
      }
    } catch {
      setNotice('Could not load management data. Check the database migration and access policies.');
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!supabase || !isAdmin || !(page === 'team' || page === 'team-assignments')) return;
    const channel = supabase.channel('crm-manager-assignment-refresh')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manager_employee_assignments' }, () => { void load(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, isAdmin, profile?.id, page]);

  useEffect(() => {
    void load();
    if (page !== 'telegram-analytics' || !selectedGroup) return;
    const refresh = window.setInterval(() => { void load(); }, 30000);
    return () => window.clearInterval(refresh);
  }, [supabase, profile?.id, profile?.role, selectedGroup, page]);
  useEffect(() => {
    if (!supabase || !isAdmin || !(page === 'team' || page === 'team-roles')) return;
    let cancelled = false;
    void supabase.from('telegram_human_access').select('profile_id').then(({ data, error }) => {
      if (!cancelled && !error) setHumanAccessIds(new Set((data ?? []).map((row: { profile_id: string }) => row.profile_id)));
      if (error) setNotice(current => current || 'Could not load Corporate Telegram Inbox permissions: ' + error.message);
    });
    return () => { cancelled = true; };
  }, [supabase, isAdmin, page]);
  useEffect(() => {
    const container = groupMessagesContainerRef.current;
    const restore = groupScrollRestoreRef.current;
    if (restore && container) {
      container.scrollTop = restore.top + (container.scrollHeight - restore.height);
      groupScrollRestoreRef.current = null;
      return;
    }
    if (groupInitialScrollPendingRef.current && container) {
      container.scrollTop = container.scrollHeight;
      groupInitialScrollPendingRef.current = false;
      setGroupMessagesAtTop(false);
    }
  }, [messages]);

  useEffect(() => () => {
    if (groupOlderCacheTimerRef.current !== null) window.clearTimeout(groupOlderCacheTimerRef.current);
  }, []);

  async function loadOlderGroupMessages() {
    if (!supabase || !selectedGroup || groupMessagesLoadingOlder) return;
    const current = messages.filter(message => String(message.telegram_chat_id) === selectedGroup);
    const oldest = current.reduce<Message | null>((found, message) =>
      !found || message.telegram_message_id < found.telegram_message_id ? message : found, null);
    if (!oldest) return;
    const container = groupMessagesContainerRef.current;
    if (container) groupScrollRestoreRef.current = { height: container.scrollHeight, top: container.scrollTop };
    setGroupMessagesLoadingOlder(true);
    const result = await supabase.from('telegram_messages')
      .select('telegram_chat_id,telegram_message_id,display_name,username,message_text,message_date,reply_to_message_id,raw_update,message_kind')
      .eq('telegram_chat_id', Number(selectedGroup))
      .lt('telegram_message_id', oldest.telegram_message_id)
      .order('message_date', { ascending: false })
      .limit(GROUP_MESSAGE_PAGE_SIZE);
    if (result.error) {
      groupScrollRestoreRef.current = null;
      setNotice('Could not load older group messages: ' + result.error.message);
    } else {
      const older = (result.data ?? []) as Message[];
      setMessages(previous => {
        const byId = new Map<number, Message>();
        for (const message of previous) if (String(message.telegram_chat_id) === selectedGroup) byId.set(message.telegram_message_id, message);
        for (const message of older) byId.set(message.telegram_message_id, message);
        return [...byId.values()].sort((a, b) => a.telegram_message_id - b.telegram_message_id);
      });
      const olderIds = older.map(message => message.telegram_message_id);
      if (olderIds.length) {
        const [reactionResult, countResult] = await Promise.all([
          supabase.from('telegram_message_reactions')
            .select('telegram_chat_id,telegram_message_id,telegram_user_id,display_name,username,reactions')
            .eq('telegram_chat_id', Number(selectedGroup)).in('telegram_message_id', olderIds),
          supabase.from('telegram_message_reaction_counts')
            .select('telegram_chat_id,telegram_message_id,reactions')
            .eq('telegram_chat_id', Number(selectedGroup)).in('telegram_message_id', olderIds),
        ]);
        if (reactionResult.error) setNotice('Could not load reactions for older messages: ' + reactionResult.error.message);
        else setMessageReactions(previous => [
          ...previous.filter(row => !olderIds.includes(row.telegram_message_id)),
          ...((reactionResult.data ?? []) as MessageReaction[]),
        ]);
        if (countResult.error) setNotice('Could not load anonymous reaction counts for older messages: ' + countResult.error.message);
        else setMessageReactionCounts(previous => [
          ...previous.filter(row => !olderIds.includes(row.telegram_message_id)),
          ...((countResult.data ?? []) as MessageReactionCount[]),
        ]);
      }
      setGroupMessagesHasMore(older.length === GROUP_MESSAGE_PAGE_SIZE);
      if (older.length) {
        if (groupOlderCacheTimerRef.current !== null) window.clearTimeout(groupOlderCacheTimerRef.current);
        groupOlderCacheTimerRef.current = window.setTimeout(() => {
          setMessages(previous => previous
            .filter(message => String(message.telegram_chat_id) === selectedGroup)
            .sort((a, b) => a.telegram_message_id - b.telegram_message_id)
            .slice(-GROUP_MESSAGE_PAGE_SIZE));
          setGroupMessagesHasMore(true);
          groupOlderCacheTimerRef.current = null;
        }, 60 * 60 * 1000);
      }
    }
    setGroupMessagesLoadingOlder(false);
  }



  async function translateSingleGroupMessage(message: Message, sourceLanguage: string) {
    if (!supabase || !selectedGroup || translationLoading || !message.message_text?.trim()) return;
    const messageKey = String(message.telegram_chat_id) + ':' + String(message.telegram_message_id);
    const cacheKey = selectedGroup + ':' + translationTarget + ':' + sourceLanguage + ':' + messageKey;
    if (translations[cacheKey]) return;
    setTranslationLoading(true);
    setTranslationNotice('');
    try {
      const { data, error } = await supabase.functions.invoke('telegram-message-translate', {
        body: {
          target_lang: translationTarget,
          source_lang: sourceLanguage === 'default' ? 'auto' : sourceLanguage,
          messages: [{ id: messageKey, text: message.message_text.trim(), source_lang: sourceLanguage === 'default' ? 'auto' : sourceLanguage }],
        },
      });
      if (error) {
        const context = (error as any).context as Response | undefined;
        let detail = error.message || 'Translation request failed.';
        if (context) {
          const payload = await context.clone().json().catch(() => null);
          if (payload?.error) detail = String(payload.error);
          else if (context.status === 429) detail = 'DeepL is temporarily rate-limiting requests. Please wait and try again.';
          else detail = 'Translation service failed (' + context.status + '). Please try again.';
        }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(String(data.error));
      const result = Array.isArray(data?.translations) ? data.translations.find((item: any) => String(item?.id) === messageKey) : null;
      if (!result || typeof result.text !== 'string') throw new Error('DeepL did not return a translation for this message.');
      setTranslations(current => ({ ...current, [cacheKey]: result.text }));
      setTranslationNotice('Message translated with DeepL.');
    } catch (error) {
      setTranslationNotice(error instanceof Error ? error.message : 'Could not translate this message.');
    } finally {
      setTranslationLoading(false);
    }
  }

  useEffect(() => {
    return () => { if (activeMedia?.url) URL.revokeObjectURL(activeMedia.url); };
  }, [activeMedia?.url]);

  useEffect(() => { setActiveMedia(null); setMediaLoading(''); }, [selectedGroup, profile?.id]);
  useEffect(() => { if (groupMessagesContainerRef.current) groupMessagesContainerRef.current.scrollTop = 0; }, [selectedGroup]);

  async function openAttachment(message: Message, name: string) {
    if (!supabase) return;
    const key = message.telegram_chat_id + ':' + message.telegram_message_id;
    setMediaLoading(key);
    setMediaErrors(current => ({ ...current, [key]: '' }));
    setNotice('');
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error('Please sign in again to view this attachment.');
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !publishableKey) throw new Error('Supabase URL/key are missing from the deployed frontend environment. Check GitHub Pages build variables.');
      const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/telegram-media-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: publishableKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ chat_id: message.telegram_chat_id, message_id: message.telegram_message_id }),
      });
      if (!response.ok) {
        const contentType = response.headers.get('Content-Type') || '';
        const body = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
        const detail = body.error || (response.status === 404
          ? 'Media proxy endpoint not found. Deploy the telegram-media-proxy Edge Function in the Supabase project used by this CRM.'
          : response.status === 401 ? 'Your session expired. Sign out and sign back in.'
          : response.status === 403 ? 'Your CRM role or Telegram group access does not permit this attachment.'
          : `Attachment request failed (${response.status}). Check Supabase Edge Function logs.`);
        throw new Error(detail);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('The media service returned an empty file. Check the Telegram file metadata and Edge Function logs.');
      const mime = blob.type || response.headers.get('Content-Type') || 'application/octet-stream';
      if (mime.includes('application/json') || mime.includes('text/plain')) {
        const text = await blob.text();
        try { const body = JSON.parse(text); throw new Error(body.error || 'The media service returned an error instead of a file.'); }
        catch (error) { if (error instanceof Error && error.message !== 'Unexpected end of JSON input') throw error; throw new Error('The media service returned an error instead of a file.'); }
      }
      const url = URL.createObjectURL(blob);
      setActiveMedia({ url, mime, name });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Could not open attachment.';
      setMediaErrors(current => ({ ...current, [key]: messageText }));
      setNotice(messageText);
    } finally { setMediaLoading(''); }
  }

  async function addAssignment() {
    if (!supabase || !managerId || !employeeId) return;
    setNotice('');
    const manager = profiles.find(p => p.id === managerId);
    const employee = profiles.find(p => p.id === employeeId);
    const rank = (role: string) => ({ telemarketing: 1, junior: 1, middle: 2, senior: 3, team_leader: 4, 'team leader': 4, supervisor: 5 } as Record<string, number>)[role.toLowerCase().replaceAll('_', ' ')] ?? 0;
    if (!manager || !employee || rank(manager.role) <= rank(employee.role) || rank(manager.role) === 0 || rank(employee.role) === 0 || (employee.role.toLowerCase() === 'telemarketing' && manager.role.toLowerCase().replaceAll('_', ' ') !== 'team leader')) {
      setAssignmentNotice('Telemarketing contacts can be assigned directly under a Team Leader only. Other reporting lines must follow the existing hierarchy.');
      return;
    }
    setLoading(true); setAssignmentNotice('');
    const { error } = await supabase.rpc('assign_employee_to_manager', {
      p_manager_id: managerId,
      p_employee_id: employeeId,
    });
    if (error) {
      const detail = error.message.toLowerCase();
      setAssignmentNotice(detail.includes('different top-level') || detail.includes('different team leader')
        ? 'This employee is already assigned within a different Team Leader’s reporting tree. Reassignment across Team Leaders requires an explicit Admin change.'
        : detail.includes('cycle') || detail.includes('descendant')
          ? 'This assignment would create a reporting cycle and was blocked.'
          : detail.includes('already assigned')
            ? 'This employee is already assigned under the selected manager.'
            : 'Could not save assignment: ' + error.message);
    } else {
      setAssignmentNotice('Assignment saved. Any previous direct assignment in the same Team Leader’s reporting tree was replaced.');
      await load();
    }
    setLoading(false);
  }

  async function saveTelegramMemberLink(member: TelegramMember) {
    if (!supabase || !isAdmin) return;
    setLoading(true); setNotice('');
    const selectedProfile = memberProfileSelections[member.id] || null;
    const { error } = await supabase.from('telegram_group_members').update({ profile_id: selectedProfile }).eq('id', member.id);
    setNotice(error ? 'Could not link Telegram member: ' + error.message : 'Telegram identity link saved.');
    if (!error) await load();
    setLoading(false);
  }

  async function removeAssignment(a: Assignment) {
    if (!supabase) return;
    setLoading(true);
    const { error } = await supabase.from('manager_employee_assignments').delete()
      .eq('manager_id', a.manager_id).eq('employee_id', a.employee_id);
    setNotice(error ? 'Could not remove assignment: ' + error.message : 'Assignment removed.');
    await load(); setLoading(false);
  }

  if (!isAdmin && !isManager) return null;
  const roleRank = (role: string) => ({ telemarketing: 1, junior: 1, middle: 2, senior: 3, team_leader: 4, 'team leader': 4, supervisor: 5 } as Record<string, number>)[role.toLowerCase().replaceAll('_', ' ')] ?? 0;
  const managers = profiles.filter(p => p.active && ['supervisor','middle','senior','team_leader'].includes(p.role.toLowerCase().replaceAll(' ', '_')));
  const validAssignments = assignments.filter(a => {
    const parent = profiles.find(p => p.id === a.manager_id && p.active);
    const child = profiles.find(p => p.id === a.employee_id && p.active);
    return Boolean(parent && child && roleRank(parent.role) > roleRank(child.role) && roleRank(parent.role) > 0 && roleRank(child.role) > 0);
  });
  const invalidAssignments = assignments.filter(a => !validAssignments.some(valid => valid.manager_id === a.manager_id && valid.employee_id === a.employee_id));
  const managerIds = new Set(managers.map(p => p.id));
  const hasValidManagerParent = new Set(validAssignments.filter(a => managerIds.has(a.manager_id) && managerIds.has(a.employee_id)).map(a => a.employee_id));
  const rootManagers = managers.filter(person => !hasValidManagerParent.has(person.id)).sort((a,b) => roleRank(b.role)-roleRank(a.role) || (a.full_name||a.email||'').localeCompare(b.full_name||b.email||''));
  const employees = profiles.filter(p => p.active && p.role.toLowerCase() !== 'admin' && !['manager','employee'].includes(p.role.toLowerCase()));
  const inviteRoles = isAdmin ? ['supervisor','team_leader','senior','middle','junior','telemarketing'] : normalizedRole === 'team leader' ? ['senior','middle','junior'] : normalizedRole === 'senior' ? ['middle','junior'] : ['junior'];
  const myAssignments = assignments.filter(a => a.manager_id === profile?.id);
  const personName = (id: string) => profiles.find(p => p.id === id)?.full_name || profiles.find(p => p.id === id)?.email || teamTree.find(p => p.id === id)?.full_name || teamTree.find(p => p.id === id)?.email || 'Unknown employee';
  const selectedMetrics = metrics.filter(m => selectedGroup !== '' && String(m.telegram_chat_id) === selectedGroup);
  const analyticsTeamLeaders = [...new Map(analyticsOptions.filter(o => o.team_leader_id).map(o => [o.team_leader_id!, { id: o.team_leader_id!, name: o.team_leader_name || o.team_leader_id! }])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  const analyticsOwners = [...new Map(analyticsOptions.filter(o => o.team_leader_id === selectedTeamLeader && o.telegram_chat_id !== null).map(o => [o.owner_profile_id, { id: o.owner_profile_id, name: o.owner_name }])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  const analyticsGroups = isAdmin || isSupervisor
    ? analyticsOptions.filter(o => o.team_leader_id === selectedTeamLeader && o.owner_profile_id === selectedGroupOwner && o.telegram_chat_id !== null)
    : analyticsOptions.filter(o => o.owner_profile_id === profile?.id && o.telegram_chat_id !== null);
  const renderTeamNode = (person: TeamNode, depth = 0): ReactElement => {
    const children = teamTree.filter(child => child.manager_id === person.id);
    const expanded = Boolean(expandedManagers[person.id]);
    return <div key={person.id} style={{border:'1px solid #344054',borderRadius:8,padding:8,marginLeft:Math.min(depth,5)*12}}>
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
        <button type="button" style={{...button,background:'#344054',textAlign:'left'}} onClick={()=>setExpandedManagers(current=>({...current,[person.id]:!current[person.id]}))}>{children.length ? (expanded?'−':'+') : '•'} {person.full_name||person.email||person.id}</button>
        <span style={{...muted,margin:0}}>{person.role}</span>
      </div>
      {expanded && children.length>0 && <div style={{display:'grid',gap:6,marginTop:8}}>{children.map(child=>renderTeamNode(child,depth+1))}</div>}
    </div>;
  };
  const answered = selectedMetrics.filter(m => m.response_seconds != null);
  const avgSeconds = answered.length ? Math.round(answered.reduce((sum, m) => sum + (m.response_seconds ?? 0), 0) / answered.length) : null;
  const maxActivity = Math.max(1, ...groupActivity.map(person => person.message_count));
  const maxDailyActivity = Math.max(1, ...dailyActivity.map(person => person.message_count));
  const activityDayKeys = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  });
  const dailyActivityByUser = new Map<number, Map<string, number>>();
  for (const row of dailyActivity) {
    if (!dailyActivityByUser.has(row.telegram_user_id)) dailyActivityByUser.set(row.telegram_user_id, new Map());
    dailyActivityByUser.get(row.telegram_user_id)!.set(String(row.activity_date).slice(0, 10), row.message_count);
  }

  return <section style={panel}>
    {page !== 'telegram-human' && page !== 'telegram-analytics' && <>
    {page === 'team' && <>
    <h2 style={{ marginTop: 0 }}>{isAdmin ? 'Team management' : 'My team'}</h2>
    <KnowMore>Manager access follows saved reporting assignments and database permissions.</KnowMore>
    </>}
    {isAdmin && (page === 'team' || page === 'team-roles') && <>
      <h3>Corporate Telegram Inbox access</h3>
      <KnowMore>Only active Telemarketing accounts can receive this permission. Eligibility is removed if the account role changes.</KnowMore>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead><tr><th style={cell}>Telemarketing manager</th><th style={cell}>Access</th><th style={cell}>Permission</th></tr></thead>
        <tbody>{profiles.filter(p=>p.active && p.role.toLowerCase().replaceAll('_',' ')==='telemarketing').map(person=><tr key={'human-access-'+person.id}>
          <td style={cell}>{person.full_name || person.email || person.id}</td>
          <td style={cell}><span style={{color:humanAccessIds.has(person.id)?'#16a34a':'#98a2b3',fontWeight:700}}>{humanAccessIds.has(person.id)?'Enabled':'Disabled'}</span></td>
          <td style={cell}><button type="button" style={button} disabled={loading} onClick={async()=>{if(!supabase)return;setLoading(true);setNotice('');const enabled=humanAccessIds.has(person.id);const result=enabled?await supabase.from('telegram_human_access').delete().eq('profile_id',person.id):await supabase.from('telegram_human_access').insert({profile_id:person.id,granted_by:profile?.id});if(result.error)setNotice('Could not '+(enabled?'revoke':'grant')+' Human Telegram access: '+result.error.message);else{setHumanAccessIds(current=>{const next=new Set(current);if(enabled)next.delete(person.id);else next.add(person.id);return next;});setNotice('Human Telegram access '+(enabled?'revoked':'enabled')+' for '+(person.full_name||person.email||'this manager')+'.');}setLoading(false);}}>{humanAccessIds.has(person.id)?'Revoke access':'Enable access'}</button></td>
        </tr>)}</tbody></table></div>
      {!profiles.some(p=>p.active && p.role.toLowerCase().replaceAll('_',' ')==='telemarketing')&&<p style={muted}>No active Telemarketing managers are registered.</p>}
    </>}
    {isAdmin && (page === 'team' || page === 'team-roles') && <>
      <h3>Employee role management</h3>
      <KnowMore>Admin accounts are protected and cannot be changed here.</KnowMore>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead><tr><th style={cell}>Employee</th><th style={cell}>Current role</th><th style={cell}>Reports to</th><th style={cell}>Direct reports</th><th style={cell}>New role</th><th style={cell}>Action</th></tr></thead>
        <tbody>{profiles.filter(p=>p.active && p.role.toLowerCase()!=='admin').map(p=>{
          const reportingManagers=assignments.filter(a=>a.employee_id===p.id).map(a=>profiles.find(x=>x.id===a.manager_id)).filter((x):x is Person=>x!==undefined&&x.role.toLowerCase()!=='admin');
          const directReports=assignments.filter(a=>a.manager_id===p.id).map(a=>profiles.find(x=>x.id===a.employee_id)).filter((x):x is Person=>x!==undefined&&x.role.toLowerCase()!=='admin');
          return <tr key={p.id}>
          <td style={cell}>{p.full_name || p.email || p.id}</td><td style={cell}>{p.role.replaceAll('_',' ')}</td>
          <td style={{...cell,minWidth:170}}>{reportingManagers.length?reportingManagers.map(parent=><div key={parent.id} style={{marginBottom:4}}><strong>{parent.full_name||parent.email||'Manager'}</strong><small style={{display:'block',...muted}}>{parent.role.replaceAll('_',' ')}</small></div>):<span style={muted}>Top level / unassigned</span>}</td>
          <td style={{...cell,minWidth:180}}>{directReports.length?directReports.map(child=><div key={child.id} style={{marginBottom:4}}><strong>{child.full_name||child.email||'Employee'}</strong><small style={{display:'block',...muted}}>{child.role.replaceAll('_',' ')}</small></div>):<span style={muted}>No direct reports</span>}</td>
          <td style={cell}><select style={input} value={roleSelections[p.id] ?? p.role.toLowerCase().replaceAll(' ','_')} onChange={e=>setRoleSelections(current=>({...current,[p.id]:e.target.value}))}>
            {['junior','middle','senior','team_leader','telemarketing'].map(role=>{
              const parentLinks=assignments.filter(a=>a.employee_id===p.id).map(a=>profiles.find(x=>x.id===a.manager_id)).filter((x):x is Person=>x!==undefined&&x.role.toLowerCase()!=='admin');
              const childLinks=assignments.filter(a=>a.manager_id===p.id).map(a=>profiles.find(x=>x.id===a.employee_id)).filter((x):x is Person=>Boolean(x));
              const proposedRank=roleRank(role);
              const invalidParent=parentLinks.some(parent=>roleRank(parent.role)<=proposedRank || proposedRank===0);
              const invalidChild=childLinks.some(child=>proposedRank<=roleRank(child.role) || proposedRank===0);
              const disabled=(invalidParent||invalidChild) && role!==p.role.toLowerCase().replaceAll(' ','_');
              return <option key={role} value={role} disabled={disabled}>{role==='team_leader'?'Team Leader':role[0].toUpperCase()+role.slice(1)}{disabled?' — conflicts with reporting line':''}</option>;
            })}
          </select></td>
          <td style={cell}><button type="button" style={button} disabled={loading || (roleSelections[p.id] ?? p.role.toLowerCase().replaceAll(' ','_'))===p.role.toLowerCase().replaceAll(' ','_')} onClick={async()=>{if(!supabase)return;setLoading(true);setNotice('');const {error}=await supabase.rpc('set_employee_role',{target_profile:p.id,new_role:roleSelections[p.id]});const detail=error?.message?.toLowerCase()||'';setNotice(error?(detail.includes('reporting hierarchy')?'Role change blocked: it would make this employee’s existing reporting line invalid. Reassign the manager or reports first.':'Could not update role: '+error.message):'Role updated.');if(!error)await load();setLoading(false);}}>Save role</button></td>
        </tr>;})}</tbody></table></div>
    </>}
    {isAdmin && (page === 'team' || page === 'team-links') && <>
      <h3>Link Telegram members to CRM employees</h3>
      <KnowMore>Link only after verifying the Telegram identity. These links determine which employee is attributed in group analytics.</KnowMore>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Telegram group','Telegram user','User ID','CRM employee','Action'].map(x => <th key={x} style={cell}>{x}</th>)}</tr></thead>
        <tbody>{telegramMembers.map(member => <tr key={member.id}>
          <td style={cell}>{groups.find(g => g.telegram_chat_id === member.telegram_chat_id)?.title || member.telegram_chat_id}</td>
          <td style={cell}>{member.display_name || 'Unknown'}{member.username ? ' @' + member.username : ''}</td>
          <td style={cell}>{member.telegram_user_id}</td>
          <td style={{ ...cell, minWidth: 220 }}><select style={input} value={memberProfileSelections[member.id] ?? ''} onChange={e => setMemberProfileSelections(current => ({ ...current, [member.id]: e.target.value }))}><option value="">Not linked</option>{profiles.filter(p => p.active && p.role.toLowerCase() !== 'admin').map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select></td>
          <td style={cell}><button type="button" style={button} disabled={loading || (memberProfileSelections[member.id] ?? '') === (member.profile_id ?? '')} onClick={() => void saveTelegramMemberLink(member)}>Save link</button></td>
        </tr>)}</tbody>
      </table></div>
      {!telegramMembers.length && <p style={muted}>No Telegram members found yet. Send messages in the test group and refresh the page.</p>}
    </>}
    {isAdmin && (page === 'team' || page === 'team-assignments') && <>
      <h3>Assign employees to managers</h3>
      <KnowMore>Invited employees are automatically placed under the manager who invited them after registration is completed. Use these controls only to correct or change an existing reporting line.</KnowMore>
      <details style={{margin:'8px 0 16px',padding:'10px 12px',border:'1px solid #344054',borderRadius:8,background:'var(--crm-card-raised)'}}>
        <summary style={{cursor:'pointer',fontSize:13,fontWeight:650}}>Change an assignment manually</summary>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:12,marginTop:12}}>
          <label>Manager<select style={input} value={managerId} onChange={e=>{setManagerId(e.target.value);setEmployeeId('');}}><option value="">Choose manager</option>{managers.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></label>
          <label>Employee<select style={input} value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Choose employee</option>{employees.filter(p=>!managerId || Boolean(profiles.find(x=>x.id===managerId) && roleRank(profiles.find(x=>x.id===managerId)!.role)>roleRank(p.role) && roleRank(p.role)>0 && (p.role.toLowerCase()!=='telemarketing' || profiles.find(x=>x.id===managerId)!.role.toLowerCase().replaceAll('_',' ')==='team leader'))).map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select></label>
        </div>
        {assignmentNotice&&<p role="status" aria-live="polite" style={{margin:'8px 0 0',fontSize:12,lineHeight:1.4,color:assignmentNotice==='Assignment saved.'?'#75e0a7':'#fda29b',overflowWrap:'anywhere'}}>{assignmentNotice}</p>}
        <button type="button" style={{...button,marginTop:8}} disabled={loading||!managerId||!employeeId} onClick={()=>void addAssignment()}>Save assignment</button>
      </details>
      <div style={{display:'grid',gap:7}}>
        {rootManagers.map(person=>{
          const direct=validAssignments.filter(a=>a.manager_id===person.id);
          const expanded=Boolean(expandedManagers[person.id]);
          const renderAssignmentNode=(manager:Person,depth=0):ReactElement=>{
            const children=validAssignments.filter(a=>a.manager_id===manager.id).map(a=>profiles.find(p=>p.id===a.employee_id)).filter((p):p is Person=>Boolean(p)).sort((a,b)=>roleRank(b.role)-roleRank(a.role)||(a.full_name||a.email||'').localeCompare(b.full_name||b.email||''));
            const childManagers=children.filter(p=>managerIds.has(p.id));
            const childEmployees=children.filter(p=>!managerIds.has(p.id));
            const isExpanded=Boolean(expandedManagers[manager.id]);
            return <div key={manager.id} style={{marginLeft:depth?Math.min(depth,5)*16:0,borderLeft:depth?'1px solid var(--crm-border)':0,paddingLeft:depth?10:0}}>
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 0'}}>
                {children.length>0?<button type="button" aria-label={isExpanded?'Collapse reports':'Expand reports'} onClick={()=>setExpandedManagers(current=>({...current,[manager.id]:!current[manager.id]}))} style={{display:'grid',placeItems:'center',width:24,height:24,padding:0,flexShrink:0,border:'1px solid var(--crm-border)',borderRadius:5,background:'var(--crm-card-raised)',color:'var(--crm-text)',cursor:'pointer'}}>{isExpanded?'⌄':'›'}</button>:<span style={{width:24,flexShrink:0}}/>}
                <span style={{minWidth:0,flex:1}}><strong style={{display:'block',fontSize:13}}>{manager.full_name||manager.email||'Manager'}</strong><small style={muted}>{manager.role.replaceAll('_',' ')} · {children.length} direct reports</small></span>
                {depth>0&&<button type="button" style={{...button,padding:'5px 9px',fontSize:11,background:'#b42318'}} disabled={loading} onClick={()=>{const parentLink=validAssignments.find(a=>a.employee_id===manager.id);if(parentLink)void removeAssignment(parentLink);}}>Remove from parent</button>}
              </div>
              {isExpanded&&<div style={{display:'grid',gap:3,paddingBottom:5}}>
                {childManagers.map(child=>renderAssignmentNode(child,depth+1))}
                {childEmployees.map(child=><div key={child.id} style={{display:'flex',alignItems:'center',gap:8,marginLeft:Math.min(depth+1,5)*16,padding:'7px 8px',borderRadius:6,background:'var(--crm-card-raised)'}}>
                  <span style={{width:24,flexShrink:0}}/>
                  <span style={{flex:1,minWidth:0,fontSize:12}}>{child.full_name||child.email||'Employee'} <small style={muted}>· {child.role.replaceAll('_',' ')} · Reports to: {manager.full_name||manager.email||'Team Leader'}</small></span>
                  <button type="button" style={{...button,padding:'5px 9px',fontSize:11,background:'#b42318'}} disabled={loading} onClick={()=>void removeAssignment({manager_id:manager.id,employee_id:child.id,created_at:validAssignments.find(a=>a.manager_id===manager.id&&a.employee_id===child.id)?.created_at||''})}>Remove</button>
                </div>)}
                {childManagers.map(child=><div key={'remove-'+child.id} style={{display:'none'}} />)}
              </div>}
            </div>;
          };
          return <div key={person.id} style={{border:'1px solid var(--crm-border)',borderRadius:8,padding:'8px 12px',background:'var(--crm-card-bg)'}}>
            {renderAssignmentNode(person)}
            {direct.length>0&&expanded&&<div style={{display:'flex',justifyContent:'flex-end',paddingTop:4}}><span style={{fontSize:10,color:'var(--crm-text-muted)'}}>Expand a manager to view reports and controls</span></div>}
          </div>;
        })}
        {rootManagers.length===0&&<p style={muted}>No top-level managers found.</p>}
      </div>
      {invalidAssignments.length>0&&<details style={{marginTop:12,padding:'10px 12px',border:'1px solid #854d0e',borderRadius:8}}>
        <summary style={{cursor:'pointer',fontSize:12,color:'#fbbf24'}}>Assignments needing correction ({invalidAssignments.length})</summary>
        <div style={{display:'grid',gap:6,marginTop:8}}>{invalidAssignments.map(a=><div key={a.manager_id+':'+a.employee_id} style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',fontSize:12}}><span style={{flex:1,minWidth:180}}>{personName(a.manager_id)} → {personName(a.employee_id)}</span><button type="button" style={{...button,padding:'5px 9px',fontSize:11,background:'#b42318'}} disabled={loading} onClick={()=>void removeAssignment(a)}>Remove invalid link</button></div>)}</div>
      </details>}
    </>}
    {(isManager || isAdmin) && <>
      {(page === 'team' || page === 'team-invitations') && (isAdmin || (isManager && normalizedRole !== 'junior' && normalizedRole !== 'supervisor')) && <>
      <h3>{isAdmin ? 'Admin invitation — choose any role' : 'Invite an employee'}</h3>
      <KnowMore>{isAdmin ? 'Admins can invite any role, including Supervisors. Supervisors are read-only and may oversee Team Leaders.' : 'Invitation links are single-use and expire after 24 hours.'}</KnowMore>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10}}>
        <label>Admin Panel Name<input style={input} value={inviteAdminPanelName} onChange={e=>setInviteAdminPanelName(e.target.value)} maxLength={120} required placeholder="Exact name from your Admin Panel"/></label>
        <label>Corporate Email<input style={input} type="email" value={inviteCorporateEmail} onChange={e=>setInviteCorporateEmail(e.target.value.trimStart())} maxLength={254} required placeholder="employee@company.com"/></label>
        <label>Role<select style={input} value={inviteRole} onChange={e=>setInviteRole(e.target.value)}>{inviteRoles.map(r=><option key={r} value={r}>{r==='team_leader'?'Team Leader':r[0].toUpperCase()+r.slice(1)}</option>)}</select></label>
        <div style={{display:'flex',alignItems:'end'}}><button type="button" style={button} disabled={inviteLoading || !inviteAdminPanelName.trim() || !inviteCorporateEmail.trim()} onClick={async()=>{if(!supabase){setNotice('Database connection is not configured. Please contact the CRM administrator.');return;}setInviteLoading(true);setInviteUrl('');setNotice('Generating invitation link…');try{const {data,error}=await supabase.rpc('create_manager_invitation',{invited_role:inviteRole,invitee_admin_panel_name:inviteAdminPanelName.trim(),invitee_corporate_email:inviteCorporateEmail.trim().toLowerCase()});if(error)throw new Error(error.message);if(typeof data!=='string'||!data.trim())throw new Error('The database did not return an invitation token. Confirm the latest invitation SQL migration has been applied in Supabase.');const url=new URL(CRM_WEB_APP_URL);url.searchParams.set('invite',data);setInviteUrl(url.toString());setNotice('Invitation created. Share it only with the intended new employee.');}catch(error){setNotice(friendlyInvitationError(error));}finally{setInviteLoading(false);}}}>{inviteLoading?'Generating…':'Generate invitation link'}</button></div>
      </div>
      {notice && <p role="status" style={{padding:10,marginTop:10,background:'#202b3e',borderRadius:8,overflowWrap:'anywhere'}}>{notice}</p>}
      {inviteUrl && <div style={{marginTop:12,padding:12,border:'1px solid #475467',borderRadius:8,overflowWrap:'anywhere'}}>
        <input aria-label="Invitation link" readOnly value={inviteUrl} style={input}/>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>
          <button type="button" style={button} onClick={()=>{void navigator.clipboard.writeText(inviteUrl);setNotice('Invitation link copied.');}}>Copy link</button>
          <a href={'https://t.me/share/url?url='+encodeURIComponent(inviteUrl)+'&text='+encodeURIComponent('You are invited to the Attendance CRM. Open this link to register and verify your identity.')} target="_blank" rel="noreferrer" style={{...button,textDecoration:'none'}}>Share via Telegram</a>
          <a href={'https://wa.me/?text='+encodeURIComponent('You are invited to the Attendance CRM: '+inviteUrl)} target="_blank" rel="noreferrer" style={{...button,textDecoration:'none'}}>Share via WhatsApp</a>
        </div>
      </div>}
      </>}
      {!isAdmin && page === 'team' && <>
      <h3>Reporting hierarchy</h3>
      <KnowMore>Reporting lines reflect saved manager-to-employee assignments.</KnowMore>
      <div style={{display:'grid',gap:8}}>{teamTree.filter(person=>person.manager_id===profile?.id).map(person=>renderTeamNode(person))}{teamTree.length===0&&<p style={muted}>No subordinate relationships found yet.</p>}</div>
      <h3>Assigned employees</h3>
      {myAssignments.length ? <ul>{myAssignments.map(a => <li key={a.employee_id}>{personName(a.employee_id)}</li>)}</ul> : <p>No employees have been assigned to you yet.</p>}
      <h3>Team attendance</h3>
      {(() => {
        const dateKeys = Array.from({ length: 7 }, (_, index) => {
          const date = new Date();
          date.setHours(12, 0, 0, 0);
          date.setDate(date.getDate() - (6 - index));
          return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        });
        const timeOnly = (value: string | null, timezone: string | null) => value
          ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false, ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(value))
          : '—';
        return <div style={{ border: '1px solid #38302a', marginTop: 12 }}>
          <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: Math.max(620, 180 + dateKeys.length * 154), textAlign: 'left' }}>
            <thead><tr style={{ background: 'var(--crm-card-raised)' }}>
              <th style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--crm-card-raised)', padding: 12, borderBottom: '1px solid var(--crm-border)', minWidth: 180 }}>Employee</th>
              {dateKeys.map(date => <th key={date} style={{ padding: 10, borderBottom: '1px solid var(--crm-border)', whiteSpace: 'nowrap', textAlign: 'center' }}>{new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' })}</th>)}
            </tr></thead>
            <tbody>{teamTree.map(person => <tr key={person.id}>
              <th scope="row" style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--crm-card-bg)', padding: 8, borderBottom: '1px solid var(--crm-border)', fontWeight: 600, minWidth: 110, maxWidth: 180 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: Math.min(person.depth, 5) * 12 }}>
                  <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, flexShrink: 0, background: 'var(--crm-accent-soft)', border: '1px solid var(--crm-accent-strong)', color: 'var(--crm-accent)', fontWeight: 800 }}>{(person.full_name || person.email || '?').trim().charAt(0).toUpperCase()}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{person.full_name || person.email || 'Employee'}</span>
                    <span style={{ fontSize: 9, fontWeight: 400, color: 'var(--crm-accent)', marginTop: 2 }}>{String(person.role).replace(/_/g, ' ')}</span>
                    {person.email && <span title={person.email} style={{ fontSize: 9, fontWeight: 400, color: '#aaa29b', overflowWrap: 'anywhere', lineHeight: 1.2, marginTop: 3 }}>{person.email}</span>}
                  </span>
                </div>
              </th>
              {dateKeys.map(date => {
                const record = teamAttendance.find(item => item.employee_id === person.id && (item.work_date || item.check_in?.slice(0, 10)) === date);
                const completed = Boolean(record?.check_out);
                const present = Boolean(record);
                const bg = !present ? '#451a1a' : completed ? '#153c2a' : '#4b2d10';
                const fg = !present ? '#fda29b' : completed ? '#8ce2ae' : '#ffd18a';
                const borderColor = !present ? '#b42318' : completed ? '#286947' : '#8a5318';
                return <td key={date} style={{ padding: 6, borderBottom: '1px solid #38302a', textAlign: 'center', minWidth: 154 }}>
                  <div title={!present ? 'Absent' : completed ? 'Signed in and out' : 'Signed in; not signed out'} style={{ display: 'inline-flex', alignItems: 'stretch', justifyContent: 'space-between', gap: 8, padding: '7px 9px', width: 142, minHeight: 54, boxSizing: 'border-box', background: bg, color: fg, border: '1px solid ' + borderColor, borderRadius: 4, fontSize: 12, fontWeight: 700, textAlign: 'left' }}>
                    {!present ? <span aria-label="Absent" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', color: '#fda29b' }}>Absent</span> : <span style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, lineHeight: 1.2 }}>
                      <span>IN&nbsp; {timeOnly(record.check_in, record.work_timezone)}{record.check_in_city && <span style={{ display: 'block', fontSize: 10, fontWeight: 500, marginTop: 2 }}>{record.check_in_city}</span>}</span>
                      <span>OUT {timeOnly(record.check_out, record.work_timezone)}{record.check_out && record.check_out_city && <span style={{ display: 'block', fontSize: 10, fontWeight: 500, marginTop: 2 }}>{record.check_out_city}</span>}</span>
                    </span>}
                  </div>
                </td>;
              })}
            </tr>)}
            {teamTree.length === 0 && <tr><td colSpan={dateKeys.length + 1} style={{ padding: 18, color: '#b7aaa0' }}>No employees have been assigned to your team yet.</td></tr>}
            </tbody>
          </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', margin: '10px 12px', fontSize: 12, color: '#b7aaa0' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e' }} />Completed shift</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: '#f79009' }} />Incomplete shift</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: '#f04438' }} />Absent</span>
            <span>Showing the last 7 days.</span>
          </div>
        </div>;
      })()}
      </>}
    </>}
    </>}
    {page === 'telegram-human' && <TelegramHumanInbox supabase={supabase} profile={profile} profiles={profiles} />}
    {page === 'telegram-analytics' && <>
    <h2 style={{marginTop:0}}>Telegram group analytics</h2>
    <KnowMore>Metrics begin after the analytics bot is added and receives new group messages. Telegram bots cannot read earlier group history or provide group read receipts.</KnowMore>
    <div style={{ padding: 14, margin: '12px 0 18px', border: '1px solid #344054', borderRadius: 12, background: 'var(--crm-card-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 220, flex: '1 1 260px' }}>
          <strong style={{ display: 'block', fontSize: 15 }}>Connect your work groups</strong>
          <p style={{ ...muted, margin: '5px 0 0' }}>Add @md_shobbot to your work groups.</p>
        </div>
        {!isSupervisor && <a href="https://t.me/md_shobbot?startgroup=crm_group_analytics" target="_blank" rel="noreferrer" style={{ ...button, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          <span aria-hidden="true">＋</span> Add the bot to your chats
        </a>}
      </div>
      {isAdmin && <details style={{ marginTop: 12, borderTop: '1px solid var(--crm-border)', paddingTop: 10, color: 'var(--crm-text)' }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Admin setup details</summary>
        <ol style={{ paddingLeft: 21, margin: '10px 0 0', lineHeight: 1.7, fontSize: 12 }}>
          <li>Open the add-bot option and select the company work group.</li>
          <li>Confirm that the bot is allowed to receive group messages.</li>
          <li>For full message analytics, the configured bot (@md_shobbot) must have message access. If Telegram privacy settings prevent this, the Admin must disable Group Privacy through <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: 'var(--crm-accent)' }}>BotFather</a>, then remove and add the bot again.</li>
          <li>For reaction analytics, make the bot a group administrator and register the webhook for both <code>message_reaction</code> and <code>message_reaction_count</code> updates. Telegram does not send these updates unless both conditions are met.</li>
        </ol>
        <p style={{ ...muted, margin: '8px 0 0', fontSize: 11 }}>Only newly received messages are collected; earlier group history and read receipts are not available to Telegram bots. Ensure participants know that messages are processed for CRM analytics.</p>
      </details>}
    </div>
    {(isAdmin || isSupervisor) && <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,maxWidth:900,margin:'18px 0'}}>
      <label>Team Leader / Admin / Supervisor<select style={input} value={selectedTeamLeader} onChange={e=>{setSelectedTeamLeader(e.target.value);setSelectedGroupOwner('');setSelectedGroup('');setMessages([]);}}><option value="">Choose Team Leader, Admin or Supervisor…</option>{analyticsTeamLeaders.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Manager / Group Owner<select style={input} value={selectedGroupOwner} disabled={!selectedTeamLeader} onChange={e=>{setSelectedGroupOwner(e.target.value);setSelectedGroup('');setMessages([]);}}><option value="">Choose manager…</option>{analyticsOwners.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
    </div>}
    <label style={{ display:'block', maxWidth:460, margin:'18px 0' }}>Select a group chat<select style={{ ...input, maxWidth: 460 }} value={selectedGroup} onChange={e => { if (groupOlderCacheTimerRef.current !== null) window.clearTimeout(groupOlderCacheTimerRef.current); groupOlderCacheTimerRef.current = null; setMessages([]); groupInitialScrollPendingRef.current = true; setGroupMessagesHasMore(false); setGroupMessagesAtTop(false); setSelectedGroup(e.target.value); }}><option value="">Choose a Telegram group to open…</option>{(isAdmin || isSupervisor ? analyticsGroups : analyticsGroups).map(g => <option key={g.telegram_chat_id} value={String(g.telegram_chat_id)}>{g.group_title}</option>)}</select></label>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 12, margin: '14px 0' }}>
      <article style={{ padding: 14, border: '1px solid #344054', borderRadius: 10 }}><div style={muted}>Messages loaded</div><strong style={{ fontSize: 24 }}>{messages.length}</strong></article>
      <article style={{ padding: 14, border: '1px solid #344054', borderRadius: 10 }}><div style={muted}>Replies measured</div><strong style={{ fontSize: 24 }}>{answered.length}</strong></article>
      <article style={{ padding: 14, border: '1px solid #344054', borderRadius: 10 }}><div style={muted}>Average response</div><strong style={{ fontSize: 24 }}>{prettyDuration(avgSeconds)}</strong></article>
    </div>
    {notice && <p role="status" style={{ padding: 10, background: '#202b3e', borderRadius: 8, overflowWrap: 'anywhere' }}>{notice}</p>}
    {translationNotice && page === 'telegram-analytics' && <p role="status" style={{padding:'7px 10px',margin:'8px 0',background:'#202b3e',borderRadius:8,color:'#c7d9ee',fontSize:12,overflowWrap:'anywhere'}}>{translationNotice}</p>}
    {loading && <p style={muted}>Loading management data…</p>}
    {!selectedGroup ? <div style={{ padding:34, border:'1px dashed #475467', borderRadius:14, textAlign:'center', color:'#b7c0d1', background:'#101828' }}><div style={{ fontSize:30, marginBottom:10 }}>💬</div><strong style={{ color:'#f8fafc' }}>Choose a group to open its chat</strong><p style={muted}>Messages stay hidden until you select a Telegram group above.</p></div> : <>
      <h3>Chat · {groups.find(g=>String(g.telegram_chat_id)===selectedGroup)?.title || 'Selected group'}</h3>
      <div style={{ border:'1px solid #344054', borderRadius:14, overflow:'hidden', background:'#0e1726' }}>
        <header style={{ padding:'13px 16px', background:'#18263a', borderBottom:'1px solid #344054', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}><div><strong>{groups.find(g=>String(g.telegram_chat_id)===selectedGroup)?.title || 'Telegram group'}</strong><div style={{ ...muted, marginTop:3 }}>{messages.length} captured messages · newest at bottom · scroll up for older messages</div></div><div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{ fontSize:11, color:'#8dd8ae' }}>● CRM archive</span><select aria-label="Translation language" value={translationTarget} onChange={event => {setTranslationTarget(event.target.value);setTranslationNotice('');}} disabled={translationLoading} style={{padding:'7px 9px',border:'1px solid #475467',borderRadius:8,background:'#101828',color:'#f8fafc',fontSize:12}}><option value="EN-US">English</option><option value="BN">Bengali</option><option value="RU">Russian</option></select><button type="button" onClick={() => {setTranslationActivated(value => !value);setTranslationNotice(translationActivated ? 'Per-message translation controls hidden.' : 'Translation activated. Choose a source language and translate messages individually.');}} disabled={translationLoading} style={{...button,padding:'7px 11px',fontSize:12}}>{translationActivated ? 'Deactivate Translation' : 'Activate Translation'}</button></div></header>
        <div className="telegram-group-messages-surface" ref={groupMessagesContainerRef} onScroll={event => setGroupMessagesAtTop(event.currentTarget.scrollTop <= 32)} style={{ position:'relative', padding:16, display:'flex', flexDirection:'column', gap:10, maxHeight:480, overflowY:'auto', backgroundImage:'radial-gradient(#24344b 0.7px, transparent 0.7px)', backgroundSize:'14px 14px' }}>{groupMessagesHasMore && groupMessagesAtTop && <button type="button" disabled={groupMessagesLoadingOlder} onClick={() => void loadOlderGroupMessages()} style={{ position:'sticky', top:0, zIndex:2, alignSelf:'center', margin:'-6px 0 2px', padding:'6px 13px', border:'1px solid #ffffff35', borderRadius:999, background:'rgba(18, 28, 43, .58)', color:'#e8eef8', backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)', cursor:groupMessagesLoadingOlder?'wait':'pointer', fontSize:12, boxShadow:'0 2px 10px #0003' }}>{groupMessagesLoadingOlder ? 'Loading older messages…' : '↑ Load older messages'}</button>}
          {[...messages].filter(m=>String(m.telegram_chat_id)===selectedGroup).map(m => {
            const raw=m.raw_update || {};
            const msg=(raw.message || raw.edited_message || raw.channel_post || raw.edited_channel_post || {}) as Record<string, any>;
            const photo=Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length-1] : null;
            const doc=msg.document || msg.video || msg.animation || msg.audio || msg.voice || null;
            const media=photo || doc;
            const mediaName=doc?.file_name || (photo ? 'Photo attachment' : msg.video ? 'Video attachment' : msg.voice ? 'Voice message' : msg.sticker ? 'Sticker' : null);
            const messageKey = String(m.telegram_chat_id) + ':' + String(m.telegram_message_id);
            const messageSource = messageSourceOverrides[messageKey] || 'default';
            const messageTranslation = translations[selectedGroup + ':' + translationTarget + ':' + messageSource + ':' + messageKey];
            const reactionSummary = new Map<string, { label: string; count: number }>();
            for (const row of messageReactions.filter(reaction => reaction.telegram_chat_id === m.telegram_chat_id && reaction.telegram_message_id === m.telegram_message_id)) {
              for (const reaction of row.reactions || []) {
                const key = reactionIdentity(reaction);
                const current = reactionSummary.get(key) || { label: reactionText(reaction), count: 0 };
                current.count += 1;
                reactionSummary.set(key, current);
              }
            }
            const anonymousCounts = messageReactionCounts.find(row => row.telegram_chat_id === m.telegram_chat_id && row.telegram_message_id === m.telegram_message_id);
            for (const item of anonymousCounts?.reactions || []) {
              const key = reactionIdentity(item);
              const current = reactionSummary.get(key) || { label: reactionText(item), count: 0 };
              current.count += Number(item.total_count || 0);
              reactionSummary.set(key, current);
            }
            return <article className="telegram-group-message-card" key={m.telegram_chat_id+':'+m.telegram_message_id} style={{ alignSelf:'flex-start', width:'fit-content', maxWidth:'min(620px, 92%)', padding:'9px 12px 7px', border:'1px solid #d6e0eb', borderRadius:'4px 13px 13px 13px', background:'#ffffff', color:'#172b43', boxShadow:'0 2px 8px rgba(27,52,82,.08)' }}>
              <div className="telegram-group-message-author" style={{ color:'#8ed0ff', fontSize:12, fontWeight:700, marginBottom:5 }}>{m.display_name || (m.username ? '@'+m.username : 'Unknown sender')}</div>
              {media && <div style={{margin:'6px 0',padding:10,border:'1px solid #41566e',background:'#132033',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}><span style={{fontSize:24}}>{photo ? '🖼️' : msg.video ? '🎞️' : msg.voice || msg.audio ? '🎙️' : msg.sticker ? '✨' : '📎'}</span><span style={{fontSize:12,overflowWrap:'anywhere',flex:1,minWidth:120}}><strong>{mediaName || 'Attachment'}</strong><br/><span style={{color:'#9aaec5'}}>{media.file_size ? (media.file_size > 1048576 ? (media.file_size / 1048576).toFixed(1)+' MB' : Math.max(1,Math.round(media.file_size / 1024))+' KB')+' · ' : ''}Private on-demand preview</span></span><button type="button" style={{...button,padding:'7px 10px',fontSize:12}} disabled={mediaLoading===m.telegram_chat_id+':'+m.telegram_message_id} onClick={() => void openAttachment(m, mediaName || 'Telegram attachment')}>{mediaLoading===m.telegram_chat_id+':'+m.telegram_message_id ? 'Loading…' : 'Preview'}</button>{mediaErrors[m.telegram_chat_id+':'+m.telegram_message_id] && <p role="alert" style={{width:'100%',margin:'4px 0 0',color:'#fda29b',fontSize:12,overflowWrap:'anywhere'}}>{mediaErrors[m.telegram_chat_id+':'+m.telegram_message_id]}</p>}</div>}
              <div className="telegram-group-message-body" style={{ whiteSpace:'pre-wrap', overflowWrap:'anywhere', lineHeight:1.5, fontSize:14 }}>{m.message_text || (!media ? '[non-text message]' : '')}</div>
              {translationActivated && m.message_text?.trim() && <div style={{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:6,marginTop:7,flexWrap:'wrap'}}><label style={{fontSize:10,color:'#91a2b8'}}>Source</label><select aria-label={'Source language for message ' + messageKey} value={messageSource} onChange={event => {setMessageSourceOverrides(current => ({...current,[messageKey]:event.target.value}));setTranslationNotice('Source language selected for this message.');}} disabled={translationLoading} style={{maxWidth:150,padding:'4px 6px',border:'1px solid #40566f',borderRadius:6,background:'#132033',color:'#c7d9ee',fontSize:10}}><option value="default">Default (auto-detect)</option><option value="EN">English</option><option value="RU">Russian</option></select><button type="button" onClick={() => void translateSingleGroupMessage(m, messageSource)} disabled={translationLoading || Boolean(messageTranslation)} style={{...button,padding:'5px 9px',fontSize:10,opacity:translationLoading || messageTranslation ? 0.6 : 1}}>{messageTranslation ? 'Translated' : translationLoading ? 'Translating…' : 'Translate'}</button></div>}
              {translationActivated && m.message_text?.trim() && messageTranslation && <div style={{marginTop:7,paddingTop:7,borderTop:'1px solid #45607c',color:'#c7d9ee',whiteSpace:'pre-wrap',overflowWrap:'anywhere',lineHeight:1.5,fontSize:13}}><div style={{fontSize:10,fontWeight:700,letterSpacing:'.04em',textTransform:'uppercase',color:'#8ed0ff',marginBottom:3}}>Translation · {translationTarget === 'EN-US' ? 'English' : translationTarget === 'BN' ? 'Bengali' : 'Russian'}</div>{messageTranslation}</div>}
              {reactionSummary.size > 0 && <div aria-label="Message reactions" style={{ display:'flex', flexWrap:'wrap', gap:5, marginTop:7 }}>
                {[...reactionSummary.entries()].map(([key, reaction]) => <span key={key} title="Current reaction count" style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 7px', borderRadius:999, background:'#2a3d55', border:'1px solid #45607c', color:'#f0f6ff', fontSize:12 }}>{reaction.label} <strong>{reaction.count}</strong></span>)}
              </div>}
              <div style={{ textAlign:'right', color:'#91a2b8', fontSize:10, marginTop:5 }}>{new Date(m.message_date).toLocaleString()}{m.reply_to_message_id ? ' · ↩ '+m.reply_to_message_id : ''}</div>
            </article>;
          })}
          {!messages.some(m=>String(m.telegram_chat_id)===selectedGroup) && <p style={{ ...muted, textAlign:'center', padding:20 }}>No captured messages for this group yet. New messages appear after the analytics bot receives them.</p>}
        </div>
        {activeMedia && <div role="dialog" aria-modal="true" aria-label="Telegram attachment preview" style={{position:'fixed',inset:0,zIndex:1000,background:'#020617eF',display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={() => setActiveMedia(null)}><div style={{width:'min(900px,100%)',maxHeight:'90vh',overflow:'auto',background:'#101828',border:'1px solid #475467',borderRadius:14,padding:16}} onClick={e => e.stopPropagation()}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:12}}><strong style={{overflowWrap:'anywhere'}}>{activeMedia.name}</strong><button type="button" style={button} onClick={() => setActiveMedia(null)}>Close</button></div>{activeMedia.mime.startsWith('image/') ? <img src={activeMedia.url} alt={activeMedia.name} style={{display:'block',maxWidth:'100%',maxHeight:'70vh',margin:'0 auto',objectFit:'contain'}}/> : activeMedia.mime.startsWith('video/') ? <video src={activeMedia.url} controls playsInline style={{display:'block',width:'100%',maxHeight:'70vh'}}/> : activeMedia.mime.startsWith('audio/') ? <audio src={activeMedia.url} controls style={{width:'100%'}}/> : <p style={muted}>This file type is not previewable in the browser. Use the button below to open or save it.</p>}<div style={{marginTop:14}}><a href={activeMedia.url} download={activeMedia.name} target="_blank" rel="noreferrer" style={{...button,display:'inline-block',textDecoration:'none'}}>Download / open file</a></div><p style={muted}>This temporary preview stays in memory and is cleared when closed or when you change groups.</p></div></div>}
        <footer style={{ padding:'10px 14px', borderTop:'1px solid #344054', color:'#8291a8', fontSize:11 }}>Read-only view of messages captured by the CRM analytics bot. Sending messages from this window is not supported.</footer>
      </div>
    </>}
    <h3>Participant activity · last 7 days</h3>
    <p style={{ ...muted, marginTop: -4 }}>Messages sent by each user in the selected group. Bars show each participant’s share relative to the most active user.</p>
    {groupActivity.length > 0 ? <div style={{ display: 'grid', gap: 12, padding: 14, border: '1px solid #344054', borderRadius: 12, background: 'var(--crm-card-bg)' }}>
      {groupActivity.map(person => {
        const name = person.display_name || (person.username ? '@' + person.username : 'Telegram user ' + person.telegram_user_id);
        const width = Math.max(3, Math.round((person.message_count / maxActivity) * 100));
        return <div key={person.telegram_user_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 190px) minmax(90px, 1fr) auto', alignItems: 'center', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--crm-text)', fontWeight: 650, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</div>
            <div style={{ ...muted, fontSize: 10 }}>Last active {new Date(person.last_message_at).toLocaleString()}</div>
          </div>
          <div role="img" aria-label={name + ': ' + person.message_count + ' messages'} style={{ height: 13, borderRadius: 999, overflow: 'hidden', background: 'var(--crm-card-raised, #253247)' }}>
            <div style={{ height: '100%', width: width + '%', borderRadius: 999, background: 'var(--crm-accent-strong, var(--crm-accent))', transition: 'width .25s ease' }} />
          </div>
          <strong style={{ color: 'var(--crm-text)', fontSize: 13, minWidth: 64, textAlign: 'right' }}>{person.message_count.toLocaleString()} <span style={{ ...muted, fontSize: 10, fontWeight: 500 }}>msgs</span></strong>
        </div>;
      })}
      <div style={{ ...muted, fontSize: 11, borderTop: '1px solid var(--crm-border)', paddingTop: 9 }}>Total captured messages: {groupActivity.reduce((sum, person) => sum + person.message_count, 0).toLocaleString()}</div>
    </div> : <div style={{ padding: 18, border: '1px dashed #475467', borderRadius: 12, color: 'var(--crm-muted, #98a2b3)', textAlign: 'center' }}>No participant activity captured for this group in the last 7 days.</div>}
    <h3 style={{ marginBottom: 4 }}>Daily participant activity</h3>
    <p style={{ ...muted, marginTop: 0 }}>Messages per participant by day, based on Telegram message timestamps and your local time zone.</p>
    {groupActivity.length > 0 ? <div style={{ overflowX: 'auto', border: '1px solid #344054', borderRadius: 12, padding: 12, background: 'var(--crm-card-bg)' }}>
      <div style={{ minWidth: 660 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 210px) repeat(7, minmax(48px, 1fr)) minmax(58px, auto)', gap: 8, alignItems: 'end', paddingBottom: 8, borderBottom: '1px solid var(--crm-border)' }}>
          <span style={{ ...muted, fontSize: 11 }}>Participant</span>
          {activityDayKeys.map(day => <span key={day} style={{ ...muted, fontSize: 10, textAlign: 'center' }}>{new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</span>)}
          <span style={{ ...muted, fontSize: 11, textAlign: 'right' }}>7-day total</span>
        </div>
        {groupActivity.map(person => {
          const perDay = dailyActivityByUser.get(person.telegram_user_id);
          const dailyValues = activityDayKeys.map(day => perDay?.get(day) ?? 0);
          const total = dailyValues.reduce((sum, value) => sum + value, 0);
          return <div key={person.telegram_user_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 210px) repeat(7, minmax(48px, 1fr)) minmax(58px, auto)', gap: 8, alignItems: 'end', padding: '11px 0', borderBottom: '1px solid var(--crm-border)' }}>
            <span style={{ color: 'var(--crm-text)', fontSize: 12, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.display_name || (person.username ? '@' + person.username : 'Telegram user ' + person.telegram_user_id)}</span>
            {dailyValues.map((count, index) => <div key={activityDayKeys[index]} title={activityDayKeys[index] + ': ' + count + ' messages'} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--crm-muted, #98a2b3)' }}>{count || ''}</span>
              <div style={{ width: '70%', height: 42, display: 'flex', alignItems: 'flex-end', background: 'var(--crm-card-raised, #253247)', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ width: '100%', height: count ? Math.max(5, Math.round((count / maxDailyActivity) * 42)) : 0, background: 'var(--crm-accent-strong, var(--crm-accent))', borderRadius: 5 }} />
              </div>
            </div>)}
            <strong style={{ color: 'var(--crm-text)', fontSize: 12, textAlign: 'right' }}>{total.toLocaleString()}</strong>
          </div>;
        })}
      </div>
    </div> : <p style={muted}>Daily analytics will appear after messages are collected.</p>}
    <h3 style={{ marginBottom: 4 }}>Average response time · last 7 days</h3>
    <p style={{ ...muted, marginTop: 0 }}>Reply time measures the delay between a message and another participant's reply. Reaction time measures the delay between the original message and a participant's first recorded reaction.</p>
    {participantResponses.length > 0 ? <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
        <thead><tr>{['Participant', 'Replies', 'Average reply time', 'Reactions', 'Average time to react'].map(label => <th key={label} style={cell}>{label}</th>)}</tr></thead>
        <tbody>{participantResponses.map(person => <tr key={person.telegram_user_id}>
          <td style={cell}>{person.display_name || (person.username ? '@' + person.username : 'Telegram user ' + person.telegram_user_id)}</td>
          <td style={cell}>{person.reply_count.toLocaleString()}</td>
          <td style={cell}>{person.avg_reply_seconds == null ? '—' : prettyDuration(Math.round(person.avg_reply_seconds))}</td>
          <td style={cell}>{person.reaction_count.toLocaleString()}</td>
          <td style={cell}>{person.avg_reaction_seconds == null ? '—' : prettyDuration(Math.round(person.avg_reaction_seconds))}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p style={muted}>Response-time statistics will appear when replies and reaction updates are captured for this group.</p>}
    </>}
  </section>;
}
