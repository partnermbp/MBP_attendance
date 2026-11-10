
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, X, MapPin, LayoutDashboard, Users, CalendarDays, MessageCircle, MoreHorizontal, LogOut, ShieldAlert, ChevronDown, ChevronRight, UserCog, Link2, GitBranch, UserPlus, Settings as SettingsIcon, Sun, Moon, Monitor, RotateCcw, Clock3, Palette, Eye, Download, Smartphone } from 'lucide-react';
import type { CSSProperties, FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import ManagementTools from './components/ManagementTools';
import TeamAttendanceReport from './components/TeamAttendanceReport';
import ManagerHierarchy from './components/ManagerHierarchy';
import TelegramIdRequests from './components/TelegramIdRequests';
import KnowMore from './components/KnowMore';

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
  check_in_region?: string | null;
  check_in_country?: string | null;
  check_out_region?: string | null;
  check_out_country?: string | null;
  check_in_gps_recorded?: boolean;
  check_out_gps_recorded?: boolean;
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
  telegram_user_id?: number | null;
  telegram_verified_at?: string | null;
  telegram_username?: string | null;
};

type ManagerAssignment = { manager_id: string; employee_id: string };

type Screen = 'loading' | 'login' | 'set-password' | 'signed-in';
type CrmPage = 'dashboard' | 'downloads' | 'attendance' | 'attendance-records' | 'team-attendance' | 'team' | 'manager-hierarchy' | 'team-roles' | 'team-links' | 'team-assignments' | 'team-invitations' | 'telegram' | 'telegram-human' | 'telegram-analytics' | 'security' | 'requests' | 'settings';
type CrmPreferences = { theme: 'night' | 'day'; accent: 'orange' | 'blue'; nightLight: boolean; compact: boolean; reducedMotion: boolean; timezone: string };
const DEFAULT_PREFERENCES: CrmPreferences = { theme: 'night', accent: 'orange', nightLight: false, compact: false, reducedMotion: false, timezone: 'local' };
function loadCrmPreferences(): CrmPreferences { try { const raw = localStorage.getItem('mbp_crm_preferences'); return raw ? { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) } : DEFAULT_PREFERENCES; } catch { return DEFAULT_PREFERENCES; } }
type PasswordFlow = 'invite' | 'recovery' | null;

type Coordinates = {
  latitude: number;
  longitude: number;
};

const CRM_WEB_APP_URL = 'https://attendence.dpdns.org/';
const ANDROID_APK_DOWNLOAD_URL = 'https://github.com/partnermbp/MBP_attendance/releases/download/android-latest/app-debug.apk';
const WINDOWS_EXE_DOWNLOAD_URL = 'https://github.com/partnermbp/MBP_attendance/releases/download/windows-latest/MBP-Attendance-Setup-0.1.0.exe';
const MACOS_DMG_DOWNLOAD_URL = 'https://github.com/partnermbp/MBP_attendance/releases/download/macos-latest/MBP-Attendance-0.1.0-macOS.dmg';
const IOS_WEBCLIP_DOWNLOAD_URL = '/mbp-attendance-ios.mobileconfig';
const BREAK_MINUTES = 60;
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
const INACTIVITY_STORAGE_PREFIX = 'mbp_crm_last_activity_';
const BREAK_THRESHOLD_MINUTES = 5 * 60;
const DAILY_REQUIRED_WORK_MINUTES = 8 * 60;
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
    const liveBreakMilliseconds = elapsedMilliseconds >= BREAK_THRESHOLD_MINUTES * 60000
      ? BREAK_MINUTES * 60000
      : 0;
    return {
      elapsed: formatDuration(elapsedMilliseconds),
      worked: formatDuration(Math.max(0, elapsedMilliseconds - liveBreakMilliseconds)),
      breakDeduction: liveBreakMilliseconds > 0 ? formatDuration(liveBreakMilliseconds) : 'Not applied yet',
      status: 'Open session',
    };
  }

  const breakMilliseconds = elapsedMilliseconds >= BREAK_THRESHOLD_MINUTES * 60000
    ? BREAK_MINUTES * 60000
    : 0;

  const workedMilliseconds = Math.max(0, elapsedMilliseconds - breakMilliseconds);

  return {
    elapsed: formatDuration(elapsedMilliseconds),
    worked: formatDuration(workedMilliseconds),
    breakDeduction: formatDuration(breakMilliseconds),
    status: 'Completed',
  };
}

function toCoordinates(latitude: number, longitude: number): Coordinates {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error('The device returned invalid coordinates.');
  }

  return { latitude, longitude };
}

async function getLocation(): Promise<Coordinates> {
  if (Capacitor.isNativePlatform()) {
    try {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      });
      return toCoordinates(position.coords.latitude, position.coords.longitude);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error ?? '');
      if (/permission|denied/i.test(detail)) {
        throw new Error('Location permission was denied. Allow MBP Attendance to access location in Android Settings.');
      }
      if (/timeout/i.test(detail)) {
        throw new Error('Location request timed out. Please try again.');
      }
      throw new Error('Your current location is unavailable. Check that Location is enabled and try again.');
    }
  }

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not supported by this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        try {
          resolve(toCoordinates(coords.latitude, coords.longitude));
        } catch (error) {
          reject(error);
        }
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

async function getFunctionRequestError(error: unknown): Promise<string> {
  const item = error as { name?: string; message?: string; context?: unknown };
  const name = typeof item?.name === 'string' ? item.name : 'RequestError';
  const message = typeof item?.message === 'string' ? item.message : 'The browser could not complete the request.';
  const context = item?.context;
  if (context instanceof Response) {
    let body = '';
    try { body = (await context.clone().text()).slice(0, 500); } catch { /* response body unavailable */ }
    return `${name}: HTTP ${context.status}${body ? ' — ' + body : ''}`;
  }
  if (context && typeof context === 'object') {
    const response = context as { status?: number; statusText?: string; name?: string; message?: string; cause?: unknown };
    if (typeof response.status === 'number') return `${name}: HTTP ${response.status}${response.statusText ? ' ' + response.statusText : ''}`;
    const nested = [response.name, response.message].filter((value): value is string => typeof value === 'string' && value.length > 0).join(': ');
    const cause = response.cause instanceof Error ? `${response.cause.name}: ${response.cause.message}` : '';
    if (nested || cause) return `${name}: ${nested || message}${cause ? ' (cause: ' + cause + ')' : ''}`;
  }
  return `${name}: ${message}`;
}

function isApprovedEmail(email: string) {
  const normalized = email.trim().toLowerCase();

  if (['partnermbp@gmail.com', 'vladimirlenin458@gmail.com', 'gameon892@gmail.com'].includes(normalized)) return true;

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



export default function App() {
  // Provide a brief physical press animation without implying that every click
  // completed successfully. Actual success/error feedback belongs to each action.
  useEffect(() => {
    const getButton = (event: Event) => {
      const target = event.target;
      return target instanceof Element ? target.closest('button') : null;
    };
    const press = (event: Event) => {
      const button = getButton(event);
      if (button instanceof HTMLButtonElement && !button.disabled) {
        button.classList.add('button-pressed');
      }
    };
    const release = () => {
      document.querySelectorAll('button.button-pressed').forEach((button) => {
        button.classList.remove('button-pressed');
      });
    };
    // Keep a visible click pulse after pointerup as well. This is especially
    // useful for the compact Save controls in Team Management, whose press
    // state otherwise lasts only for the brief physical pointer press.
    const clickFeedback = (event: MouseEvent) => {
      const button = getButton(event);
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;
      button.classList.remove('button-clicked');
      void button.offsetWidth;
      button.classList.add('button-clicked');
      window.setTimeout(() => button.classList.remove('button-clicked'), 220);
    };
    document.addEventListener('click', clickFeedback, true);
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    document.addEventListener('keydown', press, true);
    document.addEventListener('keyup', release, true);
    window.addEventListener('blur', release);
    return () => {
      document.removeEventListener('click', clickFeedback, true);
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      document.removeEventListener('keydown', press, true);
      document.removeEventListener('keyup', release, true);
      window.removeEventListener('blur', release);
      release();
    };
  }, []);

  const [passwordFlow, setPasswordFlow] =
    useState<PasswordFlow>(readPasswordFlow);
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite') || '');
  const [inviteDetails, setInviteDetails] = useState<InvitationDetails | null>(null);
  const [inviteChallenge, setInviteChallenge] = useState('');
  const [inviteOtp, setInviteOtp] = useState('');
  const [inviteTelegramVerified, setInviteTelegramVerified] = useState(false);
  const [invitePasswordStep, setInvitePasswordStep] = useState(false);
  const [inviteEmailOtp, setInviteEmailOtp] = useState('');
  const [inviteEmailSent, setInviteEmailSent] = useState(false);
  const [inviteEmailVerified, setInviteEmailVerified] = useState(false);
  const [emailRegistrationTicket, setEmailRegistrationTicket] = useState('');
  const [registrationTicket, setRegistrationTicket] = useState('');
  const [screen, setScreen] = useState<Screen>('loading');
  const [profileReady, setProfileReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [telegramOtp, setTelegramOtp] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [emailOtpRequested, setEmailOtpRequested] = useState(false);
  const [mfaChallengeTicket, setMfaChallengeTicket] = useState('');
  const mfaLoginInProgressRef = useRef(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [showTelegramIdRequest, setShowTelegramIdRequest] = useState(false);
  const [oldTelegramIdInput, setOldTelegramIdInput] = useState('');
  const [newTelegramIdInput, setNewTelegramIdInput] = useState('');
  const [telegramIdChangeComment, setTelegramIdChangeComment] = useState('');
  const [telegramIdLookupBusy, setTelegramIdLookupBusy] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [mapPreview, setMapPreview] = useState<{ title: string; latitude: number; longitude: number } | null>(null);
  const [navOpen, setNavOpen] = useState(true);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [preferences, setPreferences] = useState<CrmPreferences>(loadCrmPreferences);
  const [settingsNotice, setSettingsNotice] = useState('');
  const updatePreference = <K extends keyof CrmPreferences>(key: K, value: CrmPreferences[K]) => { setPreferences(current => { const next = { ...current, [key]: value }; try { localStorage.setItem('mbp_crm_preferences', JSON.stringify(next)); } catch { /* Browser storage may be disabled. */ } return next; }); setSettingsNotice('Your preferences have been saved on this device.'); };
  useEffect(() => { const root = document.documentElement; root.dataset.crmTheme = preferences.theme; root.dataset.crmAccent = preferences.accent; root.classList.toggle('crm-compact', preferences.compact); root.classList.toggle('crm-reduced-motion', preferences.reducedMotion); root.classList.toggle('crm-night-light', preferences.nightLight); document.body.dataset.crmTheme = preferences.theme; }, [preferences]);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const [attendanceMenuOpen, setAttendanceMenuOpen] = useState(false);
  const [telegramMembers, setTelegramMembers] = useState<Array<{telegram_user_id:number;profile_id:string|null}>>([]);
  const [telegramResponseMetrics, setTelegramResponseMetrics] = useState<Array<{question_user_id:number|null;first_reply_user_id:number|null;response_seconds:number|null}>>([]);
  const [telegramMenuOpen, setTelegramMenuOpen] = useState(false);
  const [activePage, setActivePage] = useState<CrmPage>('dashboard');
  const [telegramHumanNavKey, setTelegramHumanNavKey] = useState(0);
  const [humanTelegramAccess, setHumanTelegramAccess] = useState(false);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [salaryAttendance, setSalaryAttendance] = useState<Attendance[]>([]);
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
  const stopHoldTimer = useRef<number | null>(null);
  const [stopHoldArmed, setStopHoldArmed] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClockNow(Date.now());
    }, 1000);

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
      const savedEmailTicket = sessionStorage.getItem('mbp_email_registration_ticket_' + inviteToken) || '';
      if (savedEmailTicket) {
        setEmailRegistrationTicket(savedEmailTicket);
        setInviteEmailVerified(true);
        setInvitePasswordStep(true);
      }
      if (!details.valid) setMessage('This invitation has expired or has already been used.');
    })();
    return () => { cancelled = true; };
  }, [inviteToken]);

  const recordCrmLogin = useCallback(async (loginMethod: 'password_2fa' | 'telegram_otp' | 'invitation_registration') => {
    if (!supabase) return;
    try {
      const { error } = await supabase.rpc('record_crm_login', { p_login_method: loginMethod });
      if (error) console.error('CRM login audit could not be recorded:', error.message);
    } catch (error) {
      console.error('CRM login audit could not be recorded:', error);
    }
  }, []);

  const loadDashboard = useCallback(async (userId: string) => {
    if (!supabase) return;
    // Do not render any signed-in navigation or page content until the role
    // and all role-scoped dashboard data have finished loading.
    setProfileReady(false);
    setProfile(null);
    setLoadingDashboard(true);

    try {
      const profileResult = await supabase
        .from('profiles')
        .select('id, email, full_name, role, active, telegram_user_id, telegram_verified_at, telegram_username')
        .eq('id', userId)
        .maybeSingle();

      if (profileResult.error) {
        setProfile(null);
        setMessage(`Could not load account role: ${profileResult.error.message}`);
        return;
      }

      let currentProfile = profileResult.data as Profile | null;
      setProfile(currentProfile);
      // The authenticated user's own profile is a reliable fallback if the
      // Telegram status Edge Function is temporarily unavailable.
      const profileTelegramLinked = currentProfile?.telegram_user_id != null || currentProfile?.telegram_verified_at != null;
      setTelegramLinked(profileTelegramLinked);
      try {
        const { data: telegramStatus, error: telegramStatusError } = await supabase.functions.invoke('telegram-auth', { body: { action: 'link_status' } });
        if (!telegramStatusError && telegramStatus?.ok === true && typeof telegramStatus.linked === 'boolean') {
          setTelegramLinked(telegramStatus.linked);
        }
      } catch {
        // Keep the status derived from the authenticated user's own profile.
      }
      const isAdmin = currentProfile?.active === true &&
        String(currentProfile.role).toLowerCase() === 'admin';

      if (isAdmin) {
        const [peopleResult, attendanceResult, assignmentsResult, shiftsResult, membersResult, responseMetricsResult] = await Promise.all([
          supabase.from('profiles')
            .select('id, email, full_name, role, active, telegram_user_id, telegram_verified_at, telegram_username')
            .order('full_name', { ascending: true })
            .limit(500),
          supabase.rpc('get_admin_attendance_with_gps'),
          supabase.from('manager_employee_assignments')
            .select('manager_id, employee_id')
            .limit(2000),
          supabase.from('shifts')
            .select('id, employee_id, starts_at, ends_at')
            .order('starts_at', { ascending: false })
            .limit(3000),
          supabase.from('telegram_group_members')
            .select('telegram_user_id, profile_id, username, display_name')
            .not('profile_id', 'is', null)
            .limit(5000),
          supabase.from('telegram_response_metrics')
            .select('question_user_id, first_reply_user_id, response_seconds')
            .limit(10000),
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
        setShifts((shiftsResult.data ?? []) as Shift[]);
        const groupTelegramMembers = (membersResult.data ?? []) as Array<{telegram_user_id:number;profile_id:string|null;username?:string|null;display_name?:string|null}>;
        const verifiedProfileLinks = ((peopleResult.data ?? []) as Array<Profile & {telegram_user_id?:number|null;telegram_verified_at?:string|null}>)
          .filter(person => person.telegram_user_id != null && person.telegram_verified_at != null)
          .map(person => {
            const groupMember = groupTelegramMembers.find(member => member.profile_id === person.id && Number(member.telegram_user_id) === Number(person.telegram_user_id));
            return { telegram_user_id: Number(person.telegram_user_id), profile_id: person.id, username: groupMember?.username ?? person.telegram_username ?? null, display_name: groupMember?.display_name ?? person.full_name ?? null, verified_at: person.telegram_verified_at };
          });
        const verifiedKeys = new Set(verifiedProfileLinks.map(member => member.profile_id + ':' + member.telegram_user_id));
        setTelegramMembers([...groupTelegramMembers.filter(member => !verifiedKeys.has(member.profile_id + ':' + member.telegram_user_id)), ...verifiedProfileLinks]);
        setTelegramResponseMetrics((responseMetricsResult.data ?? []) as Array<{question_user_id:number|null;first_reply_user_id:number|null;response_seconds:number|null}>);
      } else if (currentProfile?.active === true && ['junior', 'middle', 'senior', 'team leader'].includes(String(currentProfile.role).toLowerCase().replaceAll('_', ' '))) {
        setTelegramMembers([]); setTelegramResponseMetrics([]);
        const [hierarchyResult, teamAttendanceResult, shiftsResult, ownAttendanceResult] = await Promise.all([
          supabase.rpc('get_my_team_hierarchy_with_telegram'),
          supabase.functions.invoke('manager-team-attendance', { body: {} }),
          supabase.from('shifts').select('id, starts_at, ends_at').eq('employee_id', userId).order('starts_at', { ascending: true }).limit(100),
          supabase.from('attendance').select('id, employee_id, check_in, check_out, work_date, work_timezone').eq('employee_id', userId).order('check_in', { ascending: false }).limit(500),
        ]);
        if (hierarchyResult.error) {
          setProfiles([currentProfile]); setManagerAssignments([]);
          setMessage('Could not load reporting hierarchy: ' + hierarchyResult.error.message);
        } else {
          const descendants = (hierarchyResult.data ?? []) as Array<Profile & { manager_id: string; depth: number }>;
          setProfiles([currentProfile, ...descendants.map(({ id, email, full_name, role, active, telegram_user_id, telegram_username, telegram_verified_at }) => ({ id, email, full_name, role, active, telegram_user_id, telegram_username, telegram_verified_at }))]);
          setManagerAssignments(descendants.map(person => ({ manager_id: person.manager_id, employee_id: person.id })));
          setExpandedManagerIds(new Set([userId]));
        }
        if (ownAttendanceResult.error) setSalaryAttendance([]);
        else setSalaryAttendance((ownAttendanceResult.data ?? []) as Attendance[]);
        if (teamAttendanceResult.error) { setAttendance([]); setMessage(current => current || 'Could not load team attendance: ' + teamAttendanceResult.error.message); }
        else {
          setAttendance((Array.isArray(teamAttendanceResult.data?.records) ? teamAttendanceResult.data.records : []) as Attendance[]);
          setTelegramMembers((Array.isArray(teamAttendanceResult.data?.telegram_members) ? teamAttendanceResult.data.telegram_members : []) as Array<{telegram_user_id:number;profile_id:string|null;username?:string|null;display_name?:string|null}>);
          setTelegramResponseMetrics((Array.isArray(teamAttendanceResult.data?.telegram_metrics) ? teamAttendanceResult.data.telegram_metrics : []) as Array<{question_user_id:number|null;first_reply_user_id:number|null;response_seconds:number|null}>);
        }
        if (shiftsResult.error) setMessage(current => current || 'Could not load shifts: ' + shiftsResult.error.message);
        else setShifts((shiftsResult.data ?? []) as Shift[]);
      } else {
        setProfiles([]);
        setManagerAssignments([]);
        setTelegramMembers([]); setTelegramResponseMetrics([]);
        setExpandedManagerIds(new Set());
        const [attendanceResult, shiftsResult] = await Promise.all([
          supabase.from('attendance').select('id, employee_id, check_in, check_out, work_date, work_timezone').eq('employee_id', userId).order('check_in', { ascending: false }).limit(100),
          supabase.from('shifts').select('id, starts_at, ends_at').eq('employee_id', userId).order('starts_at', { ascending: true }).limit(100),
        ]);
        if (attendanceResult.error) setMessage('Could not load attendance: ' + attendanceResult.error.message);
        else { setAttendance((attendanceResult.data ?? []) as Attendance[]); setSalaryAttendance((attendanceResult.data ?? []) as Attendance[]); }
        if (shiftsResult.error) setMessage(current => current || 'Could not load shifts: ' + shiftsResult.error.message);
        else setShifts((shiftsResult.data ?? []) as Shift[]);
      }
    } catch {
      setMessage('Unable to load dashboard data. Please refresh.');
    } finally {
      setLoadingDashboard(false);
      setProfileReady(true);
    }
  }, [inviteToken, recordCrmLogin]);

  useEffect(() => {
    if (!supabase) {
      setScreen('login');
      return;
    }

    let alive = true;

    const applySession = async (nextSession: Session | null) => {
      if (!alive || mfaLoginInProgressRef.current) return;
      setSession(nextSession);
      if (nextSession?.user.email) setEmail(nextSession.user.email);
      if (nextSession && passwordFlow) {
        setScreen('set-password');
      } else if (nextSession) {
        try {
          const { data: validation, error: validationError } = await supabase!.functions.invoke('auth-mfa-login', { body: { action: 'validate' } });
          if (!alive) return;
          if (validationError || validation?.valid !== true) {
            setProfileReady(false);
            setSession(null);
            setScreen('login');
            setMessage('Your login verification has expired or is incomplete. Please sign in again.');
            await supabase!.auth.signOut({ scope: 'local' });
            return;
          }
          setScreen('signed-in');
          await loadDashboard(nextSession.user.id);
        } catch {
          if (!alive) return;
          setProfileReady(false);
          setSession(null);
          setScreen('login');
          setMessage('Could not validate your secure login. Please sign in again.');
          await supabase!.auth.signOut({ scope: 'local' });
        }
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
        if (mfaLoginInProgressRef.current) return;
        if (nextSession?.user.id) {
          try { localStorage.removeItem(INACTIVITY_STORAGE_PREFIX + nextSession.user.id); } catch { /* storage may be unavailable */ }
        }
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

  // Sign out after 60 minutes without real user interaction. The timestamp is
  // shared between tabs so activity in one CRM tab keeps the others alive too.
  useEffect(() => {
    if (!supabase || screen !== 'signed-in' || !session?.user.id) return;

    const storageKey = INACTIVITY_STORAGE_PREFIX + session.user.id;
    let lastActivityAt = Date.now();
    let lastStorageWriteAt = 0;
    let signingOut = false;

    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) lastActivityAt = saved;
      else localStorage.setItem(storageKey, String(lastActivityAt));
    } catch {
      // The in-memory timer still works when browser storage is unavailable.
    }

    const signOutForInactivity = async () => {
      if (signingOut) return;
      signingOut = true;
      setProfileReady(false);
      setMessage('You were signed out after 60 minutes of inactivity. Please sign in again.');
      try { localStorage.removeItem(storageKey); } catch { /* storage may be unavailable */ }
      await supabase!.auth.signOut({ scope: 'local' });
      setSession(null);
      setScreen('login');
    };

    const recordActivity = () => {
      if (signingOut) return;
      lastActivityAt = Date.now();
      if (lastActivityAt - lastStorageWriteAt < 5000) return;
      lastStorageWriteAt = lastActivityAt;
      try { localStorage.setItem(storageKey, String(lastActivityAt)); } catch { /* storage may be unavailable */ }
    };

    const checkInactivity = () => {
      if (Date.now() - lastActivityAt >= INACTIVITY_TIMEOUT_MS) {
        void signOutForInactivity();
      }
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'scroll',
    ];
    activityEvents.forEach(eventName => window.addEventListener(eventName, recordActivity, { passive: true }));
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkInactivity();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      if (event.newValue == null) {
        void signOutForInactivity();
        return;
      }
      const sharedActivityAt = Number(event.newValue);
      if (Number.isFinite(sharedActivityAt)) lastActivityAt = Math.max(lastActivityAt, sharedActivityAt);
    };
    window.addEventListener('storage', handleStorage);

    const interval = window.setInterval(checkInactivity, 5000);
    checkInactivity();

    return () => {
      activityEvents.forEach(eventName => window.removeEventListener(eventName, recordActivity));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorage);
      window.clearInterval(interval);
    };
  }, [screen, session?.user.id]);

  async function handleStartInviteTelegram() {
    if (!supabase || !inviteToken || !inviteDetails?.valid) return;
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await supabase.functions.invoke('telegram-auth', {
        body: { action: 'create_invite_telegram_challenge', invitation_token: inviteToken },
      });
      if (error) {
        console.error('Telegram invitation Edge Function request failed:', error);
        const projectHost = (() => { try { return new URL(import.meta.env.VITE_SUPABASE_URL).host; } catch { return 'unknown'; } })();
        setMessage('Telegram verification request failed: ' + await getFunctionRequestError(error) + ' (Supabase project: ' + projectHost + ')');
        return;
      }
      if (!data?.ok || !data?.bot_url) {
        setMessage(data?.error || 'The Telegram verification function returned an unexpected response.');
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
      setMessage('Telegram verified. Next, verify your official email address.');
    } catch (error) {
      setMessage('Telegram verification failed: ' + getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendInviteEmailOtp() {
    if (!supabase || !inviteToken || !registrationTicket) return;
    setBusy(true); setMessage('');
    try {
      const { data, error } = await supabase.functions.invoke('telegram-auth', { body: { action: 'send_invite_email_otp', invitation_token: inviteToken, registration_ticket: registrationTicket } });
      if (error || !data?.ok) { setMessage(data?.error || error?.message || 'Could not send the email verification code.'); return; }
      setInviteEmailSent(true);
      setMessage('A six-digit verification code has been sent to ' + (data.email || inviteDetails?.corporate_email) + '.');
    } catch (error) { setMessage('Email verification could not be started: ' + getErrorMessage(error)); }
    finally { setBusy(false); }
  }

  async function handleVerifyInviteEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !inviteToken) return;
    setBusy(true); setMessage('');
    try {
      const { data, error } = await supabase.functions.invoke('telegram-auth', { body: { action: 'verify_invite_email_otp', invitation_token: inviteToken, otp: inviteEmailOtp } });
      if (error) {
        let detail = error.message || 'Corporate email verification failed.';
        try {
          const response = (error as any).context;
          const payload = response ? await response.clone().json() : null;
          if (typeof payload?.error === 'string') detail = payload.error;
        } catch { /* Keep the SDK message if the response body is unavailable. */ }
        setMessage(detail);
        return;
      }
      if (!data?.ok || !data?.email_registration_ticket) { setMessage(data?.error || 'Corporate email verification failed.'); return; }
      setEmailRegistrationTicket(data.email_registration_ticket);
      sessionStorage.setItem('mbp_email_registration_ticket_' + inviteToken, data.email_registration_ticket);
      setInviteEmailVerified(true); setInvitePasswordStep(true); setInviteEmailOtp('');
      setMessage('Both Telegram and corporate email are verified. Create your password to activate the CRM account.');
    } catch (error) { setMessage('Corporate email verification failed: ' + getErrorMessage(error)); }
    finally { setBusy(false); }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !inviteToken) return;
    const normalizedEmail = email.trim().toLowerCase();
    const ticket = registrationTicket || sessionStorage.getItem('mbp_registration_ticket_' + inviteToken) || '';
    const emailTicket = emailRegistrationTicket || sessionStorage.getItem('mbp_email_registration_ticket_' + inviteToken) || '';
    if (!inviteDetails?.valid) {
      setMessage('This invitation is invalid, expired, or already used.');
      return;
    }
    if (!inviteTelegramVerified || !ticket) {
      setMessage('Verify your Telegram account with @mbpauthbot before registering.');
      return;
    }
    if (!inviteEmailVerified || !emailTicket) {
      setMessage('Verify the official email address before creating your account.');
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
      const { data: created, error: createError } = await supabase.functions.invoke('telegram-auth', {
        body: { action: 'create_invited_account', invitation_token: inviteToken, registration_ticket: ticket, email_registration_ticket: emailTicket, password },
      });
      if (createError || !created?.ok) {
        let serverMessage = created?.error || '';
        if (!serverMessage && createError && typeof createError === 'object' && 'context' in createError) {
          try {
            const context = (createError as { context?: Response }).context;
            const payload = context ? await context.clone().json() : null;
            if (typeof payload?.error === 'string') serverMessage = payload.error;
          } catch { /* Fall back to the SDK error message. */ }
        }
        setMessage(serverMessage || createError?.message || 'Account creation failed. Please try again.');
        return;
      }
      sessionStorage.removeItem('mbp_registration_ticket_' + inviteToken);
      sessionStorage.removeItem('mbp_email_registration_ticket_' + inviteToken);
      sessionStorage.removeItem('mbp_invite_challenge_' + inviteToken);
      mfaLoginInProgressRef.current = true;
      const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (signInError || !authData.session || !authData.user) {
        mfaLoginInProgressRef.current = false;
        setMessage('Your account has been created and verified. Sign in with your new password to enter the CRM.');
        window.history.replaceState({}, document.title, window.location.pathname); return;
      }
      setSession(authData.session);
      const { data: access, error: accessError } = await supabase.functions.invoke('auth-mfa-login', { body: { action: 'begin' } });
      if (accessError || !access?.ok || access.stage !== 'complete') {
        await supabase.auth.signOut({ scope: 'local' }); setSession(null);
        mfaLoginInProgressRef.current = false;
        setMessage(access?.error || accessError?.message || 'Registration is complete, but secure first access could not be approved. Please sign in again.');
        window.history.replaceState({}, document.title, window.location.pathname); setScreen('login'); return;
      }
      mfaLoginInProgressRef.current = false;
      setInvitePasswordStep(false); setPassword(''); setConfirmPassword('');
      setMessage('Registration complete. Both identities are verified and your CRM account is active.');
      await recordCrmLogin('invitation_registration'); setScreen('signed-in'); await loadDashboard(authData.user.id);
      window.history.replaceState({}, document.title, window.location.pathname);
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
    mfaLoginInProgressRef.current = true;
    try {
      const { data: authData, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (error || !authData.session || !authData.user) {
        mfaLoginInProgressRef.current = false;
        setMessage(error?.message || 'Unable to establish your login session. Please try again.');
        return;
      }
      setSession(authData.session);
      const { data: result, error: mfaError } = await supabase.functions.invoke('auth-mfa-login', { body: { action: 'begin' } });
      if (mfaError || !result?.ok) {
        await supabase.auth.signOut({ scope: 'local' });
        mfaLoginInProgressRef.current = false;
        setSession(null);
        setMessage(result?.error || mfaError?.message || 'Unable to start secure login verification.');
        return;
      }
      setPassword('');
      setMfaChallengeTicket(result.challenge_ticket || '');
      if (result.stage === 'email') {
        setEmailOtp('');
        setEmailOtpRequested(true);
        setOtpRequested(false);
        setMessage('A verification code has been sent to your registered corporate email address.');
      } else if (result.stage === 'telegram') {
        setEmailOtpRequested(false);
        setOtpRequested(true);
        setTelegramOtp('');
        setMessage('Password verified. Enter the Telegram code sent to your registered account.');
      } else if (result.stage === 'complete') {
        mfaLoginInProgressRef.current = false;
        await recordCrmLogin('password_2fa');
        setOtpRequested(false);
        setEmailOtpRequested(false);
        setMfaChallengeTicket('');
        setScreen('signed-in');
        await loadDashboard(authData.user.id);
      } else {
        await supabase.auth.signOut({ scope: 'local' });
        mfaLoginInProgressRef.current = false;
        setMessage('Unexpected login verification response. Please try again.');
      }
    } catch (error) {
      await supabase.auth.signOut({ scope: 'local' });
      mfaLoginInProgressRef.current = false;
      setSession(null);
      setMessage('Unable to sign in securely: ' + getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const code = emailOtp.trim();
    if (!/^\d{6}$/.test(code)) {
      setMessage('Enter the six-digit OTP sent to your corporate email.');
      return;
    }
    setBusy(true);
    setMessage('');
    mfaLoginInProgressRef.current = true;
    try {
      const { data: result, error: mfaError } = await supabase.functions.invoke('auth-mfa-login', {
        body: { action: 'email_verified', challenge_ticket: mfaChallengeTicket, email_otp: code },
      });
      if (mfaError || !result?.ok) {
        setMessage(result?.error || mfaError?.message || 'The email code could not be verified. Please try again.');
        return;
      }
      setEmailOtp('');
      setEmailOtpRequested(false);
      if (result.stage === 'telegram') {
        setOtpRequested(true);
        setTelegramOtp('');
        setMessage('Corporate email verified. Now enter the Telegram code sent to your registered account.');
      } else if (result.stage === 'complete') {
        mfaLoginInProgressRef.current = false;
        await recordCrmLogin('password_2fa');
        setMfaChallengeTicket('');
        setScreen('signed-in');
        if (session?.user.id) await loadDashboard(session.user.id);
      }
    } catch (error) {
      setMessage('Unable to verify the corporate email OTP: ' + getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleResendEmailCode() {
    if (!supabase || !mfaChallengeTicket) return;
    setBusy(true);
    setMessage('');
    try {
      const { data: result, error } = await supabase.functions.invoke('auth-mfa-login', {
        body: { action: 'resend_email', challenge_ticket: mfaChallengeTicket },
      });
      if (error || !result?.ok) setMessage(result?.error || error?.message || 'Could not resend the corporate email code.');
      else {
        setEmailOtp('');
        setMessage('A new corporate email verification code has been sent.');
      }
    } catch (error) {
      setMessage('Could not resend the corporate email code: ' + getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    if (!supabase) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!isApprovedEmail(normalizedEmail)) { setMessage('Enter your approved work email address first.'); return; }
    setBusy(true); setMessage('');
    try {
      const redirectTo = CRM_WEB_APP_URL;
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
      if (error) setMessage('Could not send the password reset email: ' + error.message);
      else { setMessage('Password reset instructions have been sent to your registered email address.'); }
    } catch (error) { setMessage('Could not request a password reset: ' + getErrorMessage(error)); }
    finally { setBusy(false); }
  }

  async function resolveTelegramHandlerInput(rawValue: string, purpose: 'id_change_old' | 'id_change_new') {
    const raw = rawValue.trim();
    if (/^\d+$/.test(raw)) {
      const id = Number(raw);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Enter a valid Telegram ID or @username.');
      return { telegramId: id, username: null as string | null, lookupRequestId: null as string | null };
    }

    const username = raw.replace(/^@/, '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) {
      throw new Error('Enter a valid Telegram handler, for example @username (5–32 characters), or a numeric Telegram ID.');
    }

    const { data: queued, error: queueError } = await supabase!
      .from('telegram_inbox_search_requests')
      .insert({ requested_by: profile?.id, query: username, purpose, status: 'pending' })
      .select('id')
      .single();
    if (queueError || !queued?.id) throw new Error('Could not start Telegram handler verification. Please try again.');

    await supabase!.functions.invoke('telegram-inbox-refresh', { body: {} });

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 2000));
      const { data: result, error: resultError } = await supabase!
        .from('telegram_inbox_search_requests')
        .select('id,status,result_count,resolved_telegram_user_id,resolved_username,error_message')
        .eq('id', queued.id)
        .maybeSingle();
      if (resultError) throw new Error('Could not check Telegram handler verification. Please try again.');
      if (result?.status === 'failed') throw new Error('Telegram handler verification failed. Please check the handler and try again.');
      if (result?.status === 'completed') {
        if (
          result.result_count !== 1 ||
          !result.resolved_telegram_user_id ||
          String(result.resolved_username || '').toLowerCase() !== username.toLowerCase()
        ) {
          throw new Error('That Telegram handler does not exist. Please check it and try again.');
        }
        return {
          telegramId: Number(result.resolved_telegram_user_id),
          username: String(result.resolved_username),
          lookupRequestId: String(result.id),
        };
      }
    }
    throw new Error('Telegram is taking longer than expected to verify this handler. Please try again in a moment.');
  }

  async function submitTelegramIdChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setTelegramIdLookupBusy(true); setMessage('');
    try {
      const oldIdentity = await resolveTelegramHandlerInput(oldTelegramIdInput, 'id_change_old');
      const newIdentity = await resolveTelegramHandlerInput(newTelegramIdInput, 'id_change_new');
      const { data, error } = await supabase.rpc('submit_telegram_id_change_request', {
        p_old_telegram_user_id: oldIdentity.telegramId,
        p_new_telegram_user_id: newIdentity.telegramId,
        p_comment: telegramIdChangeComment,
        p_old_telegram_username: oldIdentity.username,
        p_new_telegram_username: newIdentity.username,
        p_old_lookup_request_id: oldIdentity.lookupRequestId,
        p_new_lookup_request_id: newIdentity.lookupRequestId,
      });
      if (error) { setMessage('Could not submit the request: ' + error.message); return; }
      if (data?.ok) {
        setMessage(data.message || 'Request sent to Admin.');
        setShowTelegramIdRequest(false); setOldTelegramIdInput(''); setNewTelegramIdInput(''); setTelegramIdChangeComment('');
      } else setMessage(data?.message || 'Unable to submit the request.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setTelegramIdLookupBusy(false);
      setBusy(false);
    }
  }


  async function handleVerifyTelegramCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const code = telegramOtp.trim();
    if (!/^\d{6}$/.test(code)) {
      setMessage('Enter the six-digit code sent to your registered Telegram account.');
      return;
    }
    setBusy(true);
    setMessage('');
    mfaLoginInProgressRef.current = true;
    try {
      const { data: result, error } = await supabase.functions.invoke('auth-mfa-login', {
        body: { action: 'finish', challenge_ticket: mfaChallengeTicket, telegram_otp: code },
      });
      if (error || !result?.ok) {
        setMessage(result?.error || error?.message || 'Telegram verification failed. Please try again.');
        return;
      }
      const { data: authData } = await supabase.auth.getSession();
      if (!authData.session) {
        setMessage('Your login session expired. Please sign in again.');
        mfaLoginInProgressRef.current = false;
        setMfaChallengeTicket('');
        setOtpRequested(false);
        setSession(null);
        await supabase.auth.signOut({ scope: 'local' });
        return;
      }
      setSession(authData.session);
      setTelegramOtp('');
      setOtpRequested(false);
      setMfaChallengeTicket('');
      mfaLoginInProgressRef.current = false;
      await recordCrmLogin('password_2fa');
      setMessage('All login verification steps completed successfully.');
      setScreen('signed-in');
      await loadDashboard(authData.session.user.id);
    } catch (error) {
      setMessage('Unable to verify the Telegram code: ' + getErrorMessage(error));
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
        }        setMessage(`Could not create a Telegram linking link: ${details}`);
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

  function cancelStopHold() {
    if (stopHoldTimer.current !== null) window.clearTimeout(stopHoldTimer.current);
    stopHoldTimer.current = null;
    setStopHoldArmed(false);
  }

  function beginStopHold(attendanceId: string) {
    if (!openRecord || openRecord.id !== attendanceId || busy || loadingDashboard) return;
    if (stopHoldTimer.current !== null) window.clearTimeout(stopHoldTimer.current);
    setStopHoldArmed(true);
    stopHoldTimer.current = window.setTimeout(() => {
      stopHoldTimer.current = null;
      setStopHoldArmed(false);
      if (window.confirm('Stop your active shift and record your GPS check-out?')) void handleCheckOut(attendanceId);
    }, 1200);
  }

  async function handleLogout() {
    if (!supabase) return;

    setMapPreview(null);
    setAttendance([]); setSalaryAttendance([]); setShifts([]); setProfiles([]); setManagerAssignments([]); setTelegramMembers([]); setTelegramResponseMetrics([]); setExpandedManagerIds(new Set()); setProfile(null);
    setReportStartDate(''); setReportEndDate(''); setDraftStartDate(''); setDraftEndDate('');
    setBusy(true);
    setMessage('');

    try {
      if (session?.user.id) {
        try { localStorage.removeItem(INACTIVITY_STORAGE_PREFIX + session.user.id); } catch { /* storage may be unavailable */ }
      }
      const { error } = await supabase.auth.signOut();

      if (error) {
        setMessage(error.message);
        return;
      }

      sessionStorage.removeItem('mbp_mfa_pending_email');
      localStorage.removeItem('mbp_mfa_verified_email');
      setSession(null);
      setPassword('');
      setConfirmPassword('');
      setTelegramOtp('');
      setEmailOtp('');
      setEmailOtpRequested(false);
      setMfaChallengeTicket('');
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
    background: preferences.theme === 'day' ? 'var(--crm-bg)' : '#0b0b0c',
    color: preferences.theme === 'day' ? 'var(--crm-text)' : '#f7f7f5',
    fontFamily: 'Arial, Helvetica, sans-serif',
  };

  function handleExportCsv() {
    const rows = [
      ['Employee', 'Employee email', 'Work date', 'Check-in', 'Check-out', 'Status', 'Elapsed minutes', 'Worked minutes', 'Timezone', ...(isAdmin ? ['Check-in map', 'Check-out map'] : ['Check-in region', 'Check-in country', 'Check-out region', 'Check-out country'])],
      ...reportAttendance.map((item) => {
        const person = profiles.find((p) => p.id === item.employee_id);
        const start = new Date(item.check_in).getTime();
        const end = item.check_out ? new Date(item.check_out).getTime() : NaN;
        const elapsedMinutes = Number.isFinite(start) && Number.isFinite(end) && end >= start
          ? Math.floor((end - start) / 60000)
          : '';
        const workedMinutes = elapsedMinutes === '' ? '' : Math.max(0, Number(elapsedMinutes) - (Number(elapsedMinutes) >= BREAK_THRESHOLD_MINUTES ? BREAK_MINUTES : 0));
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
          ...(isAdmin ? [checkInMap, checkOutMap] : [item.check_in_region || '', item.check_in_country || '', item.check_out_region || '', item.check_out_country || '']),
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
    background: 'var(--crm-accent-strong)',
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
  const canUseHumanTelegram = isAdmin || (profile?.active === true && normalizedRole === 'telemarketing' && humanTelegramAccess);
  useEffect(() => {
    const client = supabase;
    if (!client || !isAdmin || screen !== 'signed-in' || !['team', 'team-assignments', 'team-roles'].includes(activePage)) return;
    let cancelled = false;
    const refreshAssignments = async () => {
      const [peopleResult, assignmentsResult] = await Promise.all([
        client.from('profiles').select('id, email, full_name, role, active, telegram_user_id, telegram_verified_at, telegram_username').order('full_name', { ascending: true }).limit(500),
        client.from('manager_employee_assignments').select('manager_id, employee_id').limit(2000),
      ]);
      if (cancelled) return;
      if (!peopleResult.error) setProfiles((peopleResult.data ?? []) as Profile[]);
      if (!assignmentsResult.error) setManagerAssignments((assignmentsResult.data ?? []) as ManagerAssignment[]);
    };
    void refreshAssignments();
    const channel = client.channel('admin-team-hierarchy-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manager_employee_assignments' }, () => { void refreshAssignments(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { void refreshAssignments(); })
      .subscribe();
    const fallback = window.setInterval(() => { void refreshAssignments(); }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(fallback);
      void client.removeChannel(channel);
    };
  }, [isAdmin, screen, activePage, profile?.id]);
  useEffect(() => {
    let cancelled = false;
    setHumanTelegramAccess(false);
    if (!supabase || !profile?.active || normalizedRole !== 'telemarketing') return;
    void supabase.from('telegram_human_access').select('profile_id').eq('profile_id', profile.id).maybeSingle()
      .then(({ data, error }) => { if (!cancelled && !error) setHumanTelegramAccess(Boolean(data)); });
    return () => { cancelled = true; };
  }, [profile?.id, profile?.active, normalizedRole]);
  useEffect(() => {
    if (activePage === 'telegram-human' && !canUseHumanTelegram) setActivePage('dashboard');
  }, [activePage, canUseHumanTelegram]);
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
    const elapsed = Math.max(0, end - start);
    return total + Math.max(0, elapsed - (elapsed >= BREAK_THRESHOLD_MINUTES * 60000 ? BREAK_MINUTES * 60000 : 0));
  }, 0);
  const reportOpenSessions = reportAttendance.filter((item) => !item.check_out).length;
  // Salary eligibility: 8 net work hours per Monday-Friday in the full calendar month.
  const salaryMonthStart = new Date(Date.now());
  salaryMonthStart.setDate(1);
  salaryMonthStart.setHours(0, 0, 0, 0);
  const salaryMonthEnd = new Date(salaryMonthStart.getFullYear(), salaryMonthStart.getMonth() + 1, 0);
  let salaryWeekdays = 0;
  for (let day = new Date(salaryMonthStart); day <= salaryMonthEnd; day.setDate(day.getDate() + 1)) {
    if (day.getDay() !== 0 && day.getDay() !== 6) salaryWeekdays += 1;
  }
  const salaryRequiredMilliseconds = salaryWeekdays * DAILY_REQUIRED_WORK_MINUTES * 60000;
  const salaryMonthPrefix = `${salaryMonthStart.getFullYear()}-${String(salaryMonthStart.getMonth() + 1).padStart(2, '0')}`;
  const salaryWorkedMilliseconds = salaryAttendance.reduce((total, item) => {
    const workDate = item.work_date ?? (item.work_timezone
      ? getLocalDate(item.work_timezone, new Date(item.check_in))
      : item.check_in.slice(0, 10));
    if (!workDate.startsWith(salaryMonthPrefix)) return total;
    const start = new Date(item.check_in).getTime();
    const end = item.check_out ? new Date(item.check_out).getTime() : Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return total;
    const elapsed = end - start;
    const breakMs = elapsed >= BREAK_THRESHOLD_MINUTES * 60000 ? BREAK_MINUTES * 60000 : 0;
    return total + Math.max(0, elapsed - breakMs);
  }, 0);
  const salaryProgress = salaryRequiredMilliseconds > 0
    ? Math.min(100, salaryWorkedMilliseconds / salaryRequiredMilliseconds * 100)
    : 0;
  const salaryRemainingMilliseconds = Math.max(0, salaryRequiredMilliseconds - salaryWorkedMilliseconds);
  const salaryProgressColor = salaryProgress < 80 ? '#ef4444' : salaryProgress < 90 ? '#f59e0b' : '#22c55e';


  const openRecord = attendance
    .filter((item) => {
      if (item.employee_id !== session?.user.id || item.check_out || !item.work_date || !item.work_timezone) {
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
      <style>{`@media (max-width: 760px) { .crm-layout { display:block !important; } .crm-sidebar { position:relative !important; top:auto !important; min-height:0 !important; width:100% !important; margin:0 !important; padding:7px 8px !important; overflow:visible !important; } .crm-sidebar nav { flex-direction:row !important; flex-wrap:wrap !important; gap:4px !important; overflow:visible !important; position:relative !important; z-index:50; } .crm-sidebar nav button { width:auto !important; flex:0 0 auto !important; min-width:44px; justify-content:flex-start !important; padding:9px !important; gap:6px !important; font-size:12px !important; } .crm-sidebar nav button svg { flex-shrink:0; } .crm-menu-label { display:inline !important; white-space:nowrap; } .crm-sidebar > button[title="Sign out"] { width:auto !important; min-height:38px !important; padding:7px 9px !important; margin-top:4px !important; position:relative; z-index:1; } .crm-sidebar > div:first-child { margin-bottom:5px !important; } .crm-sidebar nav > div { position:relative !important; flex:0 0 auto; } .crm-sidebar nav > div > div { position:absolute !important; z-index:1000 !important; left:0 !important; right:auto !important; top:100% !important; min-width:min(290px, calc(100vw - 24px)); max-height:60vh; overflow-y:auto; display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)); gap:3px !important; margin:0 !important; padding:8px !important; border:1px solid var(--crm-border) !important; border-radius:0 0 7px 7px; background:var(--crm-panel-bg) !important; color:var(--crm-text) !important; box-shadow:0 8px 20px rgba(0,0,0,.22); } .crm-sidebar nav > div > div button { width:100% !important; min-width:0 !important; min-height:42px; padding:8px !important; justify-content:flex-start !important; font-size:12px !important; text-align:left; white-space:normal; overflow-wrap:anywhere; } .crm-sidebar > div:last-child { display:none; } .crm-layout > main { width:100%; padding:0 !important; min-width:0; } .crm-layout > main > section { margin:0 !important; width:100%; max-width:none !important; padding:8px !important; border:0 !important; border-radius:0 !important; box-shadow:none !important; } .crm-layout > :not(.crm-sidebar) { min-width:0; } .crm-layout table { max-width:100%; } } @media (max-width: 480px) { main { padding:0 !important; } .crm-layout { gap:0 !important; } .crm-layout section { padding:8px !important; } .crm-layout input[type=date] { font-size:16px; min-height:44px; } }`}</style>
      <header className="crm-brand-header" style={{ maxWidth: 1440, margin: '0 auto' }}>
        <p className="crm-brand-title" style={{ fontWeight: 700 }}>ATTENDANCE CRM</p>
      </header>

      {screen === 'loading' && (
        <section style={panelStyle}>Checking your session…</section>
      )}

      {screen === 'login' && (
        <section style={{ ...panelStyle, maxWidth: 430 }}>
          {!inviteToken && <>
          <h1>Welcome back</h1>
          <KnowMore>Use your registered work email and password. Email and Telegram verification may be required to protect your account.</KnowMore>

          {!otpRequested && !emailOtpRequested ? <form onSubmit={handleLogin}>
            <label htmlFor="email">Login ID / work email</label>
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} style={inputStyle}/>
            <label htmlFor="login-password" style={{display:'block',marginTop:14}}>Password</label>
            <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} style={inputStyle}/>
            <button type="submit" disabled={busy} style={{...buttonStyle,width:'100%',marginTop:16}}>{busy ? 'Verifying password…' : 'Continue'}</button>
            <button type="button" disabled={busy} onClick={()=>void handleForgotPassword()} style={{display:'block',margin:'12px auto 0',border:0,background:'transparent',color:'var(--crm-accent)',cursor:'pointer',textDecoration:'underline'}}>Forgot password?</button>
          </form> : emailOtpRequested ? <>
            <p style={{color:'#b7c0d1'}}>Email verification required · Enter the OTP sent to your registered corporate email address. This is required on first login and every 7 days.</p>
            <form onSubmit={handleVerifyEmailCode}>
              <label htmlFor="email-otp" style={{display:'block',marginTop:18}}>Corporate email OTP</label>
              <input id="email-otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={emailOtp} onChange={(event)=>setEmailOtp(event.target.value.replace(/\D/g,''))} style={inputStyle}/>
              <button type="submit" disabled={busy} style={{...buttonStyle,width:'100%',marginTop:12}}>{busy ? 'Verifying email…' : 'Verify email and continue'}</button>
            </form>
            <button type="button" disabled={busy} onClick={()=>void handleResendEmailCode()} style={{display:'block',margin:'12px auto 0',border:0,background:'transparent',color:'var(--crm-accent)',cursor:'pointer',textDecoration:'underline'}}>Resend email OTP</button>
          </> : <>
            <p style={{color:'#b7c0d1'}}>Final step · Enter the six-digit code sent to your registered Telegram account.</p>
            <form onSubmit={handleVerifyTelegramCode}>
              <label htmlFor="telegram-otp" style={{display:'block',marginTop:18}}>Telegram OTP</label>
              <input id="telegram-otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={telegramOtp} onChange={(event)=>setTelegramOtp(event.target.value.replace(/\D/g,''))} style={inputStyle}/>
              <button type="submit" disabled={busy} style={{...buttonStyle,width:'100%',marginTop:12}}>{busy ? 'Verifying…' : 'Verify code and sign in'}</button>
            </form>
            <button type="button" disabled={busy} onClick={()=>{setShowTelegramIdRequest(v=>!v);setMessage('');}} style={{display:'block',margin:'14px auto 0',border:0,background:'transparent',color:'var(--crm-accent)',cursor:'pointer',textDecoration:'underline'}}>Update Telegram ID</button>
            {showTelegramIdRequest && <form onSubmit={submitTelegramIdChange} style={{marginTop:16,padding:14,border:'1px solid var(--crm-border)',borderRadius:8}}>
              <h3 style={{marginTop:0}}>Request Telegram ID change</h3>
              <p style={{color:'#b7c0d1',fontSize:13}}>Enter the previously registered Telegram ID or @handler, then your new Telegram ID or @handler. Telegram will verify any @handler before the request is sent. Admin approval is required.</p>
              <label htmlFor="old-telegram-id">Previously registered Telegram ID</label>
              <p style={{fontSize:12,color:'#98a2b3',margin:'5px 0 8px'}}>If you don't remember this ID, please contact your manager personally to find out your previously registered Telegram ID.</p>
              <input id="old-telegram-id" type="text" autoComplete="off" required value={oldTelegramIdInput} onChange={e=>setOldTelegramIdInput(e.target.value)} placeholder="Telegram ID or @username" style={inputStyle}/>
              <label htmlFor="new-telegram-id" style={{display:'block',marginTop:12}}>New Telegram ID</label>
              <input id="new-telegram-id" type="text" autoComplete="off" required value={newTelegramIdInput} onChange={e=>setNewTelegramIdInput(e.target.value)} placeholder="Telegram ID or @username" style={inputStyle}/>
              <label htmlFor="telegram-id-comment" style={{display:'block',marginTop:12}}>Why do you want to change it?</label>
              <textarea id="telegram-id-comment" minLength={5} maxLength={1000} required value={telegramIdChangeComment} onChange={e=>setTelegramIdChangeComment(e.target.value)} style={{...inputStyle,minHeight:90,resize:'vertical'}}/>
              <button type="submit" disabled={busy} style={{...buttonStyle,width:'100%',marginTop:12}}>{busy?(telegramIdLookupBusy?'Verifying Telegram handler…':'Sending…'):'Request to change'}</button>
            </form>}
          </>}
          </>}
          {inviteToken && <div style={{marginTop:4}}>
            <h1 style={{fontSize:26,marginBottom:8}}>Complete your invitation</h1>
            {inviteDetails ? <>
              <div style={{padding:12,margin:'12px 0',border:'1px solid #475467',borderRadius:8,background:'#151413'}}>
                <p style={{margin:'4px 0'}}> <strong>Admin Panel Name:</strong> {inviteDetails.admin_panel_name}</p>
                <p style={{margin:'4px 0',overflowWrap:'anywhere'}}><strong>Corporate Email:</strong> {inviteDetails.corporate_email}</p>
                <p style={{margin:'4px 0'}}><strong>Assigned role:</strong> {inviteDetails.invited_role.replaceAll('_',' ')}</p>              </div>
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
                  {!inviteEmailVerified ? <>
                    <p style={{color:'#b7c0d1',fontSize:13}}>Next, verify the official email address assigned to this invitation.</p>
                    {!inviteEmailSent ? <button type="button" onClick={handleSendInviteEmailOtp} disabled={busy} style={{...buttonStyle,width:'100%',marginTop:12}}>{busy?'Sending code…':'Send email verification code'}</button> : <form onSubmit={handleVerifyInviteEmail} style={{marginTop:14}}>
                      <label htmlFor="invite-email-otp">Six-digit code sent to {inviteDetails.corporate_email}</label>
                      <input id="invite-email-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={inviteEmailOtp} onChange={event=>setInviteEmailOtp(event.target.value.replace(/\D/g,'').slice(0,6))} style={inputStyle}/>
                      <button type="submit" disabled={busy || inviteEmailOtp.length!==6} style={{...buttonStyle,width:'100%',marginTop:10}}>Verify official email</button>
                      <button type="button" onClick={handleSendInviteEmailOtp} disabled={busy} style={{...buttonStyle,width:'100%',marginTop:8,background:'transparent'}}>Resend code</button>
                    </form>}
                  </> : <form onSubmit={handleRegister} style={{marginTop:16}}>
                    <p style={{color:'#86efac'}}>Telegram and official email verified.</p>
                    <label htmlFor="register-email">Corporate email</label>
                    <input id="register-email" type="email" autoComplete="email" required readOnly value={inviteDetails.corporate_email} onChange={event=>setEmail(event.target.value)} style={inputStyle}/>
                    <label htmlFor="register-password" style={{display:'block',marginTop:12}}>Create password (at least 8 characters)</label>
                    <input id="register-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event=>setPassword(event.target.value)} style={inputStyle}/>
                    <label htmlFor="register-confirm-password" style={{display:'block',marginTop:12}}>Confirm password</label>
                    <input id="register-confirm-password" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} style={inputStyle}/>
                    <button type="submit" disabled={busy || !inviteTelegramVerified || !inviteEmailVerified} style={{...buttonStyle,width:'100%',marginTop:14}}>{busy?'Creating account…':'Complete registration'}</button>
                  </form>}
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

      {screen === 'signed-in' && session && !profileReady && (
        <section style={panelStyle} role="status">Loading your account permissions…</section>
      )}

      {screen === 'signed-in' && session && profileReady && (
        <div className="crm-layout" style={{display:'grid',gridTemplateColumns:navOpen?'232px minmax(0,1fr)':'58px minmax(0,1fr)',gap:0,alignItems:'stretch',width:'100%',maxWidth:'none',margin:0,minHeight:'100vh'}}>
          <aside className={`crm-sidebar ${navOpen ? 'is-open' : ''}`} style={{position:'sticky',top:0,alignSelf:'stretch',height:'100vh',minHeight:'100vh',overflowY:'auto',padding:navOpen?'12px 10px':'10px 5px',background:'#101114',borderTop:0,borderBottom:0,borderLeft:0,borderRight:'1px solid #292a31',borderRadius:0,color:'#dce4f2'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:navOpen?'space-between':'center',gap:8,marginBottom:16,paddingBottom:12,borderBottom:'1px solid #24252c',color:'#fff',fontWeight:700}}>{navOpen&&<span>Partner CRM</span>}<button type="button" aria-label={navOpen?'Minimize sidebar':'Expand sidebar'} title={navOpen?'Minimize sidebar':'Expand sidebar'} onClick={()=>setNavOpen(v=>!v)} style={{display:'grid',placeItems:'center',flexShrink:0,width:36,height:36,border:'1px solid #34353e',borderRadius:7,background:'#1a1b20',color:'#fff',cursor:'pointer'}}>{navOpen?<X size={18}/>:<Menu size={18}/>}</button></div>
            <nav aria-label="CRM pages" style={{display:'flex',flexDirection:'column',gap:3}}>
              {[{label:'Dashboard',icon:<LayoutDashboard size={18}/>,id:'dashboard' as CrmPage},{label:'Downloads',icon:<Download size={18}/>,id:'downloads' as CrmPage},{label:'Attendance',icon:<CalendarDays size={18}/>,id:'attendance' as CrmPage},{label:'Team management',icon:<Users size={18}/>,id:'team' as CrmPage},{label:'Telegram chats & analytics',icon:<MessageCircle size={18}/>,id:'telegram' as CrmPage},{label:'Security',icon:<ShieldAlert size={18}/>,id:'security' as CrmPage},{label:'Requests',icon:<MessageCircle size={18}/>,id:'requests' as CrmPage},{label:'Settings',icon:<SettingsIcon size={18}/>,id:'settings' as CrmPage}].filter(item=>item.id==='dashboard'||item.id==='downloads'||item.id==='attendance'||((item.id==='security'||item.id==='requests')&&isAdmin)||item.id==='settings'||(item.id==='team'&&(isAdmin||canManageTeam))||(item.id==='telegram'&&(isAdmin||canManageTeam||canUseHumanTelegram))).map(item=><div key={item.id}>
                <button type="button" title={item.label} aria-current={activePage===item.id || (item.id==='attendance' && (activePage==='attendance-records'||activePage==='team-attendance')) || (item.id==='team' && ['manager-hierarchy','team-roles','team-links','team-assignments','team-invitations'].includes(activePage)) || (item.id==='telegram' && ['telegram-human','telegram-analytics'].includes(activePage))?'page':undefined} aria-expanded={item.id==='attendance'?attendanceMenuOpen:item.id==='team'?teamMenuOpen:item.id==='telegram'?telegramMenuOpen:undefined} data-branch-active={(item.id==='attendance' && (activePage==='attendance-records'||activePage==='team-attendance')) || (item.id==='team' && ['team-roles','team-links','team-assignments','team-invitations'].includes(activePage)) || (item.id==='telegram' && ['telegram-human','telegram-analytics'].includes(activePage)) ? 'true' : undefined} onClick={()=>{if(item.id==='team'){if(!navOpen){setNavOpen(true);setTeamMenuOpen(true);setTelegramMenuOpen(false);setAttendanceMenuOpen(false);}else{setTeamMenuOpen(!teamMenuOpen);setTelegramMenuOpen(false);setAttendanceMenuOpen(false);}}else if(item.id==='telegram'){if(!navOpen){setNavOpen(true);setTelegramMenuOpen(true);setTeamMenuOpen(false);setAttendanceMenuOpen(false);}else{setTelegramMenuOpen(!telegramMenuOpen);setTeamMenuOpen(false);setAttendanceMenuOpen(false);}}else if(item.id==='attendance'){if(!navOpen){setNavOpen(true);setAttendanceMenuOpen(true);setTeamMenuOpen(false);setTelegramMenuOpen(false);}else{setAttendanceMenuOpen(!attendanceMenuOpen);setTeamMenuOpen(false);setTelegramMenuOpen(false);}}else{setAttendanceMenuOpen(false);setTeamMenuOpen(false);setTelegramMenuOpen(false);setActivePage(item.id);}setMapPreview(null);window.scrollTo(0,0)}} style={{display:'flex',alignItems:'center',justifyContent:navOpen?'flex-start':'center',gap:10,width:'100%',padding:navOpen?'10px 9px':'11px 0',textAlign:'left',border:0,borderRadius:6,background:activePage===item.id?'var(--crm-accent-soft)':'transparent',color:activePage===item.id?'var(--crm-accent)':'#cbd5e1',cursor:'pointer'}}>{item.icon}{navOpen&&<><span className="crm-menu-label" style={{flex:1}}>{item.label}</span>{(item.id==='team'||item.id==='telegram'||item.id==='attendance')&&((item.id==='team'?teamMenuOpen:item.id==='telegram'?telegramMenuOpen:attendanceMenuOpen)?<ChevronDown size={15}/>:<ChevronRight size={15}/>)}</>}</button>
                {item.id==='attendance'&&navOpen&&attendanceMenuOpen&&<div style={{margin:'3px 0 7px 13px',paddingLeft:10,borderLeft:'1px solid var(--crm-border)',display:'grid',gap:2}}>
                  {[{label:'Attendance records',id:'attendance-records' as CrmPage,icon:<CalendarDays size={15}/>},...(isAdmin?[{label:'Team attendance report',id:'team-attendance' as CrmPage,icon:<Users size={15}/>}]:[])].map(sub=><button key={sub.id} type="button" title={sub.label} aria-current={activePage===sub.id?'page':undefined} onClick={()=>{const isMobile=window.matchMedia('(max-width: 760px)').matches;setAttendanceMenuOpen(!isMobile);setTeamMenuOpen(false);setTelegramMenuOpen(false);setActivePage(sub.id);setMapPreview(null);window.scrollTo(0,0)}} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'8px 7px',textAlign:'left',border:0,borderRadius:5,background:activePage===sub.id?'var(--crm-accent-soft)':'transparent',color:activePage===sub.id?'var(--crm-accent)':'#b8bbc5',fontSize:12,cursor:'pointer'}}>{sub.icon}<span>{sub.label}</span></button>)}
                </div>}
                {item.id==='team'&&navOpen&&teamMenuOpen&&(isAdmin||canManageTeam)&&<div style={{margin:'3px 0 7px 13px',paddingLeft:10,borderLeft:'1px solid var(--crm-border)',display:'grid',gap:2}}>
                  {([{label:'Manager hierarchy',id:'manager-hierarchy' as CrmPage,icon:<GitBranch size={15}/>},{label:'Employee role management',id:'team-roles' as CrmPage,icon:<UserCog size={15}/>},{label:'Link Telegram members',id:'team-links' as CrmPage,icon:<Link2 size={15}/>},{label:'Assign employees to managers',id:'team-assignments' as CrmPage,icon:<GitBranch size={15}/>},{label:isAdmin?'Admin invitation':'Employee invitations',id:'team-invitations' as CrmPage,icon:<UserPlus size={15}/>}]).filter(sub=>isAdmin||sub.id==='team-invitations'||sub.id==='manager-hierarchy').map(sub=><button key={sub.id} type="button" title={sub.label} aria-current={activePage===sub.id?'page':undefined} onClick={()=>{if(sub.id==='telegram-human')setTelegramHumanNavKey(value=>value+1);const isMobile=window.matchMedia('(max-width: 760px)').matches;setTeamMenuOpen(!isMobile);setAttendanceMenuOpen(false);setTelegramMenuOpen(false);setActivePage(sub.id);setMapPreview(null);window.scrollTo(0,0)}} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'8px 7px',textAlign:'left',border:0,borderRadius:5,background:activePage===sub.id?'var(--crm-accent-soft)':'transparent',color:activePage===sub.id?'var(--crm-accent)':'#b8bbc5',fontSize:12,cursor:'pointer'}}>{sub.icon}<span>{sub.label}</span></button>)}
                </div>}
                {item.id==='telegram'&&navOpen&&telegramMenuOpen&&(isAdmin||canManageTeam||canUseHumanTelegram)&&<div style={{margin:'3px 0 7px 13px',paddingLeft:10,borderLeft:'1px solid var(--crm-border)',display:'grid',gap:2}}>
                  {[{label:'Human Telegram chat',id:'telegram-human' as CrmPage,icon:<MessageCircle size={15}/>},{label:'Telegram group analytics',id:'telegram-analytics' as CrmPage,icon:<Users size={15}/>}].filter(sub=>sub.id==='telegram-human'?canUseHumanTelegram:(isAdmin||canManageTeam)).map(sub=><button key={sub.id} type="button" title={sub.label} aria-current={activePage===sub.id?'page':undefined} onClick={()=>{const isMobile=window.matchMedia('(max-width: 760px)').matches;setTelegramMenuOpen(!isMobile);setAttendanceMenuOpen(false);setTeamMenuOpen(false);setActivePage(sub.id);setMapPreview(null);window.scrollTo(0,0)}} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'8px 7px',textAlign:'left',border:0,borderRadius:5,background:activePage===sub.id?'var(--crm-accent-soft)':'transparent',color:activePage===sub.id?'var(--crm-accent)':'#b8bbc5',fontSize:12,cursor:'pointer'}}>{sub.icon}<span>{sub.label}</span></button>)}
                </div>}
              </div>)}
            </nav>

            <button type="button" title="Sign out" aria-label="Sign out" disabled={busy} onClick={() => void handleLogout()} style={{display:'flex',alignItems:'center',justifyContent:navOpen?'flex-start':'center',gap:10,width:'100%',padding:navOpen?10:'10px 0',marginTop:18,border:'1px solid var(--crm-accent-strong)',borderRadius:6,background:'var(--crm-accent-strong)',color:'#fff',fontWeight:700,cursor:busy?'wait':'pointer'}}><LogOut size={18}/>{navOpen&&(busy?'Please wait…':'Sign out')}</button>
            {navOpen&&<div style={{marginTop:16,paddingTop:12,borderTop:'1px solid #24252c',color:'#98a2b3',fontSize:11,overflowWrap:'anywhere'}}>{profile?.full_name||session.user.email}</div>}
          </aside>
          <nav className="crm-mobile-bottom-nav" aria-label="Mobile navigation">
            <button type="button" className={activePage==='dashboard'?'is-active':''} aria-current={activePage==='dashboard'?'page':undefined} onClick={()=>{setActivePage('dashboard');setMobileMoreOpen(false);window.scrollTo(0,0);}}>
              <LayoutDashboard size={19}/><span>Home</span>
            </button>
            <button type="button" className={['attendance','attendance-records','team-attendance'].includes(activePage)?'is-active':''} aria-current={['attendance','attendance-records','team-attendance'].includes(activePage)?'page':undefined} onClick={()=>{setActivePage('attendance-records');setMobileMoreOpen(false);window.scrollTo(0,0);}}>
              <CalendarDays size={19}/><span>Attendance</span>
            </button>
            {(isAdmin||canManageTeam)&&<button type="button" className={activePage==='team'||activePage==='manager-hierarchy'||activePage.startsWith('team-')?'is-active':''} aria-current={activePage==='team'||activePage==='manager-hierarchy'||activePage.startsWith('team-')?'page':undefined} onClick={()=>{setActivePage('team');setMobileMoreOpen(false);window.scrollTo(0,0);}}>
              <Users size={19}/><span>Team</span>
            </button>}
            {(isAdmin||canManageTeam||canUseHumanTelegram)&&<button type="button" className={activePage==='telegram'||activePage.startsWith('telegram-')?'is-active':''} aria-current={activePage==='telegram'||activePage.startsWith('telegram-')?'page':undefined} onClick={()=>{setActivePage(canUseHumanTelegram?'telegram-human':'telegram-analytics');setMobileMoreOpen(false);window.scrollTo(0,0);}}>
              <MessageCircle size={19}/><span>Telegram</span>
            </button>}
            <button type="button" className={mobileMoreOpen||['settings','security','requests'].includes(activePage)?'is-active':''} aria-expanded={mobileMoreOpen} onClick={()=>setMobileMoreOpen(v=>!v)}>
              {mobileMoreOpen?<X size={19}/>:<MoreHorizontal size={19}/>}<span>More</span>
            </button>
          </nav>
          {mobileMoreOpen && <div className="crm-mobile-more-backdrop" role="presentation" onClick={()=>setMobileMoreOpen(false)}>
            <section className="crm-mobile-more-sheet" role="dialog" aria-modal="true" aria-label="More CRM pages" onClick={event=>event.stopPropagation()}>
              <div className="crm-mobile-sheet-handle"/>
              <div className="crm-mobile-sheet-heading"><div><strong>More</strong><small>Tools and account settings</small></div><button type="button" aria-label="Close menu" onClick={()=>setMobileMoreOpen(false)}><X size={19}/></button></div>
              <div className="crm-mobile-more-grid">
                <button type="button" onClick={()=>{setActivePage('downloads');setMobileMoreOpen(false);window.scrollTo(0,0);}}><Download size={18}/><span><strong>Downloads</strong><small>Android, iPhone, Windows and Mac apps</small></span><ChevronRight size={16}/></button>
                {isAdmin&&<button type="button" onClick={()=>{setActivePage('team-attendance');setMobileMoreOpen(false);window.scrollTo(0,0);}}><Users size={18}/><span><strong>Team attendance report</strong><small>Team trends, graphs and shift statistics</small></span><ChevronRight size={16}/></button>}
                {isAdmin&&<button type="button" onClick={()=>{setActivePage('security');setMobileMoreOpen(false);window.scrollTo(0,0);}}><ShieldAlert size={18}/><span><strong>Security</strong><small>Account and activity controls</small></span><ChevronRight size={16}/></button>}
                {isAdmin&&<button type="button" onClick={()=>{setActivePage('requests');setMobileMoreOpen(false);window.scrollTo(0,0);}}><MessageCircle size={18}/><span><strong>Requests</strong><small>Review Telegram ID change requests</small></span><ChevronRight size={16}/></button>}
                {(isAdmin||canManageTeam)&&<button type="button" onClick={()=>{setActivePage('manager-hierarchy');setMobileMoreOpen(false);window.scrollTo(0,0);}}><GitBranch size={18}/><span><strong>Manager hierarchy</strong><small>Reporting lines and manager profiles</small></span><ChevronRight size={16}/></button>}
                {(isAdmin||canManageTeam)&&<button type="button" onClick={()=>{setActivePage('team-roles');setMobileMoreOpen(false);window.scrollTo(0,0);}}><UserCog size={18}/><span><strong>Employee roles</strong><small>Manage roles and access</small></span><ChevronRight size={16}/></button>}
                {isAdmin&&<button type="button" onClick={()=>{setActivePage('team-links');setMobileMoreOpen(false);window.scrollTo(0,0);}}><Link2 size={18}/><span><strong>Link Telegram members</strong><small>Connect Telegram identities</small></span><ChevronRight size={16}/></button>}
                {isAdmin&&<button type="button" onClick={()=>{setActivePage('team-assignments');setMobileMoreOpen(false);window.scrollTo(0,0);}}><GitBranch size={18}/><span><strong>Manager assignments</strong><small>View reporting hierarchy</small></span><ChevronRight size={16}/></button>}
                {(isAdmin||canManageTeam)&&<button type="button" onClick={()=>{setActivePage('team-invitations');setMobileMoreOpen(false);window.scrollTo(0,0);}}><UserPlus size={18}/><span><strong>{isAdmin?'Admin invitation':'Employee invitations'}</strong><small>Invite people to the CRM</small></span><ChevronRight size={16}/></button>}
                {(isAdmin||canManageTeam)&&<button type="button" onClick={()=>{setActivePage('telegram-analytics');setMobileMoreOpen(false);window.scrollTo(0,0);}}><MessageCircle size={18}/><span><strong>Telegram group analytics</strong><small>Group activity and response metrics</small></span><ChevronRight size={16}/></button>}
                {canUseHumanTelegram&&<button type="button" onClick={()=>{setActivePage('telegram-human');setMobileMoreOpen(false);window.scrollTo(0,0);}}><MessageCircle size={18}/><span><strong>Human Telegram chat</strong><small>Inbox, assignments and replies</small></span><ChevronRight size={16}/></button>}
                <button type="button" onClick={()=>{setActivePage('settings');setMobileMoreOpen(false);window.scrollTo(0,0);}}><SettingsIcon size={18}/><span><strong>Settings</strong><small>Appearance, display and timezone</small></span><ChevronRight size={16}/></button>
                <button type="button" className="crm-mobile-signout" disabled={busy} onClick={()=>{setMobileMoreOpen(false);void handleLogout();}}><LogOut size={18}/><span><strong>Sign out</strong><small>End your CRM session</small></span><ChevronRight size={16}/></button>
              </div>
            </section>
          </div>}
          <main style={{minWidth:0}}>
          <section style={panelStyle}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:18,color:'#98a2b3',fontSize:13}}>Partner CRM / <strong style={{color:'#fff'}}>{{dashboard:'Dashboard',downloads:'Downloads',attendance:'Attendance', 'attendance-records':'Attendance records','team-attendance':'Team attendance report',team:'Team management','manager-hierarchy':'Manager hierarchy','team-roles':'Employee role management','team-links':'Link Telegram members','team-assignments':'Assign employees to managers','team-invitations':(isAdmin?'Admin invitation':'Employee invitations'),telegram:'Telegram chats & analytics','telegram-human':'Human Telegram chat','telegram-analytics':'Telegram group analytics',security:'Security',requests:'Requests',settings:'Settings'}[activePage]}</strong></div>

          {activePage === 'downloads' && <>
            <h1 style={{marginTop:0}}>Downloads</h1>
            <p style={{color:'var(--crm-muted,#98a2b3)',maxWidth:760,lineHeight:1.6}}>Get MBP Attendance for your device. All versions connect to the same live CRM account and data, so an internet connection is required.</p>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,260px),1fr))',gap:14,marginTop:20}}>
              {[
                {name:'Android',detail:'Android APK · Latest build',description:'Install the APK on Android. You may need to allow installation from your browser or file manager.',url:ANDROID_APK_DOWNLOAD_URL,action:'Download APK',icon:<Smartphone size={24}/>},
                {name:'iPhone / iPad',detail:'iOS Home Screen Web Clip',description:'Download the configuration profile, then install it in Settings → Profile Downloaded. This adds the CRM shortcut to your Home Screen.',url:IOS_WEBCLIP_DOWNLOAD_URL,action:'Download iOS profile',icon:<Smartphone size={24}/>},
                {name:'Windows',detail:'Windows 10 / 11 · 64-bit installer',description:'Desktop app installer with Start Menu and optional Desktop shortcut.',url:WINDOWS_EXE_DOWNLOAD_URL,action:'Download EXE',icon:<Monitor size={24}/>},
                {name:'macOS',detail:'Universal DMG · Apple Silicon and Intel',description:'Drag MBP Attendance into Applications after opening the disk image. The first launch may require approval in Privacy & Security because the app is not notarized.',url:MACOS_DMG_DOWNLOAD_URL,action:'Download DMG',icon:<Monitor size={24}/>}
              ].map(item=><article key={item.name} style={{display:'flex',flexDirection:'column',gap:12,minHeight:210,padding:18,border:'1px solid var(--crm-border,#343b49)',borderRadius:10,background:'var(--crm-card-bg,#151b29)',color:'var(--crm-text,#e5e7eb)'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,color:'var(--crm-accent,#ff9b45)'}}>{item.icon}<strong style={{fontSize:17,color:'var(--crm-text,#fff)'}}>{item.name}</strong></div>
                <div style={{fontSize:12,fontWeight:700,color:'var(--crm-accent,#ffb36b)'}}>{item.detail}</div>
                <p style={{fontSize:13,lineHeight:1.55,color:'var(--crm-muted,#b7c0d1)',margin:'0 0 4px',flex:1}}>{item.description}</p>
                <a href={item.url} download={item.name==='iPhone / iPad'} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8,padding:'10px 13px',borderRadius:7,background:'var(--crm-accent,#e87924)',color:'#111827',fontWeight:800,textDecoration:'none'}}><Download size={16}/>{item.action}</a>
              </article>)}
            </div>
            <p style={{marginTop:18,fontSize:12,lineHeight:1.6,color:'var(--crm-muted,#98a2b3)'}}>Security note: the Windows and macOS desktop installers are currently unsigned. Your operating system may show a first-launch security warning.</p>
          </>}
          {activePage === 'requests' && isAdmin && <TelegramIdRequests/>}
          {activePage === 'settings' && <>
            <h1>CRM Settings</h1>
            <p style={{color:'#98a2b3',maxWidth:760,lineHeight:1.6}}>Personalize the appearance and everyday behaviour of this CRM. Preferences are saved in this browser and apply immediately.</p>
            <section className="crm-settings-section">
              <div className="crm-settings-heading"><Palette size={20}/><div><h2>Appearance</h2><p>Choose your theme and accent colour.</p></div></div>
              <div className="crm-settings-choice-grid">
                <button type="button" className={'crm-settings-choice'+(preferences.theme==='night'?' is-selected':'')} aria-pressed={preferences.theme==='night'} onClick={()=>updatePreference('theme','night')}><Moon size={20}/><strong>Night mode</strong><span>Dark surfaces, easier on the eyes in low light.</span></button>
                <button type="button" className={'crm-settings-choice'+(preferences.theme==='day'?' is-selected':'')} aria-pressed={preferences.theme==='day'} onClick={()=>updatePreference('theme','day')}><Sun size={20}/><strong>Day mode</strong><span>Light surfaces for bright environments.</span></button>
              </div>
              <h3 className="crm-settings-subheading">Accent colour</h3>
              <div className="crm-settings-choice-grid crm-accent-grid">
                <button type="button" className={'crm-settings-choice'+(preferences.accent==='orange'?' is-selected':'')} aria-pressed={preferences.accent==='orange'} onClick={()=>updatePreference('accent','orange')}><span className="crm-accent-swatch crm-accent-orange"/><strong>Orange ember</strong><span>Original CRM colour set</span></button>
                <button type="button" className={'crm-settings-choice'+(preferences.accent==='blue'?' is-selected':'')} aria-pressed={preferences.accent==='blue'} onClick={()=>updatePreference('accent','blue')}><span className="crm-accent-swatch crm-accent-blue"/><strong>Ocean blue</strong><span>Cool blue accent colour</span></button>
              </div>
              <label className="crm-settings-toggle"><span><Eye size={18}/><span><strong>Night light</strong><small>Apply a gentle warm screen tint to reduce blue light.</small></span></span><input type="checkbox" checked={preferences.nightLight} onChange={event=>updatePreference('nightLight',event.target.checked)}/></label>
            </section>
            <section className="crm-settings-section">
              <div className="crm-settings-heading"><Monitor size={20}/><div><h2>Display & accessibility</h2><p>Adjust spacing and motion for your device.</p></div></div>
              <label className="crm-settings-toggle"><span><span><strong>Compact layout</strong><small>Reduce spacing in CRM panels and tables to show more information.</small></span></span><input type="checkbox" checked={preferences.compact} onChange={event=>updatePreference('compact',event.target.checked)}/></label>
              <label className="crm-settings-toggle"><span><span><strong>Reduce motion</strong><small>Turn off decorative transitions and movement effects.</small></span></span><input type="checkbox" checked={preferences.reducedMotion} onChange={event=>updatePreference('reducedMotion',event.target.checked)}/></label>
            </section>
            <section className="crm-settings-section">
              <div className="crm-settings-heading"><Clock3 size={20}/><div><h2>Regional preferences</h2><p>Choose a preferred time zone for supported date/time views.</p></div></div>
              <label className="crm-settings-field">Time zone
                <select value={preferences.timezone} onChange={event=>updatePreference('timezone',event.target.value)}>
                  <option value="local">Use this device's time zone</option><option value="UTC">UTC</option><option value="Asia/Kolkata">India — Asia/Kolkata</option><option value="Asia/Dhaka">Bangladesh — Asia/Dhaka</option><option value="Europe/Moscow">Moscow — Europe/Moscow</option>
                </select>
              </label>
              <p className="crm-settings-help">The selected preference is saved on this device. Existing attendance records retain their stored work time zone.</p>
            </section>
            <section className="crm-settings-section crm-settings-reset">
              <div><h2>Reset preferences</h2><p>Restore the original night mode, orange accent, and default display options.</p></div>
              <button type="button" onClick={()=>{setPreferences({...DEFAULT_PREFERENCES});try{localStorage.setItem('mbp_crm_preferences',JSON.stringify(DEFAULT_PREFERENCES));}catch{}setSettingsNotice('Default preferences restored.');}}><RotateCcw size={16}/> Restore defaults</button>
            </section>
            {settingsNotice && <p className="crm-settings-notice" role="status">{settingsNotice}</p>}
          </>}
          {activePage === 'dashboard' && <>
{!isAdmin && <section
            style={{ padding: '28px 18px', margin: '20px 0', borderRadius: 14, border: '1px solid #34302c', background: 'radial-gradient(circle at 50% 28%, #25201a 0%, #151413 58%, #101010 100%)', textAlign: 'center' }}
          >
            <div style={{ color: openRecord ? '#86efac' : 'var(--crm-accent)', fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase' }}>{openRecord ? 'SHIFT IN PROGRESS' : 'ATTENDANCE'}</div>
            <h2 style={{ margin: '8px 0 4px', fontSize: 22 }}>{openRecord ? 'You are active on your shift' : 'Ready to start your shift?'}</h2>
            <p style={{ color: '#b7c0d1', margin: '0 auto 22px', maxWidth: 420, fontSize: 13 }}>{openRecord ? 'Your attendance is being recorded. Your live session timer is shown below.' : 'Check in when you begin work. Your current location is required to record attendance.'}</p>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
              <button type="button" aria-label={openRecord ? 'Hold to stop shift' : 'Check in and start shift'} disabled={busy || loadingDashboard}
                onClick={() => { if (!openRecord) void handleCheckIn(); }}
                onPointerDown={() => { if (openRecord) beginStopHold(openRecord.id); }}
                onPointerUp={cancelStopHold} onPointerLeave={cancelStopHold} onPointerCancel={cancelStopHold}
                onContextMenu={event => event.preventDefault()}
                style={{ width: 184, height: 184, borderRadius: '50%', border: '8px solid ' + (openRecord ? '#14532d' : '#7c3d0b'),
                  background: openRecord ? 'radial-gradient(circle at 35% 28%, #34d399, #047857 58%, #064e3b)' : 'radial-gradient(circle at 35% 28%, #ffb454, #e66a13 58%, #9a3412)',
                  color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7,
                  boxShadow: openRecord ? '0 0 0 8px #10b98118, 0 12px 38px #05966955, inset 0 2px 8px #ffffff55' : '0 0 0 8px #f9731618, 0 12px 38px #ea580c55, inset 0 2px 8px #ffffff55',
                  cursor: busy || loadingDashboard ? 'wait' : openRecord ? 'grab' : 'pointer', opacity: busy || loadingDashboard ? .7 : 1,
                  transform: stopHoldArmed ? 'scale(.94)' : 'scale(1)', transition: 'transform .15s ease, box-shadow .2s ease', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}>
                <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.13em' }}>{openRecord ? 'ACTIVE' : busy ? 'PLEASE WAIT' : 'CHECK IN'}</span>
                <span style={{ fontSize: 35, lineHeight: 1 }}>{openRecord ? 'Ⅱ' : '⏻'}</span>
                <span style={{ fontSize: 11, fontWeight: 700 }}>{openRecord ? 'HOLD TO STOP' : 'START SHIFT'}</span>
              </button>
            </div>
            {openRecord ? <>
              <div style={{ marginTop: 22, fontSize: 12, color: '#9ca3af' }}>TIME ON SHIFT</div>
              <div style={{ marginTop: 4, fontSize: 34, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#a7f3d0' }}>
                {(() => { const elapsed = Math.max(0, clockNow - new Date(openRecord.check_in).getTime()); const h = Math.floor(elapsed / 3600000); const m = Math.floor((elapsed % 3600000) / 60000); const sec = Math.floor((elapsed % 60000) / 1000); return [h,m,sec].map(v => String(v).padStart(2,'0')).join(':'); })()}
              </div>
              <p style={{ color: '#b7c0d1', fontSize: 12, margin: '7px 0 0' }}>Started {formatDate(openRecord.check_in, openRecord.work_timezone)} · {openRecord.work_timezone}</p>
              <p style={{ color: stopHoldArmed ? '#fbbf24' : '#98a2b3', fontSize: 12, margin: '14px 0 0', minHeight: 18 }}>{stopHoldArmed ? 'Keep holding… release to cancel' : 'Hold the button to end your shift.'}</p>
            </> : <div style={{ minHeight: 24, marginTop: 16, color: '#9ca3af', fontSize: 12 }}>Your shift timer will start after successful GPS check-in.</div>}
            <KnowMore>Location permission is required when starting and stopping a shift. If your device cannot provide a location fix, the attendance action will not be recorded.</KnowMore>
          </section>}

          {!isAdmin && (
            <section aria-label="Monthly salary attendance progress" style={{ padding: 18, margin: '20px 0', borderRadius: 12, border: '1px solid #344054', background: preferences.theme === 'day' ? '#ffffff' : '#151719' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>Monthly salary attendance</h2>
                <strong style={{ color: salaryProgressColor, fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>{salaryProgress.toFixed(1)}%</strong>
              </div>
              <div style={{ marginTop: 12, height: 13, overflow: 'hidden', borderRadius: 99, background: preferences.theme === 'day' ? '#e5e7eb' : '#30343a' }}>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(salaryProgress)} aria-label="Monthly required work time completed" style={{ width: `${salaryProgress}%`, height: '100%', borderRadius: 99, background: salaryProgressColor, transition: 'width .3s ease, background .3s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 12, fontSize: 13, color: preferences.theme === 'day' ? '#475467' : '#b7c0d1' }}>
                <span>Completed: <strong>{formatDuration(salaryWorkedMilliseconds)}</strong></span>
                <span>Required: <strong>{formatDuration(salaryRequiredMilliseconds)}</strong></span>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 13, color: preferences.theme === 'day' ? '#475467' : '#b7c0d1' }}>
                {salaryProgress >= 100
                  ? 'Monthly minimum attendance completed. Salary eligibility threshold achieved.'
                  : `${formatDuration(salaryRemainingMilliseconds)} remaining to complete this month’s required work time.`}
              </p>
              <KnowMore>Monthly target: 8 work hours per weekday. Weekends are excluded. A fixed 1-hour break is deducted only from shifts lasting 5 hours or more. Progress colours indicate below 80%, 80–89.9%, and 90–100%.</KnowMore>
            </section>
          )}

          <h1>{isAdmin ? 'Dashboard' : 'Dashboard'}</h1>
          <p className="crm-account-context">{profile?.full_name || session.user.email} · {profile?.role || 'Role unavailable'}</p>

          {isAdmin && (
            <section style={{ padding: 18, margin: '20px 0', borderRadius: 12, border: '1px solid #344054' }}>
              <h2 style={{ marginTop: 0 }}>Team overview</h2>
              <KnowMore>Team visibility is restricted by your assigned permissions and database access policies.</KnowMore>
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

          {!isAdmin && telegramLinked !== true && <section
            style={{
              padding: 18,
              margin: '20px 0',
              borderRadius: 3,
              border: '1px solid #34302c',
            }}
          >
            <h2 style={{ marginTop: 0 }}>Telegram account</h2>
            <p style={{ color: '#d1cbc5' }}>
              {telegramLinked === false
                ? 'Telegram is not linked to your account yet. Create a link below to connect it.'
                : 'Unable to verify Telegram link status right now. You can refresh the page or create a link if you have not linked Telegram yet.'}
            </p>
            <button
              type="button"
              disabled={busy || loadingDashboard}
              onClick={() => void handleCreateTelegramLink()}
              style={buttonStyle}
            >
              {busy ? 'Please wait…' : 'Create Telegram linking link'}
            </button>
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
                    background: 'var(--crm-accent-strong)',
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

          

          </>}
          {(isAdmin || canManageTeam) && ['team','manager-hierarchy','team-roles','team-links','team-assignments','team-invitations'].includes(activePage) && <ManagementTools supabase={supabase} profile={profile} profiles={profiles} page={activePage as 'team' | 'team-roles' | 'team-links' | 'team-assignments' | 'team-invitations'} />}
          {canUseHumanTelegram && activePage === 'telegram-human' && <ManagementTools key={telegramHumanNavKey} supabase={supabase} profile={profile} profiles={profiles} page="telegram-human" />}
          {(isAdmin || canManageTeam) && activePage === 'telegram-analytics' && <ManagementTools supabase={supabase} profile={profile} profiles={profiles} page="telegram-analytics" />}
          {isAdmin && activePage === 'security' && <SecurityActivityPanel />}

          {!isAdmin && !activePage.startsWith('team-') && activePage !== 'team' && <section style={{ marginTop: 28 }}>
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

          {activePage === 'manager-hierarchy' && (isAdmin || canManageTeam) && <ManagerHierarchy profile={profile} profiles={profiles} assignments={managerAssignments} attendance={attendance} telegramMembers={telegramMembers} telegramMetrics={telegramResponseMetrics} isAdmin={isAdmin} />}
          {activePage === 'team-attendance' && isAdmin && <TeamAttendanceReport attendance={attendance} shifts={shifts} profiles={profiles} assignments={managerAssignments} telegramMembers={telegramMembers} telegramMetrics={telegramResponseMetrics} loading={loadingDashboard} />}
          {activePage === 'attendance-records' && <>
          <section style={{ marginTop: 28 }}>
            <h2>{isAdmin ? 'Attendance records' : 'My attendance records'}</h2>
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
              </button>              <button type="button" style={{ ...buttonStyle, background: '#475467' }} onClick={() => { setDraftStartDate(''); setDraftEndDate(''); setReportStartDate(''); setReportEndDate(''); setMessage('Date filters cleared.'); }}>
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

            {(isAdmin || canManageTeam) && (() => {
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
              const topLevelPeople = isAdmin
                ? allPeople.filter(person => topLevelRoles.has(String(person.role).toLowerCase()) && !peopleWithParents.has(person.id))
                : (profile && peopleById.has(profile.id) ? [peopleById.get(profile.id)!] : []);
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
              if (isAdmin && selectedEmployeeId !== 'all') {
                const selectedPerson = peopleById.get(selectedEmployeeId);
                if (selectedPerson) visiblePeople.push({ person: selectedPerson, depth: 0, hasChildren: false });
              } else {
                topLevelPeople.forEach(person => appendBranch(person, 0, new Set()));
              }
              const people = visiblePeople;
              const timeOnly = (value: string | null, timezone: string | null) => value ? new Intl.DateTimeFormat(undefined, {hour:'2-digit',minute:'2-digit',hour12:false,...(timezone ? {timeZone:timezone} : {})}).format(new Date(value)) : '—';
              const gpsButton = (lat: number | null, lng: number | null, title: string) => lat != null && lng != null
                ? <button type="button" aria-label={title} title={title} onClick={() => setMapPreview({title,latitude:lat,longitude:lng})} style={{display:'inline-grid',placeItems:'center',width:18,height:18,minHeight:18,padding:0,color:'var(--crm-accent)',background:'var(--crm-accent-soft)',border:'1px solid var(--crm-accent-strong)',borderRadius:3,cursor:'pointer',verticalAlign:'middle'}}><MapPin size={11}/></button>
                : null;
              return <>
                <div style={{overflowX:'auto',border:'1px solid var(--crm-border)',marginTop:12}}>
                <table style={{borderCollapse:'separate',borderSpacing:0,width:'100%',minWidth:Math.max(620,180+dateKeys.length*154),textAlign:'left'}}>
                  <thead><tr style={{background:'var(--crm-card-raised)'}}>
                    <th style={{position:'sticky',left:0,zIndex:2,background:'var(--crm-card-raised)',padding:12,borderBottom:'1px solid var(--crm-border)',minWidth:180}}>Employee</th>
                    {dateKeys.map(date => <th key={date} style={{padding:10,borderBottom:'1px solid var(--crm-border)',whiteSpace:'nowrap',textAlign:'center'}}>{new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',day:'2-digit',month:'short'})}</th>)}
                  </tr></thead>
                  <tbody>{people.map(({ person, depth, hasChildren }) => <tr key={person.id}>
                    <th scope="row" style={{position:'sticky',left:0,zIndex:1,background:'var(--crm-card-bg)',padding:8,borderBottom:'1px solid var(--crm-border)',fontWeight:600,minWidth:110,maxWidth:150}}><div style={{display:'flex',alignItems:'center',gap:8,paddingLeft:depth*16}}>{hasChildren ? <button type="button" aria-label={expandedManagerIds.has(person.id) ? 'Collapse team' : 'Expand team'} title={expandedManagerIds.has(person.id) ? 'Collapse team' : 'Expand team'} onClick={() => setExpandedManagerIds(current => { const next = new Set(current); if (next.has(person.id)) next.delete(person.id); else next.add(person.id); return next; })} style={{display:'grid',placeItems:'center',width:16,height:24,padding:0,flexShrink:0,border:0,background:'transparent',color:'#ffb36b',fontSize:18,fontWeight:800,cursor:'pointer'}}>{expandedManagerIds.has(person.id) ? '▾' : '▸'}</button> : <span aria-hidden="true" style={{display:'inline-block',width:16,flexShrink:0}}/>}<span aria-hidden="true" style={{display:'grid',placeItems:'center',width:30,height:30,flexShrink:0,background:'#352116',border:'1px solid #8a5318',color:'#ffd18a',fontWeight:800}}>{(person.full_name || person.email || '?').trim().charAt(0).toUpperCase()}</span><span style={{display:'flex',flexDirection:'column',minWidth:0}}><span style={{fontSize:12,overflowWrap:'anywhere'}}>{person.full_name || 'Employee'}</span><span style={{fontSize:9,fontWeight:400,color:'#ffb36b',marginTop:2}}>{String(person.role).replace(/_/g,' ')}</span>{person.email && <span title={person.email} style={{fontSize:9,fontWeight:400,color:'#aaa29b',overflowWrap:'anywhere',lineHeight:1.2,marginTop:3}}>{person.email}</span>}</span></div></th>
                    {dateKeys.map(date => {
                      const records = reportAttendance.filter(item => item.employee_id === person.id && (item.work_date ?? (item.work_timezone ? getLocalDate(item.work_timezone,new Date(item.check_in)) : item.check_in.slice(0,10))) === date);
                      const record = records[0];
                      const completed = Boolean(record?.check_out);
                      const present = Boolean(record);
                      const bg = !present ? '#541b20' : completed ? '#153c2a' : '#4b2d10';
                      const fg = !present ? '#ffb4b4' : completed ? '#8ce2ae' : '#ffd18a';
                      return <td key={date} style={{padding:6,borderBottom:'1px solid var(--crm-border)',textAlign:'center',minWidth:154}}>
                        <div title={!present?'Absent':completed?'Signed in and out':'Signed in; not signed out'} style={{display:'inline-flex',alignItems:'stretch',justifyContent:'space-between',gap:8,padding:'7px 9px',width:142,minWidth:142,minHeight:54,boxSizing:'border-box',background:bg,color:fg,border:'1px solid '+(!present?'#8b2d35':completed?'#286947':'#8a5318'),borderRadius:4,fontSize:12,fontWeight:700,textAlign:'left'}}>
                          {!present ? <span style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%'}}>Absent</span> : <>
                            {isAdmin ? <>
                              <span style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:4,lineHeight:1.2}}>
                                <span>IN&nbsp; {timeOnly(record.check_in,record.work_timezone)}</span>
                                <span>OUT {timeOnly(record.check_out,record.work_timezone)}</span>
                              </span>
                              <span style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:5,flexShrink:0}}>
                                {gpsButton(record.check_in_lat,record.check_in_lng,'Check-in location')}
                                {gpsButton(record.check_out_lat,record.check_out_lng,'Check-out location')}
                              </span>
                            </> : <span style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:4,lineHeight:1.2}}>
                              <span>IN&nbsp; {timeOnly(record.check_in,record.work_timezone)}</span>
                              <span>OUT {timeOnly(record.check_out,record.work_timezone)}</span>
                            </span>}
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
            {!isAdmin && !canManageTeam && reportAttendance.map((item) => {
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