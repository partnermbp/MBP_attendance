
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, X, MapPin, LayoutDashboard, Users, CalendarDays, MessageCircle, MoreHorizontal, LogOut, ShieldAlert, ChevronDown, ChevronRight, UserCog, Link2, GitBranch, UserPlus, Settings as SettingsIcon, Sun, Moon, Monitor, RotateCcw, Clock3, Palette, Eye, Download, Smartphone, Search } from 'lucide-react';
import type { CSSProperties, FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import ManagementTools from './components/ManagementTools';
import TeamAttendanceReport from './components/TeamAttendanceReport';
import ManagerHierarchy from './components/ManagerHierarchy';
import TelegramIdRequests from './components/TelegramIdRequests';
import KnowMore from './components/KnowMore';
import WorkforceOperations from './components/WorkforceOperations';
import DeviceSecurityMonitoring, { DeviceTelemetryController } from './components/DeviceSecurityMonitoring';

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
  credited_work_minutes?: number | null;
  manual_adjustment_minutes?: number | null;
  manual_original_credited_minutes?: number | null;
  manual_adjusted_at?: string | null;
  manual_check_in_changed?: boolean;
  manual_check_out_changed?: boolean;
  manually_adjusted?: boolean;
  auto_closed?: boolean;
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
  admin_panel_name?: string | null;
  role: string;
  active: boolean;
  telegram_user_id?: number | null;
  telegram_verified_at?: string | null;
  telegram_username?: string | null;
};

type ManagerAssignment = { manager_id: string; employee_id: string };
type EmployeePersonalProfile = { user_id: string; avatar_key: string; nickname: string; updated_at?: string };
type DirectManagerContact = { manager_name: string; manager_role: string; manager_telegram_username: string | null };

type Screen = 'loading' | 'login' | 'set-password' | 'signed-in';
type CrmPage = 'my-profile' | 'dashboard' | 'downloads' | 'attendance' | 'attendance-records' | 'workforce-operations' | 'team-attendance' | 'team' | 'manager-hierarchy' | 'team-roles' | 'team-links' | 'team-assignments' | 'team-invitations' | 'telegram' | 'telegram-human' | 'telegram-analytics' | 'security' | 'requests' | 'settings';
type CrmPreferences = { theme: 'night' | 'day'; accent: 'orange' | 'blue'; glassy: boolean; nightLight: boolean; compact: boolean; reducedMotion: boolean; timezone: string };
const DEFAULT_PREFERENCES: CrmPreferences = { theme: 'night', accent: 'orange', glassy: false, nightLight: false, compact: false, reducedMotion: false, timezone: 'local' };
function loadCrmPreferences(): CrmPreferences { try { const raw = localStorage.getItem('mbp_crm_preferences'); return raw ? { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) } : DEFAULT_PREFERENCES; } catch { return DEFAULT_PREFERENCES; } }
type PasswordFlow = 'invite' | 'recovery' | null;

type Coordinates = {
  latitude: number;
  longitude: number;
};

const CRM_WEB_APP_URL = 'https://attendence.dpdns.org/';
const ANDROID_APK_DOWNLOAD_URL = 'https://github.com/partnermbp/MBP_attendance/releases/download/android-latest/app-debug.apk';
const WINDOWS_EXE_DOWNLOAD_URL = 'https://github.com/partnermbp/MBP_attendance/releases/download/windows-latest/MBP-Attendance-Setup-0.1.1.exe';
const MACOS_DMG_DOWNLOAD_URL = 'https://github.com/partnermbp/MBP_attendance/releases/download/macos-latest/MBP-Attendance-0.1.1-macOS.dmg';
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

function creditedMinutesForSession(item: Attendance, now = Date.now()) {
  if (typeof item.credited_work_minutes === 'number') return Math.max(0, item.credited_work_minutes);
  const start = new Date(item.check_in).getTime();
  const end = item.check_out ? new Date(item.check_out).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  const elapsed = Math.floor((end - start) / 60000);
  if (item.auto_closed || (!item.check_out && elapsed >= 9 * 60)) return 8 * 60;
  if (elapsed >= 9 * 60) return 8 * 60 + Math.min(2 * 60, elapsed - 9 * 60);
  return Math.max(0, elapsed - (elapsed >= BREAK_THRESHOLD_MINUTES ? BREAK_MINUTES : 0));
}

function getSessionDuration(item: Attendance, now: number) {
  const start = new Date(item.check_in).getTime();
  if (!Number.isFinite(start)) return { elapsed: 'Unavailable', worked: 'Unavailable', breakDeduction: 'Not applied', status: 'Invalid timestamp' };
  const end = item.check_out ? new Date(item.check_out).getTime() : now;
  if (!Number.isFinite(end) || end < start) return { elapsed: 'Unavailable', worked: 'Unavailable', breakDeduction: 'Not applied', status: 'Invalid timestamp' };
  const elapsedMilliseconds = end - start;
  const elapsedMinutes = Math.floor(elapsedMilliseconds / 60000);
  const breakMinutes = elapsedMinutes >= BREAK_THRESHOLD_MINUTES ? BREAK_MINUTES : 0;
  const credited = creditedMinutesForSession(item, now);
  return {
    elapsed: formatDuration(elapsedMilliseconds),
    worked: formatDuration(credited * 60000),
    breakDeduction: formatDuration(breakMinutes * 60000),
    status: item.auto_closed ? 'Auto-closed · standard shift credited' : item.check_out ? 'Completed' : 'Open session',
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
      // Re-check native permission at action time. If the user revoked it,
      // request it again through the operating system permission sheet.
      const permission = await Geolocation.checkPermissions();
      if (permission.location !== 'granted') {
        const requested = await Geolocation.requestPermissions();
        if (requested.location !== 'granted') {
          throw new Error('Location permission is blocked for Attendance CRM. Enable Location in your device app settings.');
        }
      }
      try {
        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 45000,
          maximumAge: 15000,
        });
        return toCoordinates(position.coords.latitude, position.coords.longitude);
      } catch (firstError) {
        const detail = firstError instanceof Error ? firstError.message : String(firstError ?? '');
        if (/permission|denied/i.test(detail)) {
          throw new Error('Location permission is blocked for Attendance CRM. Enable Location in your device app settings.');
        }
        // A GPS-only fix can time out indoors. Retry using the device's
        // available location providers before failing the attendance action.
        const fallback = await Geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 30000,
          maximumAge: 30000,
        });
        return toCoordinates(fallback.coords.latitude, fallback.coords.longitude);
      }
    } catch (error) {
      if (error instanceof Error && /permission|blocked/i.test(error.message)) throw error;
      const detail = error instanceof Error ? error.message : String(error ?? '');
      if (/permission|denied/i.test(detail)) {
        throw new Error('Location permission is blocked for Attendance CRM. Enable Location in your device app settings.');
      }
      throw new Error('Your device could not provide a location fix. Turn on Location Services and try again.');
    }
  }

  if (!navigator.geolocation) {
    throw new Error('Location is not supported by this browser. Use a browser with location access enabled.');
  }

  const requestPosition = (options: PositionOptions) => new Promise<Coordinates>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        try { resolve(toCoordinates(coords.latitude, coords.longitude)); }
        catch (error) { reject(error); }
      },
      error => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error('Location permission is blocked for this site. Allow location for Attendance CRM in your browser or device settings, then retry check-out.'));
        } else if (error.code === error.TIMEOUT) {
          reject(new Error('GPS location timed out.'));
        } else {
          reject(new Error('GPS location is temporarily unavailable.'));
        }
      },
      options,
    );
  });

  try {
    return await requestPosition({ enableHighAccuracy: true, timeout: 45000, maximumAge: 15000 });
  } catch (error) {
    const detail = getErrorMessage(error);
    if (/permission|blocked/i.test(detail)) throw error;
    try {
      // Retry with network-assisted/coarse location if a precise GPS fix is slow.
      return await requestPosition({ enableHighAccuracy: false, timeout: 30000, maximumAge: 30000 });
    } catch (fallbackError) {
      if (/permission|blocked/i.test(getErrorMessage(fallbackError))) throw fallbackError;
      throw new Error('GPS location is still unavailable after retry. Turn on device Location Services, keep the browser/app open, and try again.');
    }
  }
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
  id: number; event_type: string; inviter_name: string | null;
  invitee_admin_panel_name: string | null; invitee_email: string | null;
  telegram_user_id: number | null; telegram_username: string | null;
  details: string; created_at: string;
};

function SecurityActivityPanel() {
  const [events,setEvents]=useState<SecurityActivity[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [refreshKey,setRefreshKey]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    void (async()=>{
      if(!supabase){setError('Security monitoring is unavailable because the database is not configured.');setLoading(false);return;}
      const {data,error}=await supabase.from('suspicious_activities')
        .select('id,event_type,inviter_name,invitee_admin_panel_name,invitee_email,telegram_user_id,telegram_username,details,created_at')
        .order('created_at',{ascending:false}).limit(100);
      if(cancelled)return;
      if(error)setError('Could not load risk events: '+error.message);
      else setEvents((data||[]) as SecurityActivity[]);
      setLoading(false);
    })();
    return()=>{cancelled=true;};
  },[refreshKey]);
  const cellStyle:CSSProperties={padding:9,borderBottom:'1px solid #344054',textAlign:'left',verticalAlign:'top',overflowWrap:'anywhere',fontSize:12};
  return <section style={{marginTop:20}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
      <div><h1>Security</h1><p style={{color:'#b7c0d1',marginTop:4}}>Only flagged identity-reuse and suspicious invitation attempts appear here. Routine sign-ins, logouts and device heartbeats are excluded.</p></div>
      <button type="button" onClick={()=>{setLoading(true);setRefreshKey(v=>v+1);}} style={{padding:'7px 11px',borderRadius:7}}>Refresh alerts</button>
    </div>
    <h2>Suspicious invitation & identity activity</h2>
    {loading&&<p>Checking flagged activity…</p>}
    {error&&<p role="alert" style={{color:'#fda29b'}}>{error}</p>}
    {!loading&&!events.length&&!error&&<p style={{color:'#b7c0d1'}}>No flagged invitation or identity-reuse attempts recorded.</p>}
    {!!events.length&&<div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',minWidth:900}}>
        <thead><tr>{['Time','Risk event','Inviter','Invitee','Email','Telegram identity','Evidence'].map(x=><th key={x} style={cellStyle}>{x}</th>)}</tr></thead>
        <tbody>{events.map(event=><tr key={event.id}>
          <td style={cellStyle}>{new Date(event.created_at).toLocaleString()}</td><td style={cellStyle}>{event.event_type.replaceAll('_',' ')}</td>
          <td style={cellStyle}>{event.inviter_name||'Unavailable'}</td><td style={cellStyle}>{event.invitee_admin_panel_name||'Unavailable'}</td>
          <td style={cellStyle}>{event.invitee_email||'Unavailable'}</td><td style={cellStyle}>{event.telegram_username?'@'+event.telegram_username:'ID '+(event.telegram_user_id??'unavailable')}</td><td style={cellStyle}>{event.details}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}


function AuthVectorScene() {
  return <div className="auth-vector-scene" aria-hidden="true">
    <svg className="auth-vector-art" viewBox="0 0 1000 560" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="authRocketShell" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--auth-rocket-light,#fff0df)"/>
          <stop offset=".52" stopColor="var(--auth-rocket-mid,#e7a16e)"/>
          <stop offset="1" stopColor="var(--auth-rocket-dark,#b95f35)"/>
        </linearGradient>
        <linearGradient id="authRocketFin" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="var(--auth-rocket-mid,#e7a16e)"/><stop offset="1" stopColor="var(--auth-rocket-dark,#b95f35)"/>
        </linearGradient>
        <linearGradient id="authRocketWindow" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#EAF8FF"/><stop offset=".55" stopColor="#76B5D6"/><stop offset="1" stopColor="#315F7C"/>
        </linearGradient>
        <linearGradient id="authFlame" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="var(--auth-flame-light,#FFE1A8)"/><stop offset="1" stopColor="var(--auth-flame-dark,#E47C45)" stopOpacity=".12"/>
        </linearGradient>
      </defs>

      <g className="auth-star auth-star-one" fill="var(--auth-star-color,#D58B5B)">
        <path d="M215 145l4 13 13 4-13 4-4 13-4-13-13-4 13-4 4-13Z"/>
      </g>
      <g className="auth-star auth-star-two" fill="var(--auth-star-cool,#8EBBD6)">
        <path d="M835 125l3 9 9 3-9 3-3 9-3-9-9-3 9-3 3-9Z"/>
      </g>
      <g className="auth-star auth-star-three" fill="var(--auth-star-color,#D58B5B)">
        <path d="M870 430l3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z"/>
      </g>

      <g className="auth-rocket" transform="translate(185 360) rotate(-28)">
        <path d="M0 65C-12 20-4-42 34-104C72-42 80 20 68 65L34 91 0 65Z" fill="url(#authRocketShell)" stroke="var(--auth-rocket-outline,#A85D39)" strokeWidth="2.5"/>
        <path d="M34-104C50-76 59-48 62-20L34-7 6-20C9-48 18-76 34-104Z" fill="var(--auth-nose-highlight,#FFF4E8)" fillOpacity=".82"/>
        <path d="M-2 39L-34 85L8 70M70 39L102 85L60 70" fill="url(#authRocketFin)" stroke="var(--auth-rocket-outline,#A85D39)" strokeWidth="2.5" strokeLinejoin="round"/>
        <path d="M24 79L34 122L44 79" fill="url(#authFlame)" opacity=".95"/>
        <path d="M30 82L34 108L38 82" stroke="var(--auth-flame-core,#FFF0C8)" strokeWidth="4" strokeLinecap="round"/>
        <circle cx="34" cy="5" r="16" fill="var(--auth-window-rim,#F8E5D2)" stroke="var(--auth-rocket-outline,#A85D39)" strokeWidth="3"/>
        <circle cx="34" cy="5" r="11" fill="url(#authRocketWindow)"/>
        <path d="M29-1Q35-8 40-1" stroke="#FFFFFF" strokeOpacity=".85" strokeWidth="2" strokeLinecap="round"/>
        <path d="M12 48L34 63L56 48" stroke="var(--auth-rocket-outline,#A85D39)" strokeOpacity=".5" strokeWidth="2"/>
      </g>

      <g className="auth-beacon" transform="translate(820 220)">
        <path d="M-20 24L-13-12Q0-27 13-12L20 24Z" fill="var(--auth-beacon-shell,#E7A16E)" stroke="var(--auth-beacon-outline,#A85D39)" strokeWidth="2"/>
        <rect x="-24" y="23" width="48" height="8" rx="3" fill="var(--auth-beacon-base,#A85D39)"/>
        <rect x="-7" y="30" width="14" height="17" rx="2" fill="var(--auth-beacon-base,#A85D39)"/>
        <path d="M-12-7Q0-20 12-7L8 7H-8Z" fill="var(--auth-beacon-light,#FFE0A9)" fillOpacity=".9"/>
        <circle className="auth-beacon-pulse" cy="-3" r="28" stroke="var(--auth-beacon-light,#FFE0A9)" strokeWidth="1.5" strokeOpacity=".7"/>
        <path d="M-18-15L-48-32M18-15L48-32" stroke="var(--auth-beacon-ray,#D58B5B)" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 5"/>
      </g>

      <g className="auth-debris auth-debris-a" fill="var(--auth-debris-fill,#C88C64)" stroke="var(--auth-debris-stroke,#A96E4C)" strokeWidth="1.4">
        <path d="M500 115L518 107L529 122L514 136L497 128Z"/><path d="M510 115L518 128" strokeOpacity=".6"/>
      </g>
      <g className="auth-debris auth-debris-b" fill="var(--auth-debris-fill,#C88C64)" stroke="var(--auth-debris-stroke,#A96E4C)" strokeWidth="1.4">
        <path d="M720 390L735 380L748 393L739 410L721 407Z"/><path d="M730 385L739 405" strokeOpacity=".6"/>
      </g>
      <g className="auth-debris auth-debris-c" fill="var(--auth-debris-fill,#C88C64)" stroke="var(--auth-debris-stroke,#A96E4C)" strokeWidth="1.3">
        <path d="M390 455L402 444L415 452L411 468L395 470Z"/>
      </g>
      <g className="auth-debris auth-debris-d" fill="var(--auth-debris-fill,#C88C64)" stroke="var(--auth-debris-stroke,#A96E4C)" strokeWidth="1.2">
        <path d="M940 300L950 292L961 301L955 314L941 313Z"/>
      </g>

      <g className="auth-shooting-star auth-shooting-star-a">
        <path d="M590 78L520 112" stroke="url(#authRocketShell)" strokeWidth="2.2" strokeLinecap="round"/>
        <circle cx="590" cy="78" r="2.6" fill="var(--auth-shooting-core,#FFF4DF)"/>
      </g>
      <g className="auth-shooting-star auth-shooting-star-b">
        <path d="M920 470L850 505" stroke="var(--auth-shooting-trail,#91BBD4)" strokeWidth="1.8" strokeLinecap="round"/>
        <circle cx="920" cy="470" r="2.2" fill="var(--auth-shooting-core,#FFF4DF)"/>
      </g>
      <path d="M90 470C210 410 270 390 360 380" stroke="var(--auth-orbit-line,#D9A477)" strokeOpacity=".18" strokeWidth="1.2" strokeDasharray="3 12"/>
      <path d="M640 185C700 165 750 160 790 175" stroke="var(--auth-orbit-line,#D9A477)" strokeOpacity=".16" strokeWidth="1.2" strokeDasharray="2 10"/>
    </svg>
  </div>;
}
function CrmAmbientBackdrop() {
  return <div className="crm-ambient-backdrop" aria-hidden="true">
    <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="crmAmbientLine" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--crm-accent,#d9874e)" stopOpacity="0"/><stop offset=".48" stopColor="var(--crm-accent,#d9874e)" stopOpacity=".26"/><stop offset="1" stopColor="var(--crm-vector-cool,#9dbbd0)" stopOpacity="0"/></linearGradient>
        <linearGradient id="crmShootingStar" x1="0" y1="0" x2="1" y2="0"><stop stopColor="var(--crm-vector-cool,#9dbbd0)" stopOpacity="0"/><stop offset=".72" stopColor="var(--crm-vector-cool,#9dbbd0)" stopOpacity=".7"/><stop offset="1" stopColor="#fff" stopOpacity=".9"/></linearGradient>
      </defs>
      <path d="M-80 710C250 430 570 350 850 430S1260 690 1530 390" fill="none" stroke="url(#crmAmbientLine)" strokeWidth="1"/>
      <path d="M-90 790C270 530 570 490 860 550S1250 770 1510 520" fill="none" stroke="url(#crmAmbientLine)" strokeWidth=".7" strokeDasharray="2 12"/>
      <circle cx="78%" cy="23%" r="1.6" fill="var(--crm-vector-cool,#9dbbd0)" opacity=".38"/>
      <circle cx="24%" cy="72%" r="1.4" fill="var(--crm-accent,#d9874e)" opacity=".32"/>
      <circle cx="88%" cy="76%" r="1.2" fill="var(--crm-vector-cool,#9dbbd0)" opacity=".3"/>
      <path className="crm-shooting-star crm-shooting-star-a" d="M0 0L-94 30" stroke="url(#crmShootingStar)" strokeWidth="1.2" strokeLinecap="round"/>
      <path className="crm-shooting-star crm-shooting-star-b" d="M0 0L-72 23" stroke="url(#crmShootingStar)" strokeWidth="1" strokeLinecap="round"/>
      <path className="crm-shooting-star crm-shooting-star-c" d="M0 0L-82 26" stroke="url(#crmShootingStar)" strokeWidth="1" strokeLinecap="round"/>
    </svg>
    <div className="crm-ambient-grain"/>
  </div>;
}

function VectorLoader({ label = 'Loading your workspace' }: { label?: string }) {
  return <div className="vector-loader" role="status">
    <svg viewBox="0 0 120 90" aria-hidden="true">
      <path className="loader-orbit" d="M12 55C25 10 95 10 108 55C95 100 25 100 12 55Z" fill="none" stroke="currentColor" strokeOpacity=".28" strokeWidth="1.5" strokeDasharray="4 6"/>
      <g className="loader-rocket" transform="translate(60 43) rotate(35)">
        <path d="M0-28C11-17 14-1 11 15L0 24-11 15C-14-1-11-17 0-28Z" fill="var(--crm-accent, #d9874e)" stroke="var(--crm-accent-strong, #b96b38)" strokeWidth="1.5"/>
        <circle cy="-3" r="5" fill="var(--crm-vector-cool, #9dbbd0)" stroke="var(--crm-text, #e5e7eb)" strokeWidth="1.5"/>
        <path d="M-10 9L-20 20-8 18M10 9L20 20 8 18" fill="var(--crm-vector-cool-strong, #648ca8)"/>
        <path d="M-4 24Q0 38 4 24" stroke="var(--crm-accent-strong, #b96b38)" strokeWidth="3" strokeLinecap="round"/>
      </g>
      <circle className="loader-dot" cx="60" cy="5" r="3" fill="var(--crm-vector-cool, #9dbbd0)"/>
    </svg>
    <span>{label}</span>
  </div>;
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
  const attendanceActionInFlightRef = useRef(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [showTelegramIdRequest, setShowTelegramIdRequest] = useState(false);
  const [oldTelegramIdInput, setOldTelegramIdInput] = useState('');
  const [newTelegramIdInput, setNewTelegramIdInput] = useState('');
  const [telegramIdChangeComment, setTelegramIdChangeComment] = useState('');
  const [telegramIdLookupBusy, setTelegramIdLookupBusy] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [showCorrectionShortcut, setShowCorrectionShortcut] = useState(false);
  const [showAttendanceLocationNotice, setShowAttendanceLocationNotice] = useState(false);
  const [workforceInitialTab, setWorkforceInitialTab] = useState<'leave'|'corrections'>('leave');
  const [mapPreview, setMapPreview] = useState<{ title: string; latitude: number; longitude: number } | null>(null);
  const [navOpen, setNavOpen] = useState(true);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [installationGuide, setInstallationGuide] = useState<'ios' | 'macos' | null>(null);
  const [installationStep, setInstallationStep] = useState(0);
  const [preferences, setPreferences] = useState<CrmPreferences>(loadCrmPreferences);
  const [settingsNotice, setSettingsNotice] = useState('');
  const updatePreference = <K extends keyof CrmPreferences>(key: K, value: CrmPreferences[K]) => { setPreferences(current => { const next = { ...current, [key]: value }; try { localStorage.setItem('mbp_crm_preferences', JSON.stringify(next)); } catch { /* Browser storage may be disabled. */ } return next; }); setSettingsNotice('Your preferences have been saved on this device.'); };
  useEffect(() => { const root = document.documentElement; root.dataset.crmTheme = preferences.theme; root.dataset.crmAccent = preferences.accent; root.classList.toggle('crm-glassy', preferences.glassy); document.body.classList.toggle('crm-glassy', preferences.glassy); root.classList.toggle('crm-compact', preferences.compact); root.classList.toggle('crm-reduced-motion', preferences.reducedMotion); root.classList.toggle('crm-night-light', preferences.nightLight); document.body.dataset.crmTheme = preferences.theme; }, [preferences]);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const [attendanceMenuOpen, setAttendanceMenuOpen] = useState(false);
  const [telegramMembers, setTelegramMembers] = useState<Array<{telegram_user_id:number;profile_id:string|null}>>([]);
  const [telegramResponseMetrics, setTelegramResponseMetrics] = useState<Array<{question_user_id:number|null;first_reply_user_id:number|null;response_seconds:number|null;calculated_at?:string|null;profile_id?:string;asked_count?:number;reply_count?:number;average_response_seconds?:number|null;response_samples?:Array<{response_seconds:number;calculated_at:string|null}>;question_samples?:Array<{calculated_at:string|null;answered:boolean}>}>>([]);
  const [telegramMenuOpen, setTelegramMenuOpen] = useState(false);
  const [activePage, setActivePage] = useState<CrmPage>('dashboard');
  const [personalProfile, setPersonalProfile] = useState<EmployeePersonalProfile>({user_id:'',avatar_key:'male-01',nickname:''});
  const [personalProfileDraft, setPersonalProfileDraft] = useState({avatar_key:'male-01',nickname:''});
  const [directManager, setDirectManager] = useState<DirectManagerContact | null>(null);
  const [personalProfileSaving, setPersonalProfileSaving] = useState(false);
  const [personalProfileNotice, setPersonalProfileNotice] = useState('');
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [telegramHumanNavKey, setTelegramHumanNavKey] = useState(0);
  const [humanTelegramAccess, setHumanTelegramAccess] = useState(false);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [salaryAttendance, setSalaryAttendance] = useState<Attendance[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [approvedLeave, setApprovedLeave] = useState<Array<{employee_id:string;start_date:string;end_date:string;status:string}>>([]);
  const [workforceHolidays, setWorkforceHolidays] = useState<Array<{holiday_date:string;name:string}>>([]);
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
  const [newRequestCount, setNewRequestCount] = useState(0);
  const [newSecurityLogCount, setNewSecurityLogCount] = useState(0);
  const [pendingWorkforceCount, setPendingWorkforceCount] = useState(0);

  useEffect(() => {
    if (!supabase || !profile?.id) { setApprovedLeave([]); setWorkforceHolidays([]); return; }
    let cancelled = false;
    void Promise.all([
      supabase.from('workforce_leave_requests').select('employee_id,start_date,end_date,status').eq('status','approved').limit(10000),
      supabase.from('workforce_holidays').select('holiday_date,name').limit(10000),
    ]).then(([leaveResult, holidayResult]) => {
      if (cancelled) return;
      setApprovedLeave((leaveResult.data || []) as Array<{employee_id:string;start_date:string;end_date:string;status:string}>);
      setWorkforceHolidays((holidayResult.data || []) as Array<{holiday_date:string;name:string}>);
      if (leaveResult.error || holidayResult.error) setMessage(current => current || 'Leave and holiday calendar could not be loaded for attendance calculations.');
    });
    return () => { cancelled = true; };
  }, [profile?.id]);

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
    // Every successful authentication or restored session starts at Dashboard.
    // This prevents a previously selected page (including My Profile) from
    // becoming the landing page for the next signed-in session.
    setActivePage('dashboard');
    // Do not render any signed-in navigation or page content until the role
    // and all role-scoped dashboard data have finished loading.
    setProfileReady(false);
    setProfile(null);
    setLoadingDashboard(true);

    try {
      const profileResult = await supabase
        .from('profiles')
        .select('id, email, full_name, admin_panel_name, role, active, telegram_user_id, telegram_verified_at, telegram_username')
        .eq('id', userId)
        .maybeSingle();

      if (profileResult.error) {
        setProfile(null);
        setMessage(`Could not load account role: ${profileResult.error.message}`);
        return;
      }

      let currentProfile = profileResult.data as Profile | null;
      setProfile(currentProfile);
      const [personalResult, managerResult] = await Promise.all([
        supabase.from('employee_personal_profiles').select('user_id, avatar_key, nickname, updated_at').eq('user_id', userId).maybeSingle(),
        supabase.rpc('get_my_direct_manager_contact'),
      ]);
      const ownPersonal = (personalResult.data as EmployeePersonalProfile | null) || {user_id:userId,avatar_key:'male-01',nickname:''};
      setPersonalProfile(ownPersonal);
      setPersonalProfileDraft({avatar_key:ownPersonal.avatar_key,nickname:ownPersonal.nickname || ''});
      const managerRows = Array.isArray(managerResult.data) ? managerResult.data : managerResult.data ? [managerResult.data] : [];
      setDirectManager((managerRows[0] as DirectManagerContact | undefined) || null);
      setPersonalProfileNotice(personalResult.error || managerResult.error ? 'Some profile details could not be loaded. Refresh the page to try again.' : '');
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
      const fetchPagedRows = async <T,>(queryForRange: (from:number,to:number) => any) => {
        const rows:T[] = [];
        for (let offset=0; offset<100000; offset+=1000) {
          const result = await queryForRange(offset,offset+999);
          if (result.error) return {data:null,error:result.error};
          const page = (result.data || []) as T[];
          rows.push(...page);
          if (page.length<1000) break;
        }
        return {data:rows,error:null};
      };
      const fetchAttendancePages = async () => {
        const rows: Attendance[] = [];
        for (let offset = 0; offset < 100000; offset += 1000) {
          const result = await supabase!.rpc('get_admin_attendance_with_gps', { p_limit: 1000, p_offset: offset });
          if (result.error) return { data: null, error: result.error };
          const page = (result.data || []) as Attendance[];
          rows.push(...page);
          if (page.length < 1000) break;
        }
        return { data: rows, error: null };
      };
      const fetchSupervisorAttendancePages = async () => {
        const rows: Attendance[] = [];
        for (let offset = 0; offset < 100000; offset += 1000) {
          const result = await supabase!.rpc('get_supervisor_attendance', { p_limit: 1000, p_offset: offset });
          if (result.error) return { data: null, error: result.error };
          const page = (result.data || []) as Attendance[];
          rows.push(...page);
          if (page.length < 1000) break;
        }
        return { data: rows, error: null };
      };
      const fetchShiftPages = async () => {
        const rows: Shift[] = [];
        for (let offset = 0; offset < 100000; offset += 1000) {
          const result = await supabase!.from('shifts').select('id, employee_id, starts_at, ends_at').order('starts_at', { ascending: false }).range(offset, offset + 999);
          if (result.error) return { data: null, error: result.error };
          const page = (result.data || []) as Shift[];
          rows.push(...page);
          if (page.length < 1000) break;
        }
        return { data: rows, error: null };
      };
      const isAdmin = currentProfile?.active === true && String(currentProfile.role).toLowerCase() === 'admin';
      const isSupervisor = currentProfile?.active === true && String(currentProfile.role).toLowerCase() === 'supervisor';

      if (isAdmin || isSupervisor) {
        const peopleQuery = isAdmin
          ? fetchPagedRows<Profile>((from,to) => supabase!.from('profiles').select('id, email, full_name, role, active, telegram_user_id, telegram_verified_at, telegram_username').order('full_name', { ascending: true }).order('id',{ascending:true}).range(from,to))
          : supabase.rpc('get_supervisor_profiles');
        const [peopleResult, attendanceResult, assignmentsResult, shiftsResult, membersResult, responseMetricsResult] = await Promise.all([
          peopleQuery,
          isAdmin ? fetchAttendancePages() : fetchSupervisorAttendancePages(),
          fetchPagedRows<ManagerAssignment>((from,to) => supabase!.from('manager_employee_assignments')
            .select('manager_id, employee_id').order('manager_id',{ascending:true}).order('employee_id',{ascending:true}).range(from,to)),
          fetchShiftPages(),
          isAdmin
            ? fetchPagedRows<{telegram_user_id:number;profile_id:string|null;username?:string|null;display_name?:string|null}>((from,to) => supabase!.from('telegram_group_members')
                .select('telegram_user_id, profile_id, username, display_name')
                .not('profile_id', 'is', null).order('profile_id',{ascending:true}).order('telegram_user_id',{ascending:true}).range(from,to))
            : Promise.resolve({ data: [], error: null }),
          isAdmin
            ? fetchPagedRows<{question_user_id:number|null;first_reply_user_id:number|null;response_seconds:number|null;calculated_at:string|null}>((from,to) => supabase!.from('telegram_response_metrics')
                .select('question_user_id, first_reply_user_id, response_seconds, calculated_at')
                .order('calculated_at',{ascending:false}).range(from,to))
            : supabase.rpc('get_supervisor_telegram_metrics'),
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
        const groupTelegramMembers = (isAdmin ? (membersResult.data ?? []) : []) as Array<{telegram_user_id:number;profile_id:string|null;username?:string|null;display_name?:string|null}>;
        const verifiedProfileLinks = ((peopleResult.data ?? []) as Array<Profile & {telegram_user_id?:number|null;telegram_verified_at?:string|null}>)
          .filter(person => person.telegram_user_id != null && person.telegram_verified_at != null)
          .map(person => {
            const groupMember = groupTelegramMembers.find(member => member.profile_id === person.id && Number(member.telegram_user_id) === Number(person.telegram_user_id));
            return { telegram_user_id: Number(person.telegram_user_id), profile_id: person.id, username: groupMember?.username ?? person.telegram_username ?? null, display_name: groupMember?.display_name ?? person.full_name ?? null, verified_at: person.telegram_verified_at };
          });
        const verifiedKeys = new Set(verifiedProfileLinks.map(member => member.profile_id + ':' + member.telegram_user_id));
        setTelegramMembers([...groupTelegramMembers.filter(member => !verifiedKeys.has(member.profile_id + ':' + member.telegram_user_id)), ...verifiedProfileLinks]);
        setTelegramResponseMetrics((responseMetricsResult.data ?? []) as Array<{question_user_id:number|null;first_reply_user_id:number|null;response_seconds:number|null;calculated_at?:string|null;profile_id?:string;asked_count?:number;reply_count?:number;average_response_seconds?:number|null;response_samples?:Array<{response_seconds:number;calculated_at:string|null}>;question_samples?:Array<{calculated_at:string|null;answered:boolean}>}>);
      } else if (currentProfile?.active === true && ['manager', 'junior', 'middle', 'senior', 'team leader'].includes(String(currentProfile.role).toLowerCase().replaceAll('_', ' '))) {
        setTelegramMembers([]); setTelegramResponseMetrics([]);
        const [hierarchyResult, teamAttendanceResult, shiftsResult, ownAttendanceResult] = await Promise.all([
          supabase.rpc('get_my_team_hierarchy_with_telegram'),
          supabase.functions.invoke('manager-team-attendance', { body: {} }),
          supabase.from('shifts').select('id, starts_at, ends_at').eq('employee_id', userId).order('starts_at', { ascending: true }).limit(100),
          supabase.from('attendance').select('id, employee_id, check_in, check_out, work_date, work_timezone, credited_work_minutes, manual_adjustment_minutes, manual_original_credited_minutes, manual_adjusted_at, manual_check_in_changed, manual_check_out_changed, manually_adjusted, auto_closed').eq('employee_id', userId).order('check_in', { ascending: false }).limit(500),
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
        const ownRowsFromQuery = (ownAttendanceResult.data ?? []) as Attendance[];
        const ownRowsFromTeamFeed = (Array.isArray(teamAttendanceResult.data?.records)
          ? teamAttendanceResult.data.records as Attendance[]
          : []).filter(record => record.employee_id === userId);
        const ownRowsById = new Map([...ownRowsFromTeamFeed, ...ownRowsFromQuery].map(record => [record.id, record]));
        setSalaryAttendance([...ownRowsById.values()]);
        if (ownAttendanceResult.error && ownRowsById.size === 0) {
          setMessage(current => current || 'Your monthly attendance total could not be loaded. Please refresh the CRM. ' + ownAttendanceResult.error.message);
        }
        if (teamAttendanceResult.error) { setAttendance([]); setMessage(current => current || 'Could not load team attendance: ' + teamAttendanceResult.error.message); }
        else {
          // The team feed intentionally contains descendants, not necessarily the
          // manager's own attendance. Merge personal DB rows into the same source
          // used by Attendance Records so corrected IN/OUT values and (M) render.
          const teamRows = (Array.isArray(teamAttendanceResult.data?.records) ? teamAttendanceResult.data.records : []) as Attendance[];
          const mergedRowsById = new Map([...teamRows, ...ownRowsById.values()].map(record => [record.id, record]));
          setAttendance([...mergedRowsById.values()]);
          setShifts((Array.isArray(teamAttendanceResult.data?.shifts) ? teamAttendanceResult.data.shifts : []) as Shift[]);
          setTelegramMembers((Array.isArray(teamAttendanceResult.data?.telegram_members) ? teamAttendanceResult.data.telegram_members : []) as Array<{telegram_user_id:number;profile_id:string|null;username?:string|null;display_name?:string|null}>);
          setTelegramResponseMetrics((Array.isArray(teamAttendanceResult.data?.telegram_metrics) ? teamAttendanceResult.data.telegram_metrics : []) as Array<{question_user_id:number|null;first_reply_user_id:number|null;response_seconds:number|null;calculated_at?:string|null}>);
        }
        if (shiftsResult.error) setMessage(current => current || 'Could not load shifts: ' + shiftsResult.error.message);
        else setShifts(() => {
          const teamShifts = Array.isArray(teamAttendanceResult.data?.shifts) ? teamAttendanceResult.data.shifts as Shift[] : [];
          const ownShifts = ((shiftsResult.data ?? []) as Shift[]).map(shift => ({ ...shift, employee_id: userId }));
          const byId = new Map([...teamShifts, ...ownShifts].map(shift => [shift.id, shift]));
          return [...byId.values()];
        });
      } else {
        setProfiles([]);
        setManagerAssignments([]);
        setTelegramMembers([]); setTelegramResponseMetrics([]);
        setExpandedManagerIds(new Set());
        const [attendanceResult, shiftsResult] = await Promise.all([
          supabase.from('attendance').select('id, employee_id, check_in, check_out, work_date, work_timezone, credited_work_minutes, manual_adjustment_minutes, manual_original_credited_minutes, manual_adjusted_at, manually_adjusted, auto_closed').eq('employee_id', userId).order('check_in', { ascending: false }).limit(100),
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
      try {
        await supabase!.functions.invoke('auth-mfa-login', { body: { action: 'logout_notice', reason: 'inactivity_timeout' } });
      } catch { /* logout must proceed even if audit or Telegram delivery fails */ }
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
        body: { action: 'create_invited_account', invitation_token: inviteToken, registration_ticket: ticket, email_registration_ticket: emailTicket, password, registration_device_id: (()=>{try{return localStorage.getItem('mbp_crm_app_instance_id')}catch{return null}})() },
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
        if (error) {
          void supabase.functions.invoke('auth-security-events', {
            body: { action: 'failed_password', email: normalizedEmail },
          }).catch((auditError) => console.warn('Failed-password audit could not be submitted:', auditError));
        }
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

    const requesterId = session?.user?.id || profile?.id;
    if (!requesterId) throw new Error('Your login session is unavailable. Please sign in again.');
    const { data: queued, error: queueError } = await supabase!
      .from('telegram_inbox_search_requests')
      .insert({ requested_by: requesterId, query: username, purpose, status: 'pending' })
      .select('id')
      .single();
    if (queueError || !queued?.id) throw new Error('Could not start Telegram handler verification. Please try again.');

    const { data: refreshResult, error: refreshError } = await supabase!.functions.invoke('telegram-inbox-refresh', { body: { action: 'lookup_only' } });
    if (refreshError || !refreshResult?.ok) {
      const detail = refreshResult?.error || (refreshError ? await getFunctionRequestError(refreshError) : 'The lookup worker did not accept the request.');
      throw new Error('Could not start Telegram handler verification: ' + detail);
    }

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
      setMessage('');
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


  async function beginCheckInAttempt() {
    if (!supabase || !session || busy || loadingDashboard || attendanceActionInFlightRef.current) return;
    setMessage('');
    setShowCorrectionShortcut(false);
    setShowAttendanceLocationNotice(false);

    // Always verify against the database at click time. Manager dashboards load team
    // attendance separately, and their own completed shift may not be in that list.
    const { data: recentCompleted, error: recentCompletedError } = await supabase
      .from('attendance')
      .select('id, employee_id, check_in, check_out, work_date, work_timezone')
      .eq('employee_id', session.user.id)
      .not('check_out', 'is', null)
      .order('check_in', { ascending: false })
      .limit(30);

    if (recentCompletedError) {
      setMessage('Could not verify whether you have already checked out today. Please refresh the CRM and try again.');
      return;
    }

    const now = new Date();
    const completedToday = (recentCompleted ?? []).some(record => {
      if (!record.check_out) return false;
      try {
        const timezone = record.work_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const recordedWorkDate = record.work_date || getLocalDate(timezone, new Date(record.check_in));
        return recordedWorkDate === getLocalDate(timezone, now);
      } catch {
        return record.work_date === new Intl.DateTimeFormat('en-CA').format(now);
      }
    });

    if (completedToday) {
      setMessage('You have already checked out for today. If this was a mistake, please submit a request to correct your shift time.');
      setShowCorrectionShortcut(true);
      return;
    }

    // Managers start immediately. The browser/native geolocation API itself
    // requests permission only when it is needed; never add a CRM confirmation.
    if (normalizedRole === 'manager') {
      void handleCheckIn();
      return;
    }
    if (window.confirm('Do you want to check in?')) void handleCheckIn();
  }

  async function handleCheckIn() {
    if (!supabase || !session || attendanceActionInFlightRef.current) return;
    attendanceActionInFlightRef.current = true;
    if (todayCompletedRecord) {
      setMessage('You have already ended your shift today. To correct your recorded work hours, submit an Attendance Correction request.');
      setShowCorrectionShortcut(true);
      return;
    }
    setShowCorrectionShortcut(false);

    setBusy(true);
    setMessage('');

    try {
      let coords: Coordinates;

      try {
        coords = await getLocation();
      } catch (error) {
        setMessage(
          `Check-in could not be completed because location is unavailable. ${getErrorMessage(error)} Enable location access and try again.`
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
        if (/already ended your shift today/i.test(checkInError.message)) {
          setMessage('You have already ended your shift today. To correct your recorded work hours, submit an Attendance Correction request.');
          setShowCorrectionShortcut(true);
        } else setMessage(`Check-in failed: ${checkInError.message}`);
        return;
      }

      setMessage(`Check-in recorded successfully. Timezone: ${timezone}.`);
      await loadDashboard(session.user.id);
    } catch (error) {
      setMessage(`Unable to check in: ${getErrorMessage(error)}`);
    } finally {
      attendanceActionInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function handleCheckOut(attendanceId: string) {
    if (!supabase || !session || attendanceActionInFlightRef.current) return;
    attendanceActionInFlightRef.current = true;

    setBusy(true);
    setMessage('');
    setShowAttendanceLocationNotice(false);

    try {
      let coords: Coordinates;

      try {
        coords = await getLocation();
      } catch (error) {
        setMessage(
          `Check-out could not be completed because location is unavailable. ${getErrorMessage(error)}`
        );
        setShowAttendanceLocationNotice(true);
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

      // The RPC returns void, so confirm the database row is actually closed
      // before reporting success or refreshing the dashboard.
      const { data: closedRecord, error: verifyCheckoutError } = await supabase
        .from('attendance')
        .select('id, check_out')
        .eq('id', attendanceId)
        .eq('employee_id', session.user.id)
        .maybeSingle();
      if (verifyCheckoutError || !closedRecord?.check_out) {
        setMessage(verifyCheckoutError
          ? `Check-out was submitted, but its status could not be verified: ${verifyCheckoutError.message}. Refresh before trying again.`
          : 'Check-out was submitted, but the shift is still showing as active. Refresh the CRM before trying again.');
        return;
      }

      setMessage('Check-out recorded successfully.');
      // Refresh the employee's own salary ledger immediately after checkout so the
      // monthly progress bar reflects the newly completed session without a page reload.
      const { data: refreshedOwnAttendance, error: refreshOwnAttendanceError } = await supabase
        .from('attendance')
        .select('id, employee_id, check_in, check_out, work_date, work_timezone, credited_work_minutes, manual_adjustment_minutes, manual_original_credited_minutes, manual_adjusted_at, manual_check_in_changed, manual_check_out_changed, manually_adjusted, auto_closed')
        .eq('employee_id', session.user.id)
        .order('check_in', { ascending: false })
        .limit(500);
      if (!refreshOwnAttendanceError && refreshedOwnAttendance) {
        const refreshed = refreshedOwnAttendance as Attendance[];
        setSalaryAttendance(refreshed);
        setAttendance(current => {
          const byId = new Map([...current, ...refreshed].map(item => [item.id, item]));
          return [...byId.values()];
        });
      }
      setClockNow(Date.now());
      await loadDashboard(session.user.id);
    } catch (error) {
      setMessage(`Unable to check out: ${getErrorMessage(error)}`);
    } finally {
      attendanceActionInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function beginManagerCheckout(attendanceId: string) {
    if (!openRecord || openRecord.id !== attendanceId || busy || loadingDashboard || attendanceActionInFlightRef.current) return;
    const elapsed = Date.now() - new Date(openRecord.check_in).getTime();
    const earlyManagerCheckout = elapsed < 8.5 * 60 * 60 * 1000;
    if (earlyManagerCheckout && !window.confirm('Your total shift working hours are not complete. Do you still want to check out?')) return;
    await handleCheckOut(attendanceId);
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
      const elapsed = openRecord ? Date.now() - new Date(openRecord.check_in).getTime() : 0;
      const earlyManagerCheckout = isManagerRole && elapsed < 8.5 * 60 * 60 * 1000;
      if (normalizedRole === 'manager') {
        if (earlyManagerCheckout && window.confirm('Your total shift working hours are not complete. Do you still want to check out?')) {
          void handleCheckOut(attendanceId);
        } else if (!earlyManagerCheckout) {
          void handleCheckOut(attendanceId);
        }
        return;
      }
      const prompt = earlyManagerCheckout
        ? 'Your total shift working hours are not complete. Do you still want to check out?'
        : 'Do you want to check out?';
      if (window.confirm(prompt)) void handleCheckOut(attendanceId);
    }, 1200);
  }

  async function handleLogout() {
    if (!supabase) return;

    setMapPreview(null);
    setAttendance([]); setSalaryAttendance([]); setShifts([]); setProfiles([]); setManagerAssignments([]); setTelegramMembers([]); setTelegramResponseMetrics([]); setExpandedManagerIds(new Set()); setProfile(null); setPersonalProfile({user_id:'',avatar_key:'male-01',nickname:''}); setPersonalProfileDraft({avatar_key:'male-01',nickname:''}); setDirectManager(null);
    setReportStartDate(''); setReportEndDate(''); setDraftStartDate(''); setDraftEndDate('');
    setBusy(true);
    setMessage('');

    try {
      if (session?.user.id) {
        try { localStorage.removeItem(INACTIVITY_STORAGE_PREFIX + session.user.id); } catch { /* storage may be unavailable */ }
      }
      try {
        await supabase.functions.invoke('auth-mfa-login', { body: { action: 'logout_notice', reason: 'user_requested' } });
      } catch { /* logout must proceed even if audit or Telegram delivery fails */ }
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
    background: preferences.glassy ? 'transparent' : (preferences.theme === 'day' ? 'var(--crm-bg)' : '#0b0b0c'),
    color: preferences.theme === 'day' ? 'var(--crm-text)' : '#f7f7f5',
    fontFamily: 'Arial, Helvetica, sans-serif',
  };

  function handleExportCsv() {
    const rows = [
      ['Employee', 'Employee email', 'Work date', 'Check-in', 'Check-out', 'Status', 'Elapsed minutes', 'Worked minutes', 'Timezone', ...(canViewAdmin ? ['Check-in map', 'Check-out map'] : ['Check-in region', 'Check-in country', 'Check-out region', 'Check-out country'])],
      ...reportAttendance.map((item) => {
        const person = profiles.find((p) => p.id === item.employee_id);
        const start = new Date(item.check_in).getTime();
        const end = item.check_out ? new Date(item.check_out).getTime() : NaN;
        const elapsedMinutes = Number.isFinite(start) && Number.isFinite(end) && end >= start
          ? Math.floor((end - start) / 60000)
          : '';
        const workedMinutes = elapsedMinutes === '' ? '' : creditedMinutesForSession(item);
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
          ...(canViewAdmin ? [checkInMap, checkOutMap] : [item.check_in_region || '', item.check_in_country || '', item.check_out_region || '', item.check_out_country || '']),
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
    borderRadius: preferences.glassy ? 18 : 3,
    border: preferences.glassy
      ? (preferences.theme === 'day' ? '1px solid rgba(255,255,255,.66)' : '1px solid rgba(164,184,208,.24)')
      : '1px solid #34302c',
    background: preferences.glassy
      ? (preferences.theme === 'day' ? 'rgba(255,255,255,.34)' : 'rgba(17,22,32,.38)')
      : '#151413',
    boxShadow: preferences.glassy
      ? '0 18px 54px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.18)'
      : 'none',
    backdropFilter: preferences.glassy ? 'blur(22px) saturate(145%)' : 'none',
    WebkitBackdropFilter: preferences.glassy ? 'blur(22px) saturate(145%)' : 'none',
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
  const isSupervisor = profile?.active === true && normalizedRole === 'supervisor';
  const canViewAdmin = isAdmin || isSupervisor;
  const canManageTeam = profile?.active === true && ['manager', 'junior', 'middle', 'senior', 'team leader'].includes(normalizedRole);
  const canUseHumanTelegram = isAdmin || (profile?.active === true && normalizedRole === 'telemarketing' && humanTelegramAccess);

  // Keep admin navigation badges in sync with items that still need attention.
  useEffect(() => {
    if (!supabase || !isAdmin || screen !== 'signed-in' || !profileReady) {
      setNewRequestCount(0);
      setNewSecurityLogCount(0);
      return;
    }
    let cancelled = false;
    const refreshAdminBadges = async () => {
      const [requestResult, securityResult, locationResult, concurrentResult, authFailureResult, reviewResult] = await Promise.all([
        supabase!.rpc('get_telegram_id_change_requests'),
        supabase!.rpc('admin_security_risk_alerts'),
        supabase!.rpc('admin_location_risk_alerts'),
        supabase!.rpc('admin_concurrent_session_alerts'),
        supabase!.rpc('admin_auth_failure_alerts'),
        supabase!.from('security_alert_reviews').select('alert_key'),
      ]);
      if (cancelled) return;
      if (!requestResult.error) {
        const rows = Array.isArray(requestResult.data) ? requestResult.data as Array<{status?:string}> : [];
        setNewRequestCount(rows.filter(row => String(row.status || '').toLowerCase() === 'pending').length);
      }
      const alertErrors = [securityResult.error, locationResult.error, concurrentResult.error, authFailureResult.error, reviewResult.error];
      if (alertErrors.every(error => !error)) {
        const alerts = [...(securityResult.data || []), ...(locationResult.data || []), ...(concurrentResult.data || []), ...(authFailureResult.data || [])] as Array<{alert_key?:string}>;
        const uniqueAlerts = new Map<string, true>();
        alerts.forEach(alert => { if (alert.alert_key) uniqueAlerts.set(alert.alert_key, true); });
        const reviewedKeys = new Set((reviewResult.data || []).map(row => String(row.alert_key)));
        setNewSecurityLogCount([...uniqueAlerts.keys()].filter(key => !reviewedKeys.has(key)).length);
      }
    };
    void refreshAdminBadges();
    const timer = window.setInterval(() => { void refreshAdminBadges(); }, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [isAdmin, screen, profileReady, profile?.id]);

  // Keep the Workforce Operations badge current for managers and admins who can review requests.
  useEffect(() => {
    if (!supabase || screen !== 'signed-in' || !profileReady || !(isAdmin || canManageTeam)) {
      setPendingWorkforceCount(0);
      return;
    }
    let cancelled = false;
    const refreshWorkforceBadge = async () => {
      const [leaveResult, correctionResult] = await Promise.all([
        supabase!.from('workforce_leave_requests').select('id', { count: 'exact', head: true }).in('status', ['pending','pending_team_leader','pending_admin']),
        supabase!.from('attendance_correction_requests').select('id', { count: 'exact', head: true }).in('status', ['pending','pending_team_leader','pending_admin']),
      ]);
      if (cancelled) return;
      if (!leaveResult.error && !correctionResult.error) {
        setPendingWorkforceCount((leaveResult.count || 0) + (correctionResult.count || 0));
      }
    };
    void refreshWorkforceBadge();
    const timer = window.setInterval(() => { void refreshWorkforceBadge(); }, 30000);
    const onFocus = () => { void refreshWorkforceBadge(); };
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [isAdmin, canManageTeam, screen, profileReady, profile?.id]);

  const globalSearchPages: Array<{id:CrmPage;label:string;keywords:string;allowed:boolean}> = [
    {id:'dashboard',label:'Dashboard',keywords:'home overview statistics summary my work',allowed:true},
    {id:'attendance-records',label:'Attendance records',keywords:'attendance history check in check out times hours records',allowed:true},
    {id:'workforce-operations',label:'Workforce operations',keywords:'leave vacation absence attendance correction request follow up followup holiday',allowed:true},
    {id:'team-attendance',label:'Team attendance report',keywords:'team attendance report statistics lateness overtime shifts performance',allowed:canViewAdmin||canManageTeam},
    {id:'manager-hierarchy',label:'Manager hierarchy',keywords:'team tree reporting line subordinates employees hierarchy',allowed:isAdmin||isSupervisor||canManageTeam},
    {id:'team',label:'Team management',keywords:'team employees people staff',allowed:isAdmin||isSupervisor||canManageTeam},
    {id:'team-roles',label:'Employee role management',keywords:'roles permissions promote demote access',allowed:isAdmin},
    {id:'team-links',label:'Link Telegram members',keywords:'telegram link identity group user mapping',allowed:isAdmin},
    {id:'team-assignments',label:'Assign employees to managers',keywords:'manager assignment reporting line assign subordinate',allowed:isAdmin},
    {id:'team-invitations',label:isAdmin?'Admin invitation':'Employee invitations',keywords:'invite invitation add employee account',allowed:isAdmin||canManageTeam},
    {id:'telegram-human',label:'Corporate Telegram Inbox',keywords:'telegram inbox messages chat reply telemarketing',allowed:canUseHumanTelegram},
    {id:'telegram-analytics',label:'Telegram group analytics',keywords:'telegram group analytics response time messages activity',allowed:isAdmin||isSupervisor||canManageTeam},
    {id:'security',label:'Security & devices',keywords:'security device ip login audit suspicious activity',allowed:isAdmin},
    {id:'requests',label:'Requests',keywords:'telegram id change requests approvals',allowed:isAdmin},
    {id:'downloads',label:'Downloads',keywords:'android ios iphone windows macos app installer apk dmg',allowed:true},
    {id:'settings',label:'Settings',keywords:'preferences appearance theme timezone display',allowed:true},
  ];
  const normalizedGlobalSearch = globalSearchQuery.trim().toLowerCase();
  const globalSearchMatches = normalizedGlobalSearch ? globalSearchPages.filter(item=>item.allowed && (item.label+' '+item.keywords).toLowerCase().includes(normalizedGlobalSearch)).slice(0,8) : globalSearchPages.filter(item=>item.allowed).slice(0,6);
  const globalSearchPeople = normalizedGlobalSearch && (isAdmin||isSupervisor||canManageTeam)
    ? profiles.filter(person=>person.active && person.role.toLowerCase()!=='admin' && ((person.full_name||'')+' '+(person.email||'')+' '+person.role.replaceAll('_',' ')).toLowerCase().includes(normalizedGlobalSearch)).slice(0,8)
    : [];
  const openGlobalSearchPage = (page:CrmPage) => {
    setActivePage(page); setGlobalSearchOpen(false); setGlobalSearchQuery('');
    setAttendanceMenuOpen(page==='attendance-records'||page==='workforce-operations'||page==='team-attendance');
    setTeamMenuOpen(['team','manager-hierarchy','team-roles','team-links','team-assignments','team-invitations'].includes(page));
    setTelegramMenuOpen(page==='telegram-human'||page==='telegram-analytics');
    setMobileMoreOpen(false); setMapPreview(null); window.scrollTo(0,0);
  };

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
  const selectedAttendance = canViewAdmin && selectedEmployeeId !== 'all'
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
  const salaryEmployeeId = profile?.id || session?.user.id;
  for (let day = new Date(salaryMonthStart); day <= salaryMonthEnd; day.setDate(day.getDate() + 1)) {
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const key = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
    const holiday = workforceHolidays.some(item => item.holiday_date === key);
    const onApprovedLeave = approvedLeave.some(item => item.employee_id === salaryEmployeeId && item.start_date <= key && item.end_date >= key);
    if (!holiday && !onApprovedLeave) salaryWeekdays += 1;
  }
  const salaryRequiredMilliseconds = salaryWeekdays * DAILY_REQUIRED_WORK_MINUTES * 60000;
  const salaryMonthPrefix = `${salaryMonthStart.getFullYear()}-${String(salaryMonthStart.getMonth() + 1).padStart(2, '0')}`;
  const salaryAttendanceById = new Map(
    [...salaryAttendance, ...attendance.filter(item => item.employee_id === session?.user.id)]
      .map(item => [item.id, item]),
  );
  const salaryAttendanceByDay = new Map<string, Attendance[]>();
  for (const item of salaryAttendanceById.values()) {
    const workDate = item.work_date ?? (item.work_timezone
      ? getLocalDate(item.work_timezone, new Date(item.check_in))
      : item.check_in.slice(0, 10));
    if (!workDate.startsWith(salaryMonthPrefix)) continue;
    const dayRows = salaryAttendanceByDay.get(workDate) ?? [];
    dayRows.push(item);
    salaryAttendanceByDay.set(workDate, dayRows);
  }
  // A day with one or more manual corrections is represented by its latest
  // approved correction only. This replaces the previous daily correction
  // instead of adding another session's credited minutes to it.
  const salaryEffectiveAttendanceByDay = [...salaryAttendanceByDay.values()].map(dayRows => {
    const correctedRows = dayRows
      .filter(item => item.manually_adjusted === true || Number(item.manual_adjustment_minutes ?? 0) !== 0)
      .sort((a, b) => (b.manual_adjusted_at ?? b.check_in).localeCompare(a.manual_adjusted_at ?? a.check_in));
    return correctedRows.length ? [correctedRows[0]] : dayRows;
  });
  const salaryWorkedMilliseconds = salaryEffectiveAttendanceByDay.reduce(
    (total, dayRows) => total + dayRows.reduce((dayTotal, item) => dayTotal + creditedMinutesForSession(item) * 60000, 0),
    0,
  );
  const salaryManualAdjustmentMinutes = salaryEffectiveAttendanceByDay.reduce(
    (total, dayRows) => total + dayRows.reduce((dayTotal, item) => dayTotal + (item.manual_adjustment_minutes ?? 0), 0),
    0,
  );
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
  // Manager dashboard attendance is populated from the team RPC and may omit the manager's own row.
  // salaryAttendance is loaded from the manager's own attendance query, so check both sources.
  const todayCompletedRecord = [...attendance, ...salaryAttendance]
    .filter(item => {
      if (item.employee_id !== session?.user.id || !item.check_out || !item.work_date || !item.work_timezone) return false;
      try { return getLocalDate(item.work_timezone, new Date(clockNow)) === item.work_date; } catch { return false; }
    })
    .sort((a,b) => b.check_out!.localeCompare(a.check_out!))[0];
  const isManagerRole = ['manager','junior','middle','senior','team leader'].includes(normalizedRole);

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
    <main className={(screen === 'loading' || screen === 'login' || screen === 'set-password') ? 'auth-screen-root' : undefined} style={pageStyle}>
      <style>{`@media (max-width: 760px) { .crm-layout { display:block !important; } .crm-sidebar { position:relative !important; top:auto !important; min-height:0 !important; width:100% !important; margin:0 !important; padding:7px 8px !important; overflow:visible !important; } .crm-sidebar nav { flex-direction:row !important; flex-wrap:wrap !important; gap:4px !important; overflow:visible !important; position:relative !important; z-index:50; } .crm-sidebar nav button { width:auto !important; flex:0 0 auto !important; min-width:44px; justify-content:flex-start !important; padding:9px !important; gap:6px !important; font-size:12px !important; } .crm-sidebar nav button svg { flex-shrink:0; } .crm-menu-label { display:inline !important; white-space:nowrap; } .crm-sidebar > button[title="Sign out"] { width:auto !important; min-height:38px !important; padding:7px 9px !important; margin-top:4px !important; position:relative; z-index:1; } .crm-sidebar > div:first-child { margin-bottom:5px !important; } .crm-sidebar nav > div { position:relative !important; flex:0 0 auto; } .crm-sidebar nav > div > div { position:absolute !important; z-index:1000 !important; left:0 !important; right:auto !important; top:100% !important; min-width:min(290px, calc(100vw - 24px)); max-height:60vh; overflow-y:auto; display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)); gap:3px !important; margin:0 !important; padding:8px !important; border:1px solid var(--crm-border) !important; border-radius:0 0 7px 7px; background:var(--crm-panel-bg) !important; color:var(--crm-text) !important; box-shadow:0 8px 20px rgba(0,0,0,.22); } .crm-sidebar nav > div > div button { width:100% !important; min-width:0 !important; min-height:42px; padding:8px !important; justify-content:flex-start !important; font-size:12px !important; text-align:left; white-space:normal; overflow-wrap:anywhere; } .crm-sidebar > div:last-child { display:none; } .crm-layout > main { width:100%; padding:0 !important; min-width:0; } .crm-layout > main > section { margin:0 !important; width:100%; max-width:none !important; padding:8px !important; border:0 !important; border-radius:0 !important; box-shadow:none !important; } .crm-layout > :not(.crm-sidebar) { min-width:0; } .crm-layout table { max-width:100%; } } @media (max-width: 480px) { main { padding:0 !important; } .crm-layout { gap:0 !important; } .crm-layout section { padding:8px !important; } .crm-layout input[type=date] { font-size:16px; min-height:44px; } }`}</style>
      {(screen === 'loading' || screen === 'login' || screen === 'set-password') && <AuthVectorScene />}
      <style>{`
        .install-guide-flow{animation:installGuideFlow 2.4s ease-in-out infinite;stroke-dasharray:4 5}.auth-screen-root{position:relative;isolation:isolate;overflow-x:hidden}
        .auth-screen-root>.auth-vector-scene{position:fixed;inset:74px 0 0;z-index:0;pointer-events:none;display:grid;place-items:center;overflow:hidden;opacity:.9}
        .auth-vector-art{width:min(100%,1100px);height:auto;max-height:calc(100vh - 90px);overflow:visible}
        :root[data-crm-theme="day"]{
          --auth-rocket-light:#FFF4E7;--auth-rocket-mid:#E9A06A;--auth-rocket-dark:#B85F36;--auth-rocket-outline:#985332;
          --auth-nose-highlight:#FFF9F0;--auth-window-rim:#F7E6D5;--auth-flame-light:#FFE6B6;--auth-flame-dark:#E77A42;--auth-flame-core:#FFF7D8;
          --auth-beacon-shell:#E8A16E;--auth-beacon-outline:#A85E3A;--auth-beacon-base:#936044;--auth-beacon-light:#FFE3B5;--auth-beacon-ray:#C47B4F;
          --auth-debris-fill:#C98A62;--auth-debris-stroke:#A66B49;--auth-star-color:#D58B5B;--auth-star-cool:#78AFCF;--auth-shooting-core:#FFF8EA;--auth-shooting-trail:#D18B5B;--auth-orbit-line:#C8895E;
        }
        :root[data-crm-theme="night"]{
          --auth-rocket-light:#EAF6FF;--auth-rocket-mid:#82B5D4;--auth-rocket-dark:#426E8C;--auth-rocket-outline:#355B78;
          --auth-nose-highlight:#F5FBFF;--auth-window-rim:#D7EAF5;--auth-flame-light:#BDEAFF;--auth-flame-dark:#4B9BC5;--auth-flame-core:#E8F8FF;
          --auth-beacon-shell:#719FBE;--auth-beacon-outline:#426F91;--auth-beacon-base:#345B78;--auth-beacon-light:#C9ECFF;--auth-beacon-ray:#77B6DB;
          --auth-debris-fill:#729DB9;--auth-debris-stroke:#A2C9E1;--auth-star-color:#D8EAF6;--auth-star-cool:#80BBDD;--auth-shooting-core:#F2FBFF;--auth-shooting-trail:#79B9DB;--auth-orbit-line:#76A9C9;
        }
        .auth-rocket{animation:authRocketFloat 7s ease-in-out infinite;transform-origin:185px 360px}
        .auth-debris{transform-box:fill-box;transform-origin:center;animation:authDebrisDrift 17s ease-in-out infinite}
        .auth-debris-b{animation-duration:22s;animation-delay:-8s}.auth-debris-c{animation-duration:25s;animation-delay:-13s}.auth-debris-d{animation-duration:20s;animation-delay:-5s}
        .auth-beacon{animation:authBeaconFloat 8s ease-in-out infinite}
        .auth-beacon-pulse{transform-box:fill-box;transform-origin:center;animation:authBeaconPulse 3.6s ease-out infinite}
        .auth-shooting-star{opacity:0;animation:authLoginShootingStar 13s ease-in-out infinite}
        .auth-shooting-star-b{animation-delay:6.5s}
        .auth-star{transform-box:fill-box;transform-origin:center;animation:authTwinkle 3.8s ease-in-out infinite}
        @keyframes authRocketFloat{0%,100%{translate:0 0;rotate:0deg}50%{translate:0 -8px;rotate:1.2deg}}
        @keyframes authDebrisDrift{0%,100%{translate:0 0;rotate:0deg;opacity:.5}50%{translate:16px -14px;rotate:22deg;opacity:.9}}
        @keyframes authBeaconFloat{0%,100%{translate:0 0}50%{translate:0 -6px}}
        @keyframes authBeaconPulse{0%{scale:.72;opacity:.65}75%,100%{scale:1.9;opacity:0}}
        @keyframes authLoginShootingStar{0%,66%,100%{opacity:0;translate:0 0}69%{opacity:.85}76%{opacity:0;translate:-95px 48px}}
                .auth-rocket{transform-box:fill-box;transform-origin:center;animation:authRocketFloat 6s ease-in-out infinite}
        .auth-star{transform-box:fill-box;transform-origin:center;animation:authTwinkle 3.8s ease-in-out infinite}
        .auth-star-two{animation-delay:-1.2s}.auth-star-three{animation-delay:-2.4s}
        .auth-vector-scene:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,var(--crm-bg,#101114) 0%,transparent 25%,transparent 75%,var(--crm-bg,#101114) 100%);opacity:.38}
        .auth-loading-stage{position:relative;z-index:1;display:grid;place-items:center;min-height:clamp(220px,42vh,390px);margin:10px auto 28px;padding:18px 12px;background:transparent;border:0;box-shadow:none}
        .vector-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:150px;padding:0;background:transparent;border:0;box-shadow:none;color:var(--crm-muted,#98a2b3);font-size:13px;letter-spacing:.04em;text-align:center}
        .vector-loader svg{width:136px;height:102px;overflow:visible;filter:drop-shadow(0 0 16px color-mix(in srgb,var(--crm-accent,#d9874e) 25%,transparent))}
        .loader-rocket{transform-box:fill-box;transform-origin:center;animation:loaderOrbit 2.8s ease-in-out infinite}
        .loader-orbit{animation:loaderSpin 9s linear infinite;transform-origin:60px 45px}
        .loader-dot{animation:loaderPulse 1.8s ease-in-out infinite}
        .auth-login-panel{position:relative;z-index:2;width:min(460px,calc(100% - 32px))!important;margin:clamp(18px,4vh,42px) auto 28px!important;padding:clamp(20px,3.5vw,32px)!important;backdrop-filter:blur(7px) saturate(125%);-webkit-backdrop-filter:blur(7px) saturate(125%);background:color-mix(in srgb,var(--crm-panel-bg,#17191f) 48%,transparent)!important;border:1px solid color-mix(in srgb,var(--crm-accent,#d9874e) 38%,var(--crm-border,#343944))!important;border-radius:18px!important;box-shadow:0 18px 60px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.08)!important}
        .auth-login-panel h1{letter-spacing:-.045em;font-size:clamp(25px,3vw,32px);margin:0 0 14px}
        .auth-login-panel form{position:relative;z-index:1}
        .auth-login-panel input{background:color-mix(in srgb,var(--crm-bg,#101114) 62%,transparent)!important;border-color:color-mix(in srgb,var(--crm-vector-cool,#9dbbd0) 34%,var(--crm-border,#343944))!important;border-radius:10px!important}
        .auth-login-panel button[type="submit"]{border-radius:10px!important;box-shadow:0 7px 22px color-mix(in srgb,var(--crm-accent,#d9874e) 22%,transparent)}
        .auth-login-panel label{font-size:13px;letter-spacing:.01em}
        .auth-login-panel p{line-height:1.55}
        @keyframes installGuideFlow{0%,100%{opacity:.45;translate:0 0}50%{opacity:1;translate:5px 0}}\n        @keyframes authRocketFloat{0%,100%{translate:0 0;rotate:0deg}50%{translate:0 -9px;rotate:1.5deg}}
        @keyframes authCelestialFloat{0%,100%{translate:0 0}50%{translate:0 -7px}}
        @keyframes authTwinkle{0%,100%{opacity:.38;scale:.94}50%{opacity:.9;scale:1.04}}
        @keyframes loaderOrbit{0%,100%{translate:0 0;rotate:-5deg}50%{translate:0 -5px;rotate:5deg}}
        @keyframes loaderSpin{to{rotate:360deg}}
        @keyframes loaderPulse{0%,100%{opacity:.35;scale:.7}50%{opacity:1;scale:1.2}}
        @media(max-width:700px){.auth-vector-scene{inset:56px -8% 0;place-items:start center;opacity:.9}.auth-vector-art{width:175%;max-width:none;max-height:none;height:auto;transform:translateY(1vh)}.auth-planet-orange,.auth-moon-night{transform-origin:900px 265px}.auth-vector-scene:after{background:linear-gradient(180deg,var(--crm-bg,#101114) 0%,transparent 10%,transparent 88%,var(--crm-bg,#101114) 100%);opacity:.08}.auth-login-panel{width:min(460px,calc(100% - 24px))!important;margin:clamp(18px,4vh,32px) auto 24px!important;padding:20px 18px!important;background:color-mix(in srgb,var(--crm-panel-bg,#17191f) 25%,transparent)!important;backdrop-filter:blur(4px) saturate(125%);-webkit-backdrop-filter:blur(4px) saturate(125%);border-radius:16px!important}.auth-loading-stage{min-height:38vh;margin:0 auto 16px}.auth-permission-loading{min-height:clamp(220px,55vh,420px);margin:0 auto;padding:20px 12px}.vector-loader svg{width:124px;height:94px}}
        @media(max-width:390px){.auth-vector-art{width:195%;transform:translateY(3vh)}.auth-login-panel{margin-top:18px!important;padding:18px 14px!important}.auth-vector-scene{inset:52px -12% 0}}
        @media(prefers-reduced-motion:reduce){.auth-rocket,.auth-star,.auth-debris,.auth-beacon,.auth-beacon-pulse,.auth-shooting-star,.loader-rocket,.loader-orbit,.loader-dot{animation:none!important}.auth-vector-scene{opacity:.35}}
.crm-reduced-motion .auth-rocket,.crm-reduced-motion .auth-star,.crm-reduced-motion .auth-debris,.crm-reduced-motion .auth-beacon,.crm-reduced-motion .auth-beacon-pulse,.crm-reduced-motion .auth-shooting-star,.crm-reduced-motion .loader-rocket,.crm-reduced-motion .loader-orbit,.crm-reduced-motion .loader-dot{animation:none!important}
        /* Restrained, corporate space ambience: decorative layers never intercept or cover CRM content. */
        .crm-layout{position:relative;isolation:isolate;background:transparent}
        .crm-layout>.crm-sidebar,.crm-layout>main{position:relative;z-index:1}
        .crm-ambient-backdrop{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;opacity:.72}
        .crm-ambient-backdrop svg{position:absolute;inset:0;width:100%;height:100%;opacity:.72}
        .crm-ambient-grain{position:absolute;inset:0;opacity:.035;background-image:radial-gradient(rgba(160,180,205,.8) .55px,transparent .7px);background-size:5px 5px;mask-image:linear-gradient(135deg,transparent 8%,#000 48%,transparent 92%)}
        .crm-shooting-star{opacity:0;transform-box:fill-box;transform-origin:center;animation:crmShootingStar 18s linear infinite}
        .crm-shooting-star-a{animation-delay:2s}.crm-shooting-star-b{animation-delay:8.5s}.crm-shooting-star-c{animation-delay:14s}
        @keyframes crmShootingStar{0%,72%,100%{opacity:0;translate:0 0;scale:.72}74%{opacity:.72}79%{opacity:0;translate:-210px 70px;scale:1}}
        .auth-world-amber{display:block}.auth-world-lunar{display:none}
        :root[data-crm-theme="night"] .auth-world-amber{display:none}
        :root[data-crm-theme="night"] .auth-world-lunar{display:block}
        .auth-satellite-orbit{transform-origin:275px 210px;animation:authSatelliteDrift 38s ease-in-out infinite}
        .auth-rocket-flight{transform-origin:450px 500px;animation:authRocketCruise 24s ease-in-out infinite}
        .auth-debris{transform-box:fill-box;transform-origin:center;animation:authDebrisDrift 19s ease-in-out infinite}
        .auth-debris-b{animation-delay:-7s;animation-duration:23s}.auth-debris-c{animation-delay:-12s;animation-duration:27s}
        .auth-star{animation:authStarPulse 6s ease-in-out infinite}
        @keyframes authSatelliteDrift{0%,100%{translate:0 0;rotate:-2deg}50%{translate:24px -12px;rotate:3deg}}
        @keyframes authRocketCruise{0%,100%{translate:0 0;rotate:0deg}50%{translate:12px -18px;rotate:1.5deg}}
        @keyframes authDebrisDrift{0%,100%{translate:0 0;rotate:0deg;opacity:.55}50%{translate:14px -18px;rotate:24deg;opacity:.9}}
        @keyframes authStarPulse{0%,100%{opacity:.25;scale:.82}50%{opacity:.9;scale:1.12}}
        @media(max-width:700px){.auth-vector-art{width:175%;transform:translate(-9%,2vh)}.auth-rocket-flight{opacity:.55}.auth-satellite-orbit{opacity:.7}}
        @media(prefers-reduced-motion:reduce){.auth-satellite-orbit,.auth-rocket-flight,.auth-debris,.auth-star{animation:none!important}}
        .crm-reduced-motion .auth-satellite-orbit,.crm-reduced-motion .auth-rocket-flight,.crm-reduced-motion .auth-debris,.crm-reduced-motion .auth-star{animation:none!important}
        /* Keep the complete decorative scene behind every login heading, notice and form. */
        .auth-screen-root{position:relative!important;isolation:isolate!important;z-index:0}
        .auth-screen-root>.auth-vector-scene{z-index:-1!important;opacity:.62!important;pointer-events:none!important}
        .auth-screen-root>.auth-vector-scene .auth-vector-art{pointer-events:none!important;position:relative;z-index:0!important}
        .auth-screen-root>.auth-vector-scene:after{z-index:0;pointer-events:none}
        .auth-screen-root>*:not(.auth-vector-scene):not(style){position:relative;z-index:1}
        .auth-login-panel{z-index:2!important;position:relative}
        .crm-brand-header{z-index:3!important}
        .auth-login-panel form,.auth-login-panel h1,.auth-login-panel p,.auth-login-panel label{position:relative;z-index:2}
        @media(max-width:700px){
          .auth-vector-scene{z-index:0;opacity:.58;inset:56px 0 0}
          .auth-vector-art{width:155%;max-width:none;transform:translate(-2%,7vh)}
          .auth-rocket{opacity:.5}
          .auth-debris{opacity:.45}
          .auth-shooting-star{opacity:0}

          .auth-rocket{opacity:.34}
          .auth-login-panel{z-index:3!important}
          .crm-ambient-backdrop{opacity:.46}
          .crm-ambient-backdrop svg{width:150%;left:-22%;opacity:.7}
        }
        @media(max-width:390px){
          .auth-vector-art{width:148%;transform:translate(-1%,9vh)}
          .auth-rocket{opacity:.38}
          .auth-beacon{opacity:.62}

          .auth-rocket{opacity:.25}
        }
        @media(prefers-reduced-motion:reduce){
          .crm-shooting-star,.auth-rocket{animation:none!important}
          .crm-ambient-backdrop{opacity:.3}
        }
        .crm-reduced-motion .crm-shooting-star,.crm-reduced-motion .auth-rocket{animation:none!important}
        /* Glass appearance is opt-in from Settings and layers over either base theme. */
        /* Keep the canvas visible behind the translucent CRM surfaces. */
        .crm-glassy [style*="background: rgb(21, 20, 19)"],
        .crm-glassy [style*="background: rgb(21,20,19)"]{background:rgba(17,22,32,.38)!important}
        .crm-glassy .crm-layout{background:transparent!important}
        .crm-glassy .crm-layout main{background:transparent!important}
        .crm-glassy .crm-layout main > section{background:rgba(17,22,32,.38)!important;backdrop-filter:blur(22px) saturate(145%)!important;-webkit-backdrop-filter:blur(22px) saturate(145%)!important}
        :root[data-crm-theme="day"].crm-glassy .crm-layout main > section{background:rgba(255,255,255,.34)!important}
        .crm-glassy .crm-layout main > section,
        .crm-glassy .crm-layout main > div > section{
          background:color-mix(in srgb,var(--crm-panel-bg,#17191f) 68%,transparent)!important;
          border:1px solid color-mix(in srgb,var(--crm-border,#343944) 70%,var(--crm-accent,#d9874e) 30%)!important;
          border-radius:16px!important;
          box-shadow:0 12px 34px rgba(0,0,0,.10),inset 0 1px 0 rgba(255,255,255,.07)!important;
          backdrop-filter:blur(16px) saturate(130%);
          -webkit-backdrop-filter:blur(16px) saturate(130%);
        }
        .crm-glassy .crm-layout :is(.crm-settings-section,.crm-settings-choice,article,[class*="card"]){
          background:color-mix(in srgb,var(--crm-panel-bg,#17191f) 70%,transparent)!important;
          border:1px solid color-mix(in srgb,var(--crm-border,#343944) 75%,transparent)!important;
          border-radius:13px!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 7px 22px rgba(0,0,0,.06);
          backdrop-filter:blur(12px) saturate(125%);
          -webkit-backdrop-filter:blur(12px) saturate(125%);
        }
        .crm-glassy .crm-sidebar{
          background:color-mix(in srgb,var(--crm-sidebar-bg,#101114) 72%,transparent)!important;
          backdrop-filter:blur(20px) saturate(140%);
          -webkit-backdrop-filter:blur(20px) saturate(140%);
          box-shadow:8px 0 30px rgba(0,0,0,.08);
        }
        .crm-glassy .crm-layout :is(input,select,textarea){
          background:color-mix(in srgb,var(--crm-panel-bg,#17191f) 68%,transparent)!important;
          border-color:color-mix(in srgb,var(--crm-border,#343944) 75%,var(--crm-accent,#d9874e) 25%)!important;
          backdrop-filter:blur(8px);
        }
        .crm-glassy .crm-layout button{transition:background .18s ease,border-color .18s ease,box-shadow .18s ease}
        :root[data-crm-theme="day"].crm-glassy .crm-layout main > section,
        :root[data-crm-theme="day"].crm-glassy .crm-layout main > div > section{
          background:rgba(255,255,255,.66)!important;
          border-color:rgba(177,193,216,.68)!important;
          box-shadow:0 12px 32px rgba(36,55,84,.08),inset 0 1px 0 rgba(255,255,255,.9)!important;
        }
        :root[data-crm-theme="day"].crm-glassy .crm-layout :is(.crm-settings-section,.crm-settings-choice,article,[class*="card"]){
          background:rgba(255,255,255,.56)!important;
          border-color:rgba(177,193,216,.55)!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 6px 20px rgba(36,55,84,.045);
        }
        :root[data-crm-theme="day"].crm-glassy .crm-sidebar{
          background:rgba(248,250,255,.72)!important;
          border-color:rgba(177,193,216,.7)!important;
        }
        :root[data-crm-theme="night"].crm-glassy .crm-layout main > section,
        :root[data-crm-theme="night"].crm-glassy .crm-layout main > div > section{
          background:rgba(19,22,31,.70)!important;
          border-color:rgba(116,132,158,.32)!important;
        }
        :root[data-crm-theme="night"].crm-glassy .crm-layout :is(.crm-settings-section,.crm-settings-choice,article,[class*="card"]){
          background:rgba(27,30,41,.62)!important;
          border-color:rgba(116,132,158,.24)!important;
        }
        @media(max-width:760px){
          .crm-glassy .crm-layout main > section,
          .crm-glassy .crm-layout main > div > section{border-radius:13px!important;backdrop-filter:blur(12px) saturate(125%)}
          .crm-glassy .crm-sidebar{backdrop-filter:blur(16px) saturate(130%)}
        }
        .auth-permission-loading{min-height:clamp(240px,52vh,440px);margin:0 auto 24px;padding:24px 12px;background:transparent!important;border:0!important;border-radius:0!important;box-shadow:none!important;backdrop-filter:none!important}
        .auth-permission-loading .vector-loader{background:transparent!important;border:0!important;box-shadow:none!important}
        .auth-vector-art{filter:drop-shadow(0 18px 44px rgba(0,0,0,.12))}
        .auth-login-panel{background:color-mix(in srgb,var(--crm-panel-bg,#17191f) 28%,transparent)!important;backdrop-filter:blur(5px) saturate(130%);-webkit-backdrop-filter:blur(5px) saturate(130%)}
        :root[data-crm-theme="day"] .auth-login-panel{background:rgba(255,255,255,.42)!important;border-color:rgba(255,255,255,.68)!important;box-shadow:0 18px 54px rgba(35,50,76,.13),inset 0 1px 0 rgba(255,255,255,.9)!important}
        :root[data-crm-theme="night"] .auth-login-panel{background:rgba(17,19,27,.36)!important;border-color:rgba(255,255,255,.15)!important}
        :root[data-crm-theme="day"] .auth-login-panel{color:#172337!important}
        :root[data-crm-theme="day"] .auth-login-panel h1,
        :root[data-crm-theme="day"] .auth-login-panel label,
        :root[data-crm-theme="day"] .auth-login-panel p,
        :root[data-crm-theme="day"] .auth-login-panel strong,
        :root[data-crm-theme="day"] .auth-login-panel span{color:#172337!important}
        :root[data-crm-theme="day"] .auth-login-panel input{background:rgba(255,255,255,.88)!important;color:#172337!important;border-color:rgba(87,107,134,.42)!important}
        :root[data-crm-theme="day"] .auth-login-panel input::placeholder{color:#64748b!important}
        :root[data-crm-theme="day"] .auth-login-panel p[style*="color"]{color:#34465d!important}

        @media(max-width:760px){
          .crm-layout > main > section{border-radius:0!important;backdrop-filter:blur(12px) saturate(120%)}
          .crm-sidebar{backdrop-filter:blur(16px) saturate(125%)}
          .crm-layout :is(article,.crm-settings-section,.crm-settings-choice,[class*="card"]){border-radius:10px}
        }
        @media(max-width:380px){
          .auth-login-panel{padding:18px 14px!important}
          .auth-login-panel h1{font-size:24px!important}
          .auth-vector-scene{inset:56px -18% 0}
          .auth-vector-art{width:155%;transform:translateX(5%)}
        }

        :root[data-crm-theme="day"] .telegram-group-messages-surface{background-color:rgba(247,250,254,.78)!important;background-image:radial-gradient(rgba(106,130,158,.18) .7px,transparent .7px)!important;border-color:rgba(150,169,192,.42)!important}
        :root[data-crm-theme="day"] .telegram-group-message-card{background:rgba(255,255,255,.92)!important;color:#1d2c40!important;border-color:rgba(146,166,190,.48)!important;box-shadow:0 2px 8px rgba(36,55,84,.06)!important}
        :root[data-crm-theme="day"] .telegram-group-message-card .telegram-group-message-author{color:#356d98!important}
        :root[data-crm-theme="day"] .telegram-group-message-card .telegram-group-message-body{color:#26374b!important}
        :root[data-crm-theme="day"] .telegram-group-message-card :is(label,select){color:#34465d!important}
        :root[data-crm-theme="day"] .telegram-group-message-card select{background:#fff!important;border-color:#bdcadd!important}
        :root[data-crm-theme="day"] .telegram-group-message-card button{color:#24425f}
        :root[data-crm-theme="day"] .telegram-group-message-card > div[style*="borderTop"]{border-color:#cbd5e1!important;color:#334155!important}
        :root[data-crm-theme="day"] .telegram-group-message-card > div[style*="borderTop"] div{color:#356d98!important}
        :root[data-crm-theme="night"] .telegram-group-messages-surface{background-color:rgba(13,19,29,.45)!important}
        :root[data-crm-theme="night"] .telegram-group-message-card{background:rgba(27,43,64,.94)!important;color:#edf4ff!important}

        /* High-contrast Telegram group messages, tuned to the active CRM theme. */
        :root[data-crm-theme="day"] .telegram-group-messages-surface{
          background-color:rgba(239,245,252,.92)!important;
          background-image:radial-gradient(rgba(75,105,140,.16) .7px,transparent .7px)!important;
          border-color:#c5d3e3!important;
        }
        :root[data-crm-theme="day"] .telegram-group-message-card{
          background:rgba(255,255,255,.98)!important;color:#172b43!important;
          border-color:#c3d3e5!important;box-shadow:0 2px 9px rgba(27,52,82,.09)!important;
        }
        :root[data-crm-theme="day"] .telegram-group-message-card .telegram-group-message-author{color:#155b91!important}
        :root[data-crm-theme="day"] .telegram-group-message-card .telegram-group-message-body{color:#172b43!important}
        :root[data-crm-theme="day"] .telegram-group-message-card :is(label,select){color:#263d58!important}
        :root[data-crm-theme="day"] .telegram-group-message-card select{background:#fff!important;color:#172b43!important;border-color:#aebfd3!important}
        :root[data-crm-theme="day"] .telegram-group-message-card select option{background:#fff;color:#172b43}
        :root[data-crm-theme="day"] .telegram-group-message-card button{color:#174b78!important}
        :root[data-crm-theme="day"] .telegram-group-message-card > div[style*="borderTop"]{border-color:#c4d2e2!important;color:#203a56!important}
        :root[data-crm-theme="day"] .telegram-group-message-card > div[style*="borderTop"] div{color:#155b91!important}
        :root[data-crm-theme="day"] .telegram-group-message-card > div[style*="borderTop"] + div{color:#263d58!important}
        :root[data-crm-theme="day"] .telegram-group-message-card [style*="background:#132033"]{background:#f0f5fb!important;border-color:#c7d5e4!important;color:#20364f!important}
        :root[data-crm-theme="day"] .telegram-group-message-card [style*="#9aaec5"]{color:#536a83!important}
        :root[data-crm-theme="day"] .telegram-group-message-card [style*="background:#2a3d55"]{background:#e7f0fa!important;border-color:#b8cce1!important;color:#24425f!important}
        :root[data-crm-theme="day"] .telegram-group-message-card [style*="textAlign:right"]{color:#52677f!important}
        :root[data-crm-theme="night"] .telegram-group-messages-surface{
          background-color:rgba(10,18,31,.72)!important;
          background-image:radial-gradient(rgba(126,165,210,.13) .7px,transparent .7px)!important;
          border-color:rgba(130,157,190,.3)!important;
        }
        :root[data-crm-theme="night"] .telegram-group-message-card{
          background:rgba(24,39,59,.96)!important;color:#f4f7fc!important;
          border-color:#3b5573!important;box-shadow:0 2px 10px rgba(0,0,0,.22)!important;
        }
        :root[data-crm-theme="night"] .telegram-group-message-card .telegram-group-message-author{color:#8fcaff!important}
        :root[data-crm-theme="night"] .telegram-group-message-card .telegram-group-message-body{color:#f4f7fc!important}
        :root[data-crm-theme="night"] .telegram-group-message-card :is(label,select){color:#d5e4f5!important}
        :root[data-crm-theme="night"] .telegram-group-message-card select{background:#122238!important;color:#eaf3ff!important;border-color:#49627f!important}
        :root[data-crm-theme="night"] .telegram-group-message-card select option{background:#122238;color:#eaf3ff}
        :root[data-crm-theme="night"] .telegram-group-message-card > div[style*="borderTop"]{border-color:#49627f!important;color:#e2ecf8!important}
        :root[data-crm-theme="night"] .telegram-group-message-card > div[style*="borderTop"] div{color:#9bd2ff!important}

        @media(prefers-reduced-motion:reduce){.crm-layout *{scroll-behavior:auto!important;transition:none!important}}


        /* Keep the workspace-preparation loader completely unboxed while preserving its rocket animation. */
        .auth-loading-stage,
        .auth-loading-stage .vector-loader,
        /* Loading scene: keep the decorative rocket/debris behind all loading copy. */
        .auth-screen-root{position:relative;isolation:isolate;min-height:100vh}
        .auth-screen-root>.auth-vector-scene{z-index:0!important;pointer-events:none!important}
        .auth-loading-stage,.auth-permission-loading{position:relative;z-index:2!important;background:transparent!important;background-image:none!important;border:0!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
        .auth-loading-stage .vector-loader{position:relative;z-index:3!important;background:transparent!important;background-image:none!important;border:0!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
        .auth-loading-stage .vector-loader span{position:relative;z-index:4!important;display:block}
        .auth-screen-root>.auth-vector-scene .auth-vector-art{position:relative;z-index:0!important}
        .auth-screen-root>.auth-vector-scene:before,.auth-screen-root>.auth-vector-scene:after{pointer-events:none}
        .auth-loading-stage .vector-loader svg {
          background: transparent !important;
          background-color: transparent !important;
          border: 0 !important;
          outline: 0 !important;
          box-shadow: none !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }
        .auth-loading-stage::before,
        .auth-loading-stage::after,
        .auth-loading-stage .vector-loader::before,
        .auth-loading-stage .vector-loader::after {
          content: none !important;
          display: none !important;
        }
        .auth-loading-stage .vector-loader svg {
          filter: drop-shadow(0 0 14px color-mix(in srgb, var(--crm-accent, #d9874e) 24%, transparent));
        }

        /* Glass mode: stronger translucency for CRM navigation and surfaces. */
        .crm-glassy .crm-layout>.crm-sidebar{
          background:rgba(20,27,39,.34)!important;
          border-right-color:rgba(160,181,210,.24)!important;
          backdrop-filter:blur(26px) saturate(165%)!important;
          -webkit-backdrop-filter:blur(26px) saturate(165%)!important;
        }
        .crm-glassy .crm-layout>main>section,
        .crm-glassy .crm-layout>main>div>section{
          background:rgba(24,31,45,.34)!important;
          backdrop-filter:blur(26px) saturate(165%)!important;
          -webkit-backdrop-filter:blur(26px) saturate(165%)!important;
          border-color:rgba(160,181,210,.26)!important;
        }
        .crm-glassy .crm-layout :is(article,.crm-settings-section,.crm-settings-choice,[class*="card"]){
          background:rgba(27,35,50,.30)!important;
          backdrop-filter:blur(20px) saturate(155%)!important;
          -webkit-backdrop-filter:blur(20px) saturate(155%)!important;
          border-color:rgba(160,181,210,.22)!important;
        }
        :root[data-crm-theme="day"].crm-glassy .crm-layout>.crm-sidebar{
          background:rgba(235,243,253,.30)!important;
          border-right-color:rgba(110,135,166,.25)!important;
        }
        :root[data-crm-theme="day"].crm-glassy .crm-layout>main>section,
        :root[data-crm-theme="day"].crm-glassy .crm-layout>main>div>section{
          background:rgba(239,246,255,.30)!important;
          border-color:rgba(110,135,166,.24)!important;
        }
        :root[data-crm-theme="day"].crm-glassy .crm-layout :is(article,.crm-settings-section,.crm-settings-choice,[class*="card"]){
          background:rgba(245,249,255,.27)!important;
          border-color:rgba(110,135,166,.20)!important;
        }
        :root[data-crm-theme="night"].crm-glassy .crm-layout>.crm-sidebar{
          background:rgba(12,17,28,.32)!important;
        }
        :root[data-crm-theme="night"].crm-glassy .crm-layout>main>section,
        :root[data-crm-theme="night"].crm-glassy .crm-layout>main>div>section{
          background:rgba(13,19,31,.32)!important;
        }
        /* The glass preference affects signed-in CRM surfaces, never removes login glass. */
        .crm-glassy .auth-screen-root .auth-login-panel{
          background:rgba(17,22,32,.30)!important;
          border-color:rgba(160,181,210,.28)!important;
          backdrop-filter:blur(18px) saturate(155%)!important;
          -webkit-backdrop-filter:blur(18px) saturate(155%)!important;
        }
        :root[data-crm-theme="day"].crm-glassy .auth-screen-root .auth-login-panel{
          background:rgba(245,249,255,.34)!important;
          border-color:rgba(255,255,255,.62)!important;
        }
        :root[data-crm-theme="night"].crm-glassy .auth-screen-root .auth-login-panel{
          background:rgba(13,18,29,.34)!important;
        }
        @media(max-width:760px){
          .crm-glassy .crm-layout>.crm-sidebar{backdrop-filter:blur(18px) saturate(145%)!important;-webkit-backdrop-filter:blur(18px) saturate(145%)!important}
          .crm-glassy .crm-layout>main>section,
          .crm-glassy .crm-layout>main>div>section{backdrop-filter:blur(16px) saturate(140%)!important;-webkit-backdrop-filter:blur(16px) saturate(140%)!important}
        }
      `}</style>
      <header className="crm-brand-header" style={{ maxWidth: 1440, margin: '0 auto', position:'relative',zIndex:1,display:'flex',justifyContent:'center',alignItems:'center',width:'100%',padding:'20px 16px 14px' }}>
        <p className="crm-brand-title" style={{ fontWeight: 800, textAlign:'center',margin:0,letterSpacing:'0.18em',fontSize:'clamp(18px,2.5vw,25px)',lineHeight:1.2 }}>ATTENDANCE <span style={{fontWeight:400,opacity:.82}}>CRM</span></p>
      </header>

      {screen === 'loading' && (
        <div className="auth-loading-stage"><VectorLoader label="Preparing your workspace" /></div>
      )}

      {screen === 'login' && (
        <section className="auth-login-panel" style={{ ...panelStyle, maxWidth: 430 }}>
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
        <section className="auth-login-panel" style={{ ...panelStyle, maxWidth: 430 }}>
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
        <div className="auth-loading-stage auth-permission-loading" role="status"><VectorLoader label="Loading your account permissions" /></div>
      )}

      {screen === 'signed-in' && session && profileReady && (
        <div className="crm-layout" style={{display:'grid',gridTemplateColumns:navOpen?'232px minmax(0,1fr)':'58px minmax(0,1fr)',gap:0,alignItems:'stretch',width:'100%',maxWidth:'none',margin:0,minHeight:'100vh'}}>
          <CrmAmbientBackdrop />

          <aside className={`crm-sidebar ${navOpen ? 'is-open' : ''}`} style={{position:'sticky',top:0,alignSelf:'stretch',height:'100vh',minHeight:'100vh',overflowY:'auto',display:'flex',flexDirection:'column',padding:navOpen?'12px 10px':'10px 5px',background:'#101114',borderTop:0,borderBottom:0,borderLeft:0,borderRight:'1px solid #292a31',borderRadius:0,color:'#dce4f2'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:navOpen?'space-between':'center',gap:8,marginBottom:16,paddingBottom:12,borderBottom:'1px solid #24252c',color:'#fff',fontWeight:700}}>{navOpen&&<span>Partner CRM</span>}<button type="button" aria-label={navOpen?'Minimize sidebar':'Expand sidebar'} title={navOpen?'Minimize sidebar':'Expand sidebar'} onClick={()=>setNavOpen(v=>!v)} style={{display:'grid',placeItems:'center',flexShrink:0,width:36,height:36,border:'1px solid #34353e',borderRadius:7,background:'#1a1b20',color:'#fff',cursor:'pointer'}}>{navOpen?<X size={18}/>:<Menu size={18}/>}</button></div>
            <button type="button" title="My Profile" aria-current={activePage==='my-profile'?'page':undefined} onClick={()=>{setAttendanceMenuOpen(false);setTeamMenuOpen(false);setTelegramMenuOpen(false);setActivePage('my-profile');setMapPreview(null);window.scrollTo(0,0);}} style={{display:'flex',alignItems:'center',justifyContent:navOpen?'flex-start':'center',gap:10,width:'100%',padding:navOpen?'9px 9px':'11px 0',marginBottom:10,textAlign:'left',border:'1px solid '+(activePage==='my-profile'?'var(--crm-accent)':'#34353e'),borderRadius:7,background:activePage==='my-profile'?'var(--crm-accent-soft)':'#17191f',color:activePage==='my-profile'?'var(--crm-accent)':'#e5e7eb',cursor:'pointer'}}><span style={{display:'grid',placeItems:'center',width:28,height:28,borderRadius:99,background:'var(--crm-accent-soft)',fontSize:18}}>{({male:'👨🏻‍💼',female:'👩🏻‍💼',animal:'🐼',alien:'👽'} as Record<string,string>)[personalProfile.avatar_key.split('-')[0]] || '👤'}</span>{navOpen&&<span className="crm-menu-label" style={{fontSize:13,fontWeight:700}}>My Profile</span>}</button>
            <nav aria-label="CRM pages" style={{display:'flex',flexDirection:'column',gap:3}}>
              {[{label:'Dashboard',icon:<LayoutDashboard size={18}/>,id:'dashboard' as CrmPage},{label:'Attendance',icon:<CalendarDays size={18}/>,id:'attendance' as CrmPage},{label:'Team management',icon:<Users size={18}/>,id:'team' as CrmPage},{label:'Telegram chats & analytics',icon:<MessageCircle size={18}/>,id:'telegram' as CrmPage},{label:'Security & devices',icon:<ShieldAlert size={18}/>,id:'security' as CrmPage},{label:'Requests',icon:<MessageCircle size={18}/>,id:'requests' as CrmPage},{label:'Settings',icon:<SettingsIcon size={18}/>,id:'settings' as CrmPage}].filter(item=>item.id==='dashboard'||item.id==='downloads'||item.id==='attendance'||((item.id==='security'||item.id==='requests')&&isAdmin)||item.id==='settings'||(item.id==='team'&&(isAdmin||isSupervisor||canManageTeam))||(item.id==='telegram'&&(isAdmin||isSupervisor||canManageTeam||canUseHumanTelegram))).map(item=><div key={item.id}>
                <button type="button" title={item.label} aria-current={activePage===item.id || (item.id==='attendance' && (activePage==='attendance-records'||activePage==='team-attendance'||activePage==='workforce-operations')) || (item.id==='team' && ['manager-hierarchy','team-roles','team-links','team-assignments','team-invitations'].includes(activePage)) || (item.id==='telegram' && ['telegram-human','telegram-analytics'].includes(activePage))?'page':undefined} aria-expanded={item.id==='attendance'?attendanceMenuOpen:item.id==='team'?teamMenuOpen:item.id==='telegram'?telegramMenuOpen:undefined} data-branch-active={(item.id==='attendance' && (activePage==='attendance-records'||activePage==='team-attendance')) || (item.id==='team' && ['team-roles','team-links','team-assignments','team-invitations'].includes(activePage)) || (item.id==='telegram' && ['telegram-human','telegram-analytics'].includes(activePage)) ? 'true' : undefined} onClick={()=>{if(item.id==='team'){if(!navOpen){setNavOpen(true);setTeamMenuOpen(true);setTelegramMenuOpen(false);setAttendanceMenuOpen(false);}else{setTeamMenuOpen(!teamMenuOpen);setTelegramMenuOpen(false);setAttendanceMenuOpen(false);}}else if(item.id==='telegram'){if(!navOpen){setNavOpen(true);setTelegramMenuOpen(true);setTeamMenuOpen(false);setAttendanceMenuOpen(false);}else{setTelegramMenuOpen(!telegramMenuOpen);setTeamMenuOpen(false);setAttendanceMenuOpen(false);}}else if(item.id==='attendance'){if(!navOpen){setNavOpen(true);setAttendanceMenuOpen(true);setTeamMenuOpen(false);setTelegramMenuOpen(false);}else{setAttendanceMenuOpen(!attendanceMenuOpen);setTeamMenuOpen(false);setTelegramMenuOpen(false);}}else{setAttendanceMenuOpen(false);setTeamMenuOpen(false);setTelegramMenuOpen(false);setActivePage(item.id);}setMapPreview(null);window.scrollTo(0,0)}} style={{position:'relative',display:'flex',alignItems:'center',justifyContent:navOpen?'flex-start':'center',gap:10,width:'100%',padding:navOpen?'10px 9px':'11px 0',textAlign:'left',border:0,borderRadius:6,background:activePage===item.id?'var(--crm-accent-soft)':'transparent',color:activePage===item.id?'var(--crm-accent)':'#cbd5e1',cursor:'pointer'}}>{item.icon}{navOpen&&<><span className="crm-menu-label" style={{flex:1}}>{item.label}</span>{item.id==='attendance'&&pendingWorkforceCount>0&&<span aria-label={pendingWorkforceCount+' pending workforce requests'} style={{minWidth:19,height:19,padding:'0 5px',boxSizing:'border-box',display:'inline-flex',alignItems:'center',justifyContent:'center',borderRadius:99,background:'#dc2626',color:'#fff',fontSize:10,fontWeight:800,fontVariantNumeric:'tabular-nums'}}>{pendingWorkforceCount>99?'99+':pendingWorkforceCount}</span>}{item.id==='requests'&&newRequestCount>0&&<span aria-label={newRequestCount+' new requests'} style={{minWidth:19,height:19,padding:'0 5px',boxSizing:'border-box',display:'inline-flex',alignItems:'center',justifyContent:'center',borderRadius:99,background:'#dc2626',color:'#fff',fontSize:10,fontWeight:800,fontVariantNumeric:'tabular-nums'}}>{newRequestCount>99?'99+':newRequestCount}</span>}{item.id==='security'&&newSecurityLogCount>0&&<span aria-label={newSecurityLogCount+' unreviewed security alerts'} style={{minWidth:19,height:19,padding:'0 5px',boxSizing:'border-box',display:'inline-flex',alignItems:'center',justifyContent:'center',borderRadius:99,background:'#dc2626',color:'#fff',fontSize:10,fontWeight:800,fontVariantNumeric:'tabular-nums'}}>{newSecurityLogCount>99?'99+':newSecurityLogCount}</span>}{(item.id==='team'||item.id==='telegram'||item.id==='attendance')&&((item.id==='team'?teamMenuOpen:item.id==='telegram'?telegramMenuOpen:attendanceMenuOpen)?<ChevronDown size={15}/>:<ChevronRight size={15}/>)}</>}{!navOpen&&item.id==='attendance'&&pendingWorkforceCount>0&&<span aria-label={pendingWorkforceCount+' pending workforce requests'} style={{position:'absolute',top:1,right:1,minWidth:16,height:16,padding:'0 3px',boxSizing:'border-box',display:'grid',placeItems:'center',borderRadius:99,background:'#dc2626',color:'#fff',fontSize:9,fontWeight:800}}>{pendingWorkforceCount>99?'99+':pendingWorkforceCount}</span>}{!navOpen&&item.id==='requests'&&newRequestCount>0&&<span aria-label={newRequestCount+' new requests'} style={{position:'absolute',top:1,right:1,minWidth:16,height:16,padding:'0 3px',boxSizing:'border-box',display:'grid',placeItems:'center',borderRadius:99,background:'#dc2626',color:'#fff',fontSize:9,fontWeight:800}}>{newRequestCount>99?'99+':newRequestCount}</span>}{!navOpen&&item.id==='security'&&newSecurityLogCount>0&&<span aria-label={newSecurityLogCount+' unreviewed security alerts'} style={{position:'absolute',top:1,right:1,minWidth:16,height:16,padding:'0 3px',boxSizing:'border-box',display:'grid',placeItems:'center',borderRadius:99,background:'#dc2626',color:'#fff',fontSize:9,fontWeight:800}}>{newSecurityLogCount>99?'99+':newSecurityLogCount}</span>}</button>
                {item.id==='attendance'&&navOpen&&attendanceMenuOpen&&<div style={{margin:'3px 0 7px 13px',paddingLeft:10,borderLeft:'1px solid var(--crm-border)',display:'grid',gap:2}}>
                  {[{label:'Attendance records',id:'attendance-records' as CrmPage,icon:<CalendarDays size={15}/>},{label:'Workforce operations',id:'workforce-operations' as CrmPage,icon:<CalendarDays size={15}/>},...((canViewAdmin||canManageTeam)?[{label:'Team attendance report',id:'team-attendance' as CrmPage,icon:<Users size={15}/>}]:[])].map(sub=><button key={sub.id} type="button" title={sub.label} aria-current={activePage===sub.id?'page':undefined} onClick={()=>{const isMobile=window.matchMedia('(max-width: 760px)').matches;setAttendanceMenuOpen(!isMobile);setTeamMenuOpen(false);setTelegramMenuOpen(false);setActivePage(sub.id);setMapPreview(null);window.scrollTo(0,0)}} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'8px 7px',textAlign:'left',border:0,borderRadius:5,background:activePage===sub.id?'var(--crm-accent-soft)':'transparent',color:activePage===sub.id?'var(--crm-accent)':'#b8bbc5',fontSize:12,cursor:'pointer'}}>{sub.icon}<span style={{flex:1}}>{sub.label}</span>{sub.id==='workforce-operations'&&pendingWorkforceCount>0&&<span aria-label={pendingWorkforceCount+' pending workforce requests'} style={{minWidth:18,height:18,padding:'0 5px',display:'inline-flex',alignItems:'center',justifyContent:'center',borderRadius:99,background:'#dc2626',color:'#fff',fontSize:10,fontWeight:800}}>{pendingWorkforceCount>99?'99+':pendingWorkforceCount}</span>}</button>)}
                </div>}
                {item.id==='team'&&navOpen&&teamMenuOpen&&(isAdmin||isSupervisor||canManageTeam)&&<div style={{margin:'3px 0 7px 13px',paddingLeft:10,borderLeft:'1px solid var(--crm-border)',display:'grid',gap:2}}>
                  {([{label:'Manager hierarchy',id:'manager-hierarchy' as CrmPage,icon:<GitBranch size={15}/>},{label:'Employee role management',id:'team-roles' as CrmPage,icon:<UserCog size={15}/>},{label:'Link Telegram members',id:'team-links' as CrmPage,icon:<Link2 size={15}/>},{label:'Assign employees to managers',id:'team-assignments' as CrmPage,icon:<GitBranch size={15}/>},{label:isAdmin?'Admin invitation':'Employee invitations',id:'team-invitations' as CrmPage,icon:<UserPlus size={15}/>}]).filter(sub=>isAdmin||(isSupervisor&&sub.id==='manager-hierarchy')||(canManageTeam&&(sub.id==='team-invitations'||sub.id==='manager-hierarchy'))).map(sub=><button key={sub.id} type="button" title={sub.label} aria-current={activePage===sub.id?'page':undefined} onClick={()=>{if(sub.id==='telegram-human')setTelegramHumanNavKey(value=>value+1);const isMobile=window.matchMedia('(max-width: 760px)').matches;setTeamMenuOpen(!isMobile);setAttendanceMenuOpen(false);setTelegramMenuOpen(false);setActivePage(sub.id);setMapPreview(null);window.scrollTo(0,0)}} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'8px 7px',textAlign:'left',border:0,borderRadius:5,background:activePage===sub.id?'var(--crm-accent-soft)':'transparent',color:activePage===sub.id?'var(--crm-accent)':'#b8bbc5',fontSize:12,cursor:'pointer'}}>{sub.icon}<span>{sub.label}</span></button>)}
                </div>}
                {item.id==='telegram'&&navOpen&&telegramMenuOpen&&(isAdmin||canManageTeam||canUseHumanTelegram)&&<div style={{margin:'3px 0 7px 13px',paddingLeft:10,borderLeft:'1px solid var(--crm-border)',display:'grid',gap:2}}>
                  {[{label:'Corporate Telegram Inbox',id:'telegram-human' as CrmPage,icon:<MessageCircle size={15}/>},{label:'Telegram group analytics',id:'telegram-analytics' as CrmPage,icon:<Users size={15}/>}].filter(sub=>sub.id==='telegram-human'?canUseHumanTelegram:(isAdmin||isSupervisor||canManageTeam)).map(sub=><button key={sub.id} type="button" title={sub.label} aria-current={activePage===sub.id?'page':undefined} onClick={()=>{const isMobile=window.matchMedia('(max-width: 760px)').matches;setTelegramMenuOpen(!isMobile);setAttendanceMenuOpen(false);setTeamMenuOpen(false);setActivePage(sub.id);setMapPreview(null);window.scrollTo(0,0)}} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'8px 7px',textAlign:'left',border:0,borderRadius:5,background:activePage===sub.id?'var(--crm-accent-soft)':'transparent',color:activePage===sub.id?'var(--crm-accent)':'#b8bbc5',fontSize:12,cursor:'pointer'}}>{sub.icon}<span>{sub.label}</span></button>)}
                </div>}
              </div>)}
            </nav>

            <button type="button" title="Downloads" aria-current={activePage==='downloads'?'page':undefined} onClick={()=>{setActivePage('downloads');setAttendanceMenuOpen(false);setTeamMenuOpen(false);setTelegramMenuOpen(false);setMapPreview(null);window.scrollTo(0,0);}} style={{display:'flex',alignItems:'center',justifyContent:navOpen?'flex-start':'center',gap:10,width:'100%',padding:navOpen?'10px 9px':'11px 0',marginTop:8,marginBottom:4,textAlign:'left',border:0,borderRadius:6,background:activePage==='downloads'?'var(--crm-accent-soft)':'transparent',color:activePage==='downloads'?'var(--crm-accent)':'#cbd5e1',cursor:'pointer'}}><Download size={18}/>{navOpen&&<span className="crm-menu-label">Downloads</span>}</button>
            <button type="button" title="Sign out" aria-label="Sign out" disabled={busy} onClick={() => void handleLogout()} style={{display:'flex',alignItems:'center',justifyContent:navOpen?'flex-start':'center',gap:10,width:'100%',padding:navOpen?10:'10px 0',marginTop:8,border:'1px solid var(--crm-accent-strong)',borderRadius:6,background:'var(--crm-accent-strong)',color:'#fff',fontWeight:700,cursor:busy?'wait':'pointer'}}><LogOut size={18}/>{navOpen&&(busy?'Please wait…':'Sign out')}</button>
            {navOpen&&<div style={{marginTop:16,paddingTop:12,borderTop:'1px solid #24252c',color:'#98a2b3',fontSize:11,overflowWrap:'anywhere'}}>{profile?.full_name||session.user.email}</div>}
          </aside>
          <nav className="crm-mobile-bottom-nav" aria-label="Mobile navigation">
            <button type="button" className={activePage==='dashboard'?'is-active':''} aria-current={activePage==='dashboard'?'page':undefined} onClick={()=>{setActivePage('dashboard');setMobileMoreOpen(false);window.scrollTo(0,0);}}>
              <LayoutDashboard size={19}/><span>Home</span>
            </button>
            <button type="button" className={['attendance','attendance-records','team-attendance','workforce-operations'].includes(activePage)?'is-active':''} aria-current={['attendance','attendance-records','team-attendance'].includes(activePage)?'page':undefined} onClick={()=>{setActivePage('attendance-records');setMobileMoreOpen(false);window.scrollTo(0,0);}}>
              <CalendarDays size={19}/><span>Attendance</span>
            </button>
            {(isAdmin||isSupervisor||canManageTeam)&&<button type="button" className={activePage==='team'||activePage==='manager-hierarchy'||activePage.startsWith('team-')?'is-active':''} aria-current={activePage==='team'||activePage==='manager-hierarchy'||activePage.startsWith('team-')?'page':undefined} onClick={()=>{setActivePage('team');setMobileMoreOpen(false);window.scrollTo(0,0);}}>
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
                {(canViewAdmin||canManageTeam)&&<button type="button" onClick={()=>{setActivePage('team-attendance');setMobileMoreOpen(false);window.scrollTo(0,0);}}><Users size={18}/><span><strong>Team attendance report</strong><small>Team trends, graphs and shift statistics</small></span><ChevronRight size={16}/></button>}
                <button type="button" onClick={()=>{setActivePage('workforce-operations');setMobileMoreOpen(false);window.scrollTo(0,0);}}><CalendarDays size={18}/><span><strong>Workforce operations</strong><small>Leave, corrections, holidays and follow-ups</small></span><ChevronRight size={16}/></button>
                {isAdmin&&<button type="button" onClick={()=>{setActivePage('security');setMobileMoreOpen(false);window.scrollTo(0,0);}}><ShieldAlert size={18}/><span><strong>Security</strong><small>Account and activity controls</small></span><ChevronRight size={16}/></button>}
                {isAdmin&&<button type="button" onClick={()=>{setActivePage('requests');setMobileMoreOpen(false);window.scrollTo(0,0);}}><MessageCircle size={18}/><span><strong>Requests</strong><small>Review Telegram ID change requests</small></span><ChevronRight size={16}/></button>}
                {(isAdmin||isSupervisor||canManageTeam)&&<button type="button" onClick={()=>{setActivePage('manager-hierarchy');setMobileMoreOpen(false);window.scrollTo(0,0);}}><GitBranch size={18}/><span><strong>Manager hierarchy</strong><small>Reporting lines and manager profiles</small></span><ChevronRight size={16}/></button>}
                {(isAdmin||canManageTeam)&&<button type="button" onClick={()=>{setActivePage('team-roles');setMobileMoreOpen(false);window.scrollTo(0,0);}}><UserCog size={18}/><span><strong>Employee roles</strong><small>Manage roles and access</small></span><ChevronRight size={16}/></button>}
                {isAdmin&&<button type="button" onClick={()=>{setActivePage('team-links');setMobileMoreOpen(false);window.scrollTo(0,0);}}><Link2 size={18}/><span><strong>Link Telegram members</strong><small>Connect Telegram identities</small></span><ChevronRight size={16}/></button>}
                {isAdmin&&<button type="button" onClick={()=>{setActivePage('team-assignments');setMobileMoreOpen(false);window.scrollTo(0,0);}}><GitBranch size={18}/><span><strong>Manager assignments</strong><small>View reporting hierarchy</small></span><ChevronRight size={16}/></button>}
                {(isAdmin||canManageTeam)&&<button type="button" onClick={()=>{setActivePage('team-invitations');setMobileMoreOpen(false);window.scrollTo(0,0);}}><UserPlus size={18}/><span><strong>{isAdmin?'Admin invitation':'Employee invitations'}</strong><small>Invite people to the CRM</small></span><ChevronRight size={16}/></button>}
                {(isAdmin||canManageTeam)&&<button type="button" onClick={()=>{setActivePage('telegram-analytics');setMobileMoreOpen(false);window.scrollTo(0,0);}}><MessageCircle size={18}/><span><strong>Telegram group analytics</strong><small>Group activity and response metrics</small></span><ChevronRight size={16}/></button>}
                {canUseHumanTelegram&&<button type="button" onClick={()=>{setActivePage('telegram-human');setMobileMoreOpen(false);window.scrollTo(0,0);}}><MessageCircle size={18}/><span><strong>Corporate Telegram Inbox</strong><small>Inbox, assignments and replies</small></span><ChevronRight size={16}/></button>}
                <button type="button" onClick={()=>{setActivePage('settings');setMobileMoreOpen(false);window.scrollTo(0,0);}}><SettingsIcon size={18}/><span><strong>Settings</strong><small>Appearance, display and timezone</small></span><ChevronRight size={16}/></button>
                <button type="button" className="crm-mobile-signout" disabled={busy} onClick={()=>{setMobileMoreOpen(false);void handleLogout();}}><LogOut size={18}/><span><strong>Sign out</strong><small>End your CRM session</small></span><ChevronRight size={16}/></button>
              </div>
            </section>
          </div>}
          <main style={{minWidth:0}}>
          {supabase && profile?.id && <DeviceTelemetryController supabase={supabase} userId={profile.id} hasActiveShift={attendance.some(record => record.employee_id === profile.id && !record.check_out) || salaryAttendance.some(record => record.employee_id === profile.id && !record.check_out)} showDeviceSecurityInfo={isAdmin} requireShiftLocationSharing={canManageTeam} />}
          <section style={panelStyle}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom:18,color:'#98a2b3',fontSize:13}}>
            <div style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Partner CRM / <strong style={{color:'#fff'}}>{{'my-profile':'My Profile',dashboard:'Dashboard',downloads:'Downloads',attendance:'Attendance', 'attendance-records':'Attendance records','workforce-operations':'Workforce operations','team-attendance':'Team attendance report',team:'Team management','manager-hierarchy':'Manager hierarchy','team-roles':'Employee role management','team-links':'Link Telegram members','team-assignments':'Assign employees to managers','team-invitations':(isAdmin?'Admin invitation':'Employee invitations'),telegram:'Telegram chats & analytics','telegram-human':'Corporate Telegram Inbox','telegram-analytics':'Telegram group analytics',security:'Security',requests:'Requests',settings:'Settings'}[activePage]}</strong></div>
            <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
              <button type="button" disabled={loadingDashboard} onClick={()=>{if(session?.user.id)void loadDashboard(session.user.id);}} aria-label="Refresh CRM information" title="Refresh CRM information" style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:34,height:32,border:'1px solid var(--crm-border)',borderRadius:7,background:'var(--crm-card-raised)',color:'var(--crm-text)',cursor:loadingDashboard?'wait':'pointer',opacity:loadingDashboard ? 0.6 : 1}}><RotateCcw size={16}/></button>
              <button type="button" onClick={()=>{setGlobalSearchOpen(true);setGlobalSearchQuery('');}} aria-label="Search CRM" title="Search CRM" style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:34,height:32,border:'1px solid var(--crm-border)',borderRadius:7,background:'var(--crm-card-raised)',color:'var(--crm-text)',cursor:'pointer'}}><Search size={16}/></button>
            </div>
          </div>
          {globalSearchOpen && <div role="dialog" aria-modal="true" aria-label="Search CRM" onMouseDown={event=>{if(event.target===event.currentTarget)setGlobalSearchOpen(false);}} style={{position:'fixed',inset:0,zIndex:10000,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'min(12vh,90px) 16px 24px',background:'rgba(0,0,0,.62)',backdropFilter:'blur(5px)'}}>
            <div style={{width:'min(620px,100%)',maxHeight:'76vh',overflowY:'auto',border:'1px solid var(--crm-border)',borderRadius:12,background:'var(--crm-panel-bg)',boxShadow:'0 24px 80px rgba(0,0,0,.45)',padding:16,color:'var(--crm-text)'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <Search size={19} color="var(--crm-muted)"/>
                <input autoFocus value={globalSearchQuery} onChange={event=>setGlobalSearchQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Escape')setGlobalSearchOpen(false);if(event.key==='Enter'&&globalSearchMatches[0])openGlobalSearchPage(globalSearchMatches[0].id);}} placeholder="Search functions, pages or people…" aria-label="Search functions, pages or people" style={{flex:1,minWidth:0,padding:'12px 4px',border:0,outline:0,background:'transparent',color:'var(--crm-text)',fontSize:16}}/>
                <button type="button" aria-label="Close search" onClick={()=>setGlobalSearchOpen(false)} style={{border:0,background:'transparent',color:'var(--crm-muted)',cursor:'pointer',padding:5}}><X size={18}/></button>
              </div>
              <div style={{height:1,background:'var(--crm-border)',margin:'8px 0 12px'}}/>
              {!normalizedGlobalSearch && <div style={{fontSize:12,color:'var(--crm-muted)',marginBottom:10}}>Quick access · start typing to find a CRM function or user</div>}
              {globalSearchPeople.length>0 && <>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',color:'var(--crm-muted)',margin:'12px 4px 6px'}}>People</div>
                {globalSearchPeople.map(person=><button key={person.id} type="button" onClick={()=>{if(canViewAdmin){setSelectedEmployeeId(person.id);openGlobalSearchPage('attendance-records');}else{openGlobalSearchPage('manager-hierarchy');}}} style={{display:'flex',alignItems:'center',gap:10,width:'100%',padding:'10px 9px',border:0,borderRadius:7,background:'transparent',color:'var(--crm-text)',textAlign:'left',cursor:'pointer'}}>
                  <span style={{display:'grid',placeItems:'center',width:30,height:30,borderRadius:99,background:'var(--crm-accent-soft)',color:'var(--crm-accent)',fontSize:12,fontWeight:700}}>{(person.full_name||person.email||'?').trim().charAt(0).toUpperCase()}</span>
                  <span style={{minWidth:0,flex:1}}><strong style={{display:'block',fontSize:13}}>{person.full_name||person.email}</strong><small style={{color:'var(--crm-muted)'}}>{person.email||person.role.replaceAll('_',' ')}</small></span><span style={{fontSize:11,color:'var(--crm-muted)'}}>{canViewAdmin?'Attendance':'Hierarchy'}</span>
                </button>)}
              </>}
              <div style={{fontSize:11,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',color:'var(--crm-muted)',margin:'12px 4px 6px'}}>CRM functions</div>
              {globalSearchMatches.map(item=><button key={item.id} type="button" onClick={()=>openGlobalSearchPage(item.id)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,width:'100%',padding:'10px 9px',border:0,borderRadius:7,background:'transparent',color:'var(--crm-text)',textAlign:'left',cursor:'pointer'}}><span style={{fontSize:13}}>{item.label}</span><span style={{fontSize:11,color:'var(--crm-muted)'}}>Open <span aria-hidden="true">↗</span></span></button>)}
              {normalizedGlobalSearch&&!globalSearchMatches.length&&!globalSearchPeople.length&&<div style={{padding:'20px 8px',textAlign:'center',fontSize:13,color:'var(--crm-muted)'}}>No matching CRM functions or people found.</div>}
              <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--crm-border)',fontSize:11,color:'var(--crm-muted)'}}>Search results only include pages and people available to your account.</div>
            </div>
          </div>}

          {activePage === 'my-profile' && (() => {
            const avatarOptions = [
              {group:'Male',items:Array.from({length:10},(_,i)=>'male-'+String(i+1).padStart(2,'0'))},
              {group:'Female',items:Array.from({length:10},(_,i)=>'female-'+String(i+1).padStart(2,'0'))},
              {group:'Animals',items:Array.from({length:5},(_,i)=>'animal-'+String(i+1).padStart(2,'0'))},
              {group:'Aliens',items:Array.from({length:5},(_,i)=>'alien-'+String(i+1).padStart(2,'0'))}
            ];
            const selectedAvatar = personalProfileDraft.avatar_key || 'male-01';
            const renderAvatar = (avatarKey:string,size:number) => {
              const [,kind='male',rawIndex='1'] = avatarKey.match(/^(male|female|animal|alien)-(\d+)$/) || [];
              const index = Math.max(0,Math.min(9,Number(rawIndex)-1));
              const palettes = [
                {skin:'#e8b58f',shadow:'#c98768',hair:'#27354a',shirt:'#e9a05b',bg:'#e7efff'},
                {skin:'#c98e6b',shadow:'#a96c55',hair:'#392d2b',shirt:'#7aa9bd',bg:'#fff0e4'},
                {skin:'#f0c9a7',shadow:'#d9a17f',hair:'#4b3540',shirt:'#8bb8a6',bg:'#eae7ff'},
                {skin:'#9b6248',shadow:'#754431',hair:'#202b38',shirt:'#d58c70',bg:'#e5f5ee'},
                {skin:'#d99c78',shadow:'#b9775d',hair:'#594337',shirt:'#8d91c2',bg:'#fff3d9'},
                {skin:'#edc09a',shadow:'#cf9878',hair:'#273e50',shirt:'#d4a75e',bg:'#e6f2f6'},
                {skin:'#b87555',shadow:'#8f543f',hair:'#302b35',shirt:'#80a7c9',bg:'#f3e9e4'},
                {skin:'#f0c9a8',shadow:'#d8a17e',hair:'#76513c',shirt:'#8bb7ad',bg:'#e8eff7'},
                {skin:'#a96d50',shadow:'#7e4c3c',hair:'#252b36',shirt:'#d99a78',bg:'#f1eafa'},
                {skin:'#dca27e',shadow:'#b9785e',hair:'#4b3030',shirt:'#9babc8',bg:'#e7f3ee'}
              ];
              const p = palettes[index];
              const animalColors=['#e6e2d7','#e8a05b','#d8a16d','#77b99a','#d69b8d'];
              const alienColors=['#86d5bd','#a6b6f2','#b8df79','#9bd4e7','#d3a6e8'];
              const id='profile-avatar-'+avatarKey;
              const human = kind==='male'||kind==='female';
              const hairBack = kind==='female' ? [
                <path d="M20 48 Q10 7 48 7 Q87 8 77 52 L73 78 Q65 88 62 65 L63 34 Q48 20 30 35 L32 66 Q28 87 19 76Z"/>,
                <path d="M18 49 Q12 12 43 8 Q76 3 80 39 L76 70 Q68 81 66 53 L65 31 Q43 17 27 35 L29 61 Q25 79 18 69Z"/>,
                <path d="M17 51 Q9 13 35 8 Q67 0 80 26 Q88 45 78 72 L69 79 L66 34 Q48 17 28 34 L27 76 L19 70Z"/>,
                <path d="M20 44 Q14 8 48 8 Q81 8 76 46 L72 65 L66 31 Q48 17 29 33 L28 66Z"/>,
                <path d="M18 45 Q12 13 43 7 Q73 3 79 34 L75 68 Q66 79 65 48 L64 30 Q46 19 29 34 L29 63Z"/>
              ] : [
                <path d="M23 43 Q18 12 47 9 Q76 9 74 42 L66 34 Q47 27 28 35Z"/>,
                <path d="M21 42 Q18 10 49 9 Q77 12 75 39 Q62 24 43 27 Q30 29 21 42Z"/>,
                <path d="M21 39 Q17 9 43 8 Q73 5 77 31 L72 41 Q66 23 52 24 Q35 20 24 39Z"/>,
                <path d="M20 42 Q16 11 45 8 Q73 7 77 32 L68 28 Q49 22 29 37 L26 45Z"/>,
                <path d="M20 40 Q17 9 48 8 Q77 8 75 43 L66 34 Q49 31 29 35Z"/>
              ];
              const hairstyle = index % 5;
              const hairTop = kind==='female' ? [
                <path d="M20 43 Q13 7 48 7 Q83 8 76 47 Q69 27 52 22 Q35 20 24 39Z"/>,
                <path d="M19 43 Q12 11 39 7 Q69 0 79 27 Q82 36 75 48 Q67 28 51 22 Q35 20 25 40Z"/>,
                <path d="M19 42 Q12 8 42 7 Q72 2 79 32 L73 44 Q63 20 47 22 Q30 20 23 43Z"/>,
                <path d="M19 41 Q19 9 49 8 Q79 8 77 43 L68 34 Q51 24 28 37Z"/>,
                <path d="M19 44 Q11 8 44 7 Q78 6 77 42 Q64 22 47 21 Q30 21 19 44Z"/>
              ] : [
                <path d="M20 42 Q16 9 47 8 Q77 8 76 40 Q64 28 49 26 Q32 25 20 42Z"/>,
                <path d="M19 41 Q16 8 48 8 Q76 9 77 37 Q62 23 42 26 Q28 28 19 41Z"/>,
                <path d="M18 40 Q14 8 39 7 Q70 3 79 30 Q67 22 57 25 Q39 18 18 40Z"/>,
                <path d="M18 39 Q17 8 48 7 Q78 8 77 36 L66 29 Q47 24 28 37Z"/>,
                <path d="M18 41 Q14 8 46 7 Q77 7 77 41 Q64 28 49 27 Q31 26 18 41Z"/>
              ];
              const glasses = index===2 || index===6 || index===9;
              const freckles = index===1 || index===4 || index===7;
              const mole = index===3 || index===8;
              const beard = kind==='male' && (index===1 || index===4 || index===7);
              const animalShape = index===0 ? 'cat' : index===1 ? 'fox' : index===2 ? 'bear' : index===3 ? 'rabbit' : 'dog';
              return <svg width={size} height={size} viewBox="0 0 96 96" role="img" aria-label={kind+' illustrated avatar'} style={{display:'block',flexShrink:0}}>
                <defs>
                  <linearGradient id={id+'bg'} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={human?p.bg:'#eaf0f7'}/><stop offset="100%" stopColor="#ffffff"/></linearGradient>
                  <linearGradient id={id+'skin'} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={p.skin}/><stop offset="100%" stopColor={p.shadow}/></linearGradient>
                  <linearGradient id={id+'shirt'} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={human?p.shirt:'#4e83a5'}/><stop offset="100%" stopColor="#253b54"/></linearGradient>
                </defs>
                <rect x="2" y="2" width="92" height="92" rx="25" fill={'url(#'+id+'bg)'}/>
                <circle cx="76" cy="19" r="5" fill="var(--crm-accent)" opacity=".14"/><circle cx="17" cy="72" r="3" fill="var(--crm-accent)" opacity=".18"/>
                {human ? <>
                  <path d="M11 96 Q15 68 48 66 Q81 68 85 96Z" fill={'url(#'+id+'shirt)'}/>
                  <path d="M35 67 L48 80 L61 67 L58 61 L38 61Z" fill="#ffffff" opacity=".78"/>
                  <path d="M37 57 L37 72 Q48 83 59 72 L59 57Z" fill={'url(#'+id+'skin)'}/>
                  <path d="M20 43 Q18 25 28 18 Q38 10 49 11 Q65 10 73 23 Q78 34 76 48 Q75 67 61 75 Q48 82 34 74 Q21 66 20 43Z" fill={'url(#'+id+'skin)'}/>
                  <path d="M20 42 Q15 35 18 44 Q18 55 24 56 L25 44Z M76 42 Q81 35 78 44 Q78 55 72 56 L71 44Z" fill={p.skin} stroke={p.shadow} strokeWidth="1"/>
                  <path d="M29 39 Q36 35 43 39 M53 39 Q60 35 67 39" fill="none" stroke={p.hair} strokeWidth="2.5" strokeLinecap="round"/>
                  <ellipse cx="37" cy="46" rx="3.1" ry="3.8" fill="#273447"/><ellipse cx="59" cy="46" rx="3.1" ry="3.8" fill="#273447"/>
                  <circle cx="38" cy="45" r="1" fill="#fff"/><circle cx="60" cy="45" r="1" fill="#fff"/>
                  <path d="M48 47 Q44 54 48 56" fill="none" stroke={p.shadow} strokeWidth="1.6" strokeLinecap="round"/>
                  <path d={index%3===0 ? "M42 62 Q48 65 54 61" : index%3===1 ? "M42 61 Q48 68 55 60" : "M42 62 Q48 59 54 62"} fill="none" stroke="#874d4c" strokeWidth="2" strokeLinecap="round"/>
                  {beard&&<path d="M29 56 Q31 72 48 75 Q65 72 67 56 Q61 65 55 64 Q48 69 41 64 Q34 65 29 56Z" fill={p.hair} opacity=".88"/>}
                  {freckles&&<g fill={p.shadow} opacity=".8"><circle cx="31" cy="55" r="1.1"/><circle cx="35" cy="58" r="1"/><circle cx="39" cy="55" r=".9"/><circle cx="57" cy="55" r=".9"/><circle cx="61" cy="58" r="1"/><circle cx="65" cy="54" r="1.1"/><circle cx="46" cy="53" r=".8"/></g>}
                  {mole&&<circle cx={index===3?64:32} cy={index===3?57:58} r="1.45" fill="#593c36"/>}
                  {glasses&&<g fill="none" stroke="#29384c" strokeWidth="2.1"><rect x="27" y="40" width="19" height="14" rx="5"/><rect x="50" y="40" width="19" height="14" rx="5"/><path d="M46 46 Q48 44 50 46 M27 45 L23 43 M69 45 L73 43"/></g>}
                  {kind==='female' && index===8 && <><circle cx="48" cy="10" r="8" fill={p.hair}/><path d="M43 11 Q48 3 53 11" fill="none" stroke="#8b6653" strokeWidth="2"/></>}
                  {kind==='female' && index===9 && <path d="M20 28 Q8 38 15 57 M76 28 Q88 38 81 57" fill="none" stroke={p.hair} strokeWidth="6" strokeLinecap="round"/>}
                  <g fill={p.hair} stroke={p.hair} strokeLinejoin="round">
                    {hairBack[hairstyle]}
                    {hairTop[hairstyle]}
                  </g>
                  {kind==='female' && index===5 && <path d="M23 37 Q11 54 23 74 M73 37 Q85 54 73 74" fill="none" stroke={p.hair} strokeWidth="6" strokeLinecap="round"/>}
                  {kind==='male' && index===5 && <path d="M25 20 Q48 2 70 20" fill="none" stroke="#d8e2ee" strokeWidth="4" strokeLinecap="round"/>}
                </> : kind==='animal' ? <>
                  <path d={animalShape==='cat'?"M17 43 L16 17 Q18 11 26 19 L37 31 M79 43 L80 17 Q78 11 70 19 L59 31":animalShape==='fox'?"M14 43 L20 12 L40 30 M82 43 L76 12 L56 30":animalShape==='rabbit'?"M28 32 Q17 3 28 5 Q40 6 41 31 M55 31 Q58 5 70 5 Q82 7 68 34":"M17 43 Q13 18 28 22 L39 33 M79 43 Q83 18 68 22 L57 33"} fill={animalColors[index]} stroke="#705b55" strokeWidth="2" strokeLinejoin="round"/>
                  <ellipse cx="48" cy="53" rx="31" ry="29" fill={animalColors[index]} stroke="#705b55" strokeWidth="1.5"/>
                  <ellipse cx="37" cy="48" rx="3" ry="4" fill="#293447"/><ellipse cx="59" cy="48" rx="3" ry="4" fill="#293447"/>
                  <ellipse cx="48" cy="61" rx="11" ry="8" fill="#f4d8cb"/><path d="M44 58 L48 62 L52 58Z" fill="#79535a"/><path d="M48 64 Q43 70 38 66 M48 64 Q53 70 58 66" fill="none" stroke="#79535a" strokeWidth="1.8" strokeLinecap="round"/>
                  {index===0&&<path d="M21 39 Q48 18 75 39" fill="none" stroke="#f7f2e9" strokeWidth="5"/>}
                  {index===1&&<path d="M23 58 Q48 72 73 58" fill="none" stroke="#fff0d5" strokeWidth="8" opacity=".85"/>}
                  {index===2&&<><circle cx="25" cy="35" r="7" fill="#bd8a65"/><circle cx="71" cy="35" r="7" fill="#bd8a65"/></>}
                  {index===3&&<path d="M31 30 Q48 22 65 30" fill="none" stroke="#fff4e6" strokeWidth="5"/>}
                  {index===4&&<path d="M28 28 Q48 18 68 28" fill="none" stroke="#6c5148" strokeWidth="4"/>}
                </> : <>
                  <path d="M15 96 Q17 69 48 67 Q79 69 81 96Z" fill={['#4e83a5','#7652a5','#67934d','#438d9a','#9b64a9'][index]}/>
                  <path d="M27 40 Q22 13 48 12 Q74 13 69 40 L64 62 Q48 77 32 62Z" fill={alienColors[index]} stroke="#527f87" strokeWidth="1.4"/>
                  <ellipse cx="38" cy="43" rx={index===2?8:6} ry={index===2?12:10} fill="#26344b"/><ellipse cx="58" cy="43" rx={index===2?8:6} ry={index===2?12:10} fill="#26344b"/>
                  <circle cx="40" cy="40" r="2" fill="#fff"/><circle cx="60" cy="40" r="2" fill="#fff"/>
                  <path d="M40 59 Q48 64 56 59" fill="none" stroke="#477c79" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M48 14 L48 7 M44 8 L52 8" stroke={alienColors[index]} strokeWidth="3" strokeLinecap="round"/>
                  {index%2===1&&<><path d="M25 33 L13 25 M71 33 L83 25" stroke={alienColors[index]} strokeWidth="3" strokeLinecap="round"/><circle cx="13" cy="24" r="4" fill="#f3c86a"/><circle cx="83" cy="24" r="4" fill="#f3c86a"/></>}
                  {index===4&&<path d="M31 23 Q48 12 65 23" fill="none" stroke="#f4c96b" strokeWidth="3" strokeLinecap="round"/>}
                </>}
                <rect x="2" y="2" width="92" height="92" rx="25" fill="none" stroke="var(--crm-accent)" strokeOpacity=".25" strokeWidth="1.5"/>
                <path d="M8 77 Q20 88 31 88" fill="none" stroke="#ffffff" strokeWidth="2" opacity=".5"/>
              </svg>;
            };
            const savePersonalProfile = async () => {
              if (!supabase || !profile?.id) return;
              setPersonalProfileSaving(true); setPersonalProfileNotice('');
              const {error} = await supabase.from('employee_personal_profiles').upsert({user_id:profile.id,avatar_key:personalProfileDraft.avatar_key,nickname:personalProfileDraft.nickname.trim(),updated_at:new Date().toISOString()},{onConflict:'user_id'});
              setPersonalProfileSaving(false);
              if (error) { setPersonalProfileNotice('Your profile changes could not be saved. Please try again.'); return; }
              const next={user_id:profile.id,avatar_key:personalProfileDraft.avatar_key,nickname:personalProfileDraft.nickname.trim()};
              setPersonalProfile(next); setPersonalProfileDraft({avatar_key:next.avatar_key,nickname:next.nickname}); setPersonalProfileNotice('Your personal profile has been saved.');
            };
            const directManagerUrl = directManager?.manager_telegram_username ? 'https://t.me/'+directManager.manager_telegram_username.replace(/^@/,'') : '';
            return <>
              <h1 style={{marginTop:0}}>My Profile</h1>
              <p style={{color:'var(--crm-muted)',maxWidth:760,lineHeight:1.6}}>Your personal account card. Your assigned Dashboard Name and Corporate Email are managed by your inviter and cannot be edited here.</p>
              <section className="crm-settings-section">
                <div style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
                  <div aria-label="Selected avatar" style={{width:82,height:82,display:'grid',placeItems:'center',borderRadius:22,border:'1px solid var(--crm-border)',background:'var(--crm-accent-soft)',fontSize:48}}>{renderAvatar(selectedAvatar,76)}</div>
                  <div><h2 style={{margin:'0 0 5px'}}>Choose your avatar</h2><p style={{margin:0,color:'var(--crm-muted)',fontSize:13}}>30 built-in illustrations. Choose one for your personal profile.</p></div>
                </div>
                {avatarOptions.map(group=><div key={group.group} style={{marginTop:18}}><h3 style={{fontSize:13,margin:'0 0 9px',color:'var(--crm-muted)'}}>{group.group} · {group.items.length}</h3><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(58px,1fr))',gap:8}}>{group.items.map(key=><button key={key} type="button" aria-label={'Select '+group.group.toLowerCase()+' avatar '+key} aria-pressed={personalProfileDraft.avatar_key===key} onClick={()=>setPersonalProfileDraft(current=>({...current,avatar_key:key}))} style={{height:66,display:'grid',placeItems:'center',border:'1px solid '+(personalProfileDraft.avatar_key===key?'var(--crm-accent)':'var(--crm-border)'),borderRadius:10,background:personalProfileDraft.avatar_key===key?'var(--crm-accent-soft)':'var(--crm-card-bg)',cursor:'pointer',boxShadow:personalProfileDraft.avatar_key===key?'0 0 0 1px var(--crm-accent) inset':'none'}}>{renderAvatar(key,52)}</button>)}</div></div>)}
              </section>
              <section className="crm-settings-section">
                <h2 style={{marginTop:0}}>Account information</h2>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,240px),1fr))',gap:14}}>
                  <label className="crm-settings-field">Dashboard Name<input readOnly disabled value={profile?.admin_panel_name || profile?.full_name || ''} style={{width:'100%',marginTop:7,boxSizing:'border-box',padding:12,border:'1px solid var(--crm-border)',borderRadius:7,background:'var(--crm-bg)',color:'var(--crm-muted)',opacity:1}}/><small style={{display:'block',marginTop:5,color:'var(--crm-muted)'}}>Set by your inviter · read only</small></label>
                  <label className="crm-settings-field">Corporate Email<input readOnly disabled value={profile?.email || ''} style={{width:'100%',marginTop:7,boxSizing:'border-box',padding:12,border:'1px solid var(--crm-border)',borderRadius:7,background:'var(--crm-bg)',color:'var(--crm-muted)',opacity:1}}/><small style={{display:'block',marginTop:5,color:'var(--crm-muted)'}}>Set by your inviter · read only</small></label>
                </div>
                <label className="crm-settings-field" style={{display:'block',marginTop:18}}>Nickname <span style={{fontWeight:400,color:'var(--crm-muted)'}}>(optional · private)</span><input maxLength={32} value={personalProfileDraft.nickname} onChange={event=>setPersonalProfileDraft(current=>({...current,nickname:event.target.value}))} placeholder="Choose a nickname for yourself" style={{width:'100%',maxWidth:460,boxSizing:'border-box',marginTop:7,padding:12,border:'1px solid var(--crm-border)',borderRadius:7,background:'var(--crm-bg)',color:'var(--crm-text)'}}/><small style={{display:'block',marginTop:5,color:'var(--crm-muted)'}}>Only shown in My Profile. It is not used as your CRM name or in team reports.</small></label>
                <button type="button" disabled={personalProfileSaving} onClick={()=>void savePersonalProfile()} style={{marginTop:16,padding:'11px 16px',border:0,borderRadius:7,background:'var(--crm-accent-strong)',color:'#fff',fontWeight:700,cursor:personalProfileSaving?'wait':'pointer',opacity:personalProfileSaving?0.7:1}}>{personalProfileSaving?'Saving…':'Save profile'}</button>
                {personalProfileNotice&&<p role="status" style={{fontSize:13,color:personalProfileNotice.includes('could not')?'#ef8a8a':'var(--crm-muted)'}}>{personalProfileNotice}</p>}
              </section>
              {!['admin','supervisor'].includes(String(profile?.role || '').toLowerCase().replaceAll('_',' ')) && <section className="crm-settings-section">
                <h2 style={{marginTop:0}}>Your reporting manager</h2>
                {directManager ? <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,flexWrap:'wrap',padding:14,border:'1px solid var(--crm-border)',borderRadius:10,background:'var(--crm-card-bg)'}}><div><strong style={{display:'block',fontSize:16}}>{directManager.manager_name}</strong><span style={{fontSize:12,color:'var(--crm-muted)',textTransform:'capitalize'}}>{directManager.manager_role}</span><small style={{display:'block',marginTop:5,color:'var(--crm-muted)'}}>Your direct reporting manager</small></div>{directManagerUrl?<a href={directManagerUrl} target="_blank" rel="noreferrer" style={{display:'inline-flex',alignItems:'center',gap:8,padding:'10px 14px',borderRadius:7,background:'#229ed9',color:'#fff',fontWeight:700,textDecoration:'none'}}><MessageCircle size={16}/> Contact manager</a>:<button type="button" disabled style={{padding:'10px 14px',border:0,borderRadius:7,background:'var(--crm-border)',color:'var(--crm-muted)'}}>Telegram contact unavailable</button>}</div> : <p style={{color:'var(--crm-muted)',fontSize:13}}>No direct reporting manager is currently assigned to your account. Please contact company support.</p>}
              </section>}
              <section className="crm-settings-section">
                <a href="https://t.me/MbP_Asia_support_bot" target="_blank" rel="noreferrer" style={{display:'inline-flex',alignItems:'center',gap:8,marginTop:0,padding:'11px 15px',borderRadius:7,background:'var(--crm-accent-strong)',color:'#fff',fontWeight:700,textDecoration:'none'}}><MessageCircle size={16}/> Contact company support</a>
              </section>
            </>;
          })()}
          {activePage === 'downloads' && <>
            <h1 style={{marginTop:0}}>Downloads</h1>
            <p style={{color:'var(--crm-muted,#98a2b3)',maxWidth:760,lineHeight:1.6}}>Get MBP Attendance for your device. All versions connect to the same live CRM account and data, so an internet connection is required.</p>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,260px),1fr))',gap:14,marginTop:20}}>
              {[
                {name:'Android',detail:'Android APK · Latest published build',description:'Install the APK on Android. You may need to allow installation from your browser or file manager.',url:ANDROID_APK_DOWNLOAD_URL,action:'Download APK',icon:<Smartphone size={24}/>},
                {name:'iPhone / iPad',detail:'iOS Home Screen Web Clip',description:'Add an Attendance CRM shortcut to your iPhone or iPad Home Screen. The profile is currently unsigned.',url:IOS_WEBCLIP_DOWNLOAD_URL,action:'Download iOS profile',icon:<Smartphone size={24}/>,guide:'ios' as const},
                {name:'Windows',detail:'Windows 10 / 11 · Latest 64-bit installer',description:'Desktop app installer with Start Menu and optional Desktop shortcut.',url:WINDOWS_EXE_DOWNLOAD_URL,action:'Download EXE',icon:<Monitor size={24}/>},
                {name:'macOS',detail:'Latest universal DMG · Apple Silicon and Intel',description:'Install the Attendance CRM desktop app on an Intel or Apple Silicon Mac.',url:MACOS_DMG_DOWNLOAD_URL,action:'Download DMG',icon:<Monitor size={24}/>,guide:'macos' as const}
              ].map(item=><article key={item.name} style={{display:'flex',flexDirection:'column',gap:12,minHeight:210,padding:18,border:'1px solid var(--crm-border,#343b49)',borderRadius:10,background:'var(--crm-card-bg,#151b29)',color:'var(--crm-text,#e5e7eb)'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,color:'var(--crm-accent,#ff9b45)'}}>{item.icon}<strong style={{fontSize:17,color:'var(--crm-text,#fff)'}}>{item.name}</strong></div>
                <div style={{fontSize:12,fontWeight:700,color:'var(--crm-accent,#ffb36b)'}}>{item.detail}</div>
                <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',marginTop:'auto'}}>
                  <p style={{fontSize:13,lineHeight:1.55,color:'var(--crm-muted,#b7c0d1)',margin:0,flex:'1 1 220px'}}>{item.description}</p>
                  {item.guide&&<button type="button" onClick={()=>{setInstallationStep(0);setInstallationGuide(item.guide);}} style={{padding:'4px 0',border:0,background:'transparent',color:'var(--crm-muted,#98a2b3)',fontSize:11,textDecoration:'underline',textUnderlineOffset:3,cursor:'pointer',whiteSpace:'nowrap'}}>Installation instructions</button>}
                  <a href={item.url} download={item.name==='iPhone / iPad'} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8,padding:'10px 13px',borderRadius:7,background:'var(--crm-accent,#e87924)',color:'#111827',fontWeight:800,textDecoration:'none',whiteSpace:'nowrap'}}><Download size={16}/>{item.action}</a>
                </div>
              </article>)}
            </div>
            {installationGuide && (() => {
              const iosSteps = [
                {title:'Open the CRM in Safari',subtitle:'Start on the iPhone or iPad where you want the shortcut.',detail:'Use Safari on the device itself. Sign in to the CRM, open the sidebar and choose Downloads. Do not download the profile on a computer and send it to the phone.',action:'Open Downloads in the CRM',hint:'If you use another browser, open the downloaded profile in Settings after the download. Safari is the recommended route.'},
                {title:'Download the Web Clip profile',subtitle:'Download the configuration profile that adds the Home Screen icon.',detail:'In Downloads, find the iPhone / iPad card and tap Download iOS profile. If Safari asks whether to allow the download, choose Allow. Wait for Safari to confirm that the profile has been downloaded.',action:'Tap “Download iOS profile”',hint:'This does not install the profile yet. It only saves it and makes it available in iOS Settings.'},
                {title:'Open Profile Downloaded in Settings',subtitle:'The downloaded profile is installed from the iOS Settings app.',detail:'Leave Safari and open Settings. On recent iOS versions, tap Profile Downloaded near the top of the Settings screen. If that shortcut is not displayed, open General → VPN & Device Management and select the downloaded MBP Attendance profile under Downloaded Profile.',action:'Settings → Profile Downloaded',hint:'If it is missing, return to Safari and download the profile again. Also check Settings → General → VPN & Device Management.'},
                {title:'Review and install the profile',subtitle:'Check the profile name before approving it.',detail:'The Install Profile screen should identify the MBP Attendance Web Clip. Tap Install in the upper-right corner, enter your device passcode if requested, review the confirmation screen and tap Install again. Wait until iOS confirms the profile is installed, then tap Done.',action:'Install → enter passcode → Install → Done',hint:'Only install the MBP Attendance profile you intentionally downloaded from your organisation’s CRM website. This profile adds a Web Clip; it does not install an App Store application.'},
                {title:'Open MBP Attendance from Home Screen',subtitle:'The shortcut is now available alongside your other apps.',detail:'Return to the Home Screen and look for MBP Attendance. If it is not on the first page, swipe through the Home Screen pages or use Spotlight search. Tap the icon and sign in with your normal CRM credentials. Keep an internet connection available.',action:'Home Screen → MBP Attendance',hint:'The Web Clip opens the live CRM website in an app-style view. Your account, attendance records and data remain on the same CRM backend.'}
              ];
              const macSteps = [
                {title:'Download the macOS installer',subtitle:'Get the DMG from the CRM Downloads page.',detail:'On your Mac, sign in to the CRM and open Downloads in the sidebar. In the macOS card, click Download DMG. Wait for the download to finish. In Safari, use the Downloads button in the toolbar; in other browsers, open the browser’s downloads list.',action:'Downloads → macOS → Download DMG',hint:'The universal DMG is intended for both Apple Silicon and Intel Macs. Keep the file in Downloads until installation is complete.'},
                {title:'Open the disk image',subtitle:'Mount the downloaded DMG in Finder.',detail:'Open Finder and choose Downloads in the sidebar. Double-click MBP-Attendance-0.1.0-macOS.dmg (the version number may differ). macOS verifies and mounts it. A MBP Attendance disk should appear on the desktop and in Finder’s sidebar; an installer window should open.',action:'Finder → Downloads → double-click the .dmg',hint:'If the window does not open automatically, double-click the mounted MBP Attendance disk in Finder’s sidebar.'},
                {title:'Copy the app to Applications',subtitle:'Use the standard drag-and-drop installation window.',detail:'In the MBP Attendance installer window, locate the MBP Attendance app icon and the Applications folder shortcut. Drag MBP Attendance onto Applications. Wait for Finder to finish copying before opening the app. Do not run the app directly from the mounted DMG.',action:'Drag MBP Attendance → Applications',hint:'If macOS asks whether to replace an existing version, close the app first. Replace it only if you intend to update the existing installation.'},
                {title:'Eject the installer and launch',subtitle:'Run the installed copy from Applications.',detail:'In Finder’s sidebar, click the eject symbol next to MBP Attendance. Then open Finder → Applications and double-click MBP Attendance. You can optionally drag the app from Applications to the Dock for quicker access.',action:'Eject disk → Applications → MBP Attendance',hint:'Keep the original DMG only if you want an installer copy for later. Ejecting the disk does not uninstall the app copied to Applications.'},
                {title:'Approve the first launch if macOS blocks it',subtitle:'The current macOS app is not notarized or Developer ID signed.',detail:'If macOS displays “Apple cannot check it for malicious software” or says the developer cannot be verified, cancel the alert first. Open System Settings → Privacy & Security, scroll to the Security section and look for the message that MBP Attendance was blocked. If you trust the installer you downloaded from the organisation’s CRM, click Open Anyway and confirm with Touch ID or your Mac password. Alternatively, Control-click the app in Applications, choose Open, then confirm Open when macOS presents the warning.',action:'System Settings → Privacy & Security → Open Anyway',hint:'Only bypass this warning for the installer obtained from your organisation’s official CRM Downloads page. Do not disable Gatekeeper globally.'},
                {title:'Sign in and start using the CRM',subtitle:'The desktop app uses your existing CRM account.',detail:'Launch MBP Attendance from Applications or the Dock. Sign in using your normal CRM credentials and complete any required verification. The desktop app opens the live CRM website and uses the same account and data as the browser version.',action:'Open MBP Attendance → sign in',hint:'An internet connection is required. This desktop wrapper is not an offline copy of the CRM.'}
              ];
              const steps = installationGuide === 'ios' ? iosSteps : macSteps;
              const step = steps[Math.min(installationStep, steps.length - 1)];
              const smallText = {fontSize:10,color:'#6e6e73'};
              const iosMock = <div style={{width:'100%',maxWidth:350,margin:'0 auto',border:'7px solid #202126',borderRadius:30,background:'#f2f2f7',overflow:'hidden',boxShadow:'0 12px 30px rgba(0,0,0,.24)',color:'#1c1c1e',fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif'}}>
                <div style={{height:25,padding:'5px 17px 0',display:'flex',justifyContent:'space-between',fontSize:10,fontWeight:700,background:'#f2f2f7'}}><span>9:41</span><span>● ● ▰</span></div>
                {installationStep===0?<><div style={{padding:'9px 13px 12px',textAlign:'center',fontSize:12,fontWeight:700}}>attendence.dpdns.org</div><div style={{padding:'10px 14px 18px',background:'#f2f2f7'}}><div style={{fontSize:10,color:'#8e8e93'}}>MBP ATTENDANCE</div><div style={{fontSize:21,fontWeight:750,margin:'4px 0 12px'}}>Downloads</div><div style={{background:'#fff',borderRadius:12,padding:13,marginBottom:9}}><div style={{fontSize:14,fontWeight:700}}>iPhone / iPad</div><div style={{fontSize:10,color:'#8e8e93',margin:'4px 0 12px'}}>iOS Home Screen Web Clip</div><div style={{fontSize:11,color:'#636366',lineHeight:1.45,marginBottom:10}}>Add MBP Attendance to your Home Screen.</div><div style={{background:'#d97732',color:'#fff',textAlign:'center',padding:9,borderRadius:8,fontSize:11,fontWeight:700}}>↓ Download iOS profile</div><div style={{fontSize:9,color:'#8e8e93',marginTop:9,textDecoration:'underline'}}>Installation instructions</div></div></div></>:installationStep===1?<><div style={{padding:'10px 12px',fontSize:12,color:'#007aff',borderBottom:'1px solid #d1d1d6'}}>‹ Safari <span style={{float:'right',color:'#1c1c1e',fontWeight:700}}>Settings</span></div><div style={{padding:'20px 15px 26px'}}><div style={{fontSize:21,fontWeight:750,textAlign:'center',marginBottom:16}}>Profile Downloaded</div><div style={{background:'#fff',borderRadius:11,padding:13,display:'flex',gap:10,alignItems:'center'}}><div style={{fontSize:24}}>⚙️</div><div><div style={{fontSize:12,fontWeight:700}}>MBP Attendance</div><div style={smallText}>Profile · Downloaded</div></div></div><div style={{fontSize:10,color:'#8e8e93',lineHeight:1.45,marginTop:14}}>Review the profile in Settings to install it.</div><div style={{marginTop:18,background:'#fff',borderRadius:10,padding:11,fontSize:11,color:'#007aff',textAlign:'center'}}>Profile Downloaded</div></div></>:installationStep===2?<><div style={{padding:'10px 12px',display:'flex',justifyContent:'space-between',fontSize:12,color:'#007aff'}}><span>‹ General</span><span style={{color:'#1c1c1e',fontWeight:700}}>Install Profile</span><span>Cancel</span></div><div style={{padding:'20px 15px 25px'}}><div style={{fontSize:10,color:'#8e8e93',marginBottom:9}}>DOWNLOADED PROFILE</div><div style={{background:'#fff',borderRadius:10,padding:13,display:'flex',gap:10,alignItems:'center'}}><div style={{fontSize:24}}>⚙️</div><div><div style={{fontSize:12,fontWeight:700}}>MBP Attendance Web Clip</div><div style={smallText}>Web Clip</div></div></div><div style={{fontSize:10,color:'#8e8e93',marginTop:14,lineHeight:1.5}}>This profile will add the MBP Attendance shortcut to your Home Screen.</div><div style={{marginTop:17,background:'#007aff',borderRadius:9,color:'#fff',textAlign:'center',padding:9,fontSize:12,fontWeight:700}}>Install</div></div></>:installationStep===3?<><div style={{padding:'10px 12px',fontSize:12,color:'#007aff'}}>‹ Settings <span style={{float:'right',color:'#1c1c1e',fontWeight:700}}>Done</span></div><div style={{padding:'18px 15px 24px'}}><div style={{fontSize:20,fontWeight:750,textAlign:'center',marginBottom:13}}>Install Profile</div><div style={{background:'#fff',borderRadius:10,padding:13}}><div style={{fontSize:12,fontWeight:700}}>MBP Attendance Web Clip</div><div style={smallText}>Profile details</div><div style={{borderTop:'1px solid #e5e5ea',marginTop:11,paddingTop:10,fontSize:10}}>Web Clip</div><div style={{marginTop:15,background:'#007aff',borderRadius:8,padding:9,textAlign:'center',color:'#fff',fontSize:11,fontWeight:700}}>Install</div></div><div style={{fontSize:9,color:'#8e8e93',marginTop:10}}>Follow the confirmation prompts to complete installation.</div></div></>:<><div style={{padding:'9px 12px',fontSize:10,fontWeight:700}}>9:41　● ● ▰</div><div style={{padding:'12px 14px 26px',background:'linear-gradient(160deg,#bfd8f4,#e7d7f4)',minHeight:205}}><div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,textAlign:'center'}}>{['Calendar','Photos','Camera','Maps','Clock','Weather','Notes','MBP'].map((name,i)=><div key={name}><div style={{width:39,height:39,borderRadius:10,margin:'0 auto 4px',background:i===7?'#222831':'#ffffffcc',display:'grid',placeItems:'center',color:i===7?'#f2a66c':'#6b7280',fontSize:19}}>{i===7?'◈':['▦','▧','◉','⌖','◷','☀','▤'][i]}</div><div style={{fontSize:8,color:'#202124'}}>{name==='MBP'?'MBP Attendance':name}</div></div>)}</div><div style={{marginTop:22,textAlign:'center',fontSize:11,color:'#31343a',fontWeight:700}}>MBP Attendance is ready</div></div></>}
                <div style={{height:17,display:'grid',placeItems:'center',background:'#f2f2f7'}}><div style={{width:92,height:4,borderRadius:5,background:'#1c1c1e'}}/></div>
              </div>;
              const macMock = <div style={{width:'100%',maxWidth:540,margin:'0 auto',border:'1px solid #aeb3bb',borderRadius:10,background:'#f4f5f7',overflow:'hidden',boxShadow:'0 12px 30px rgba(0,0,0,.2)',fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif',color:'#222'}}>
                <div style={{height:28,background:'linear-gradient(#fdfdfd,#e7e8eb)',borderBottom:'1px solid #c9cbd0',display:'flex',alignItems:'center',padding:'0 10px',gap:6}}><i style={{width:9,height:9,borderRadius:20,background:'#ff6058'}}/><i style={{width:9,height:9,borderRadius:20,background:'#ffbd2e'}}/><i style={{width:9,height:9,borderRadius:20,background:'#28c840'}}/><span style={{fontSize:10,fontWeight:700,margin:'0 auto'}}> {installationStep===0?'Downloads':installationStep===4?'System Settings — Privacy & Security':'MBP Attendance'}</span></div>
                {installationStep===0?<div style={{display:'grid',gridTemplateColumns:'105px 1fr',minHeight:175}}><div style={{padding:12,background:'#e9ebef',fontSize:10,lineHeight:2,color:'#525866'}}>Favorites<br/>AirDrop<br/>Recents<br/><b>Downloads</b><br/>Applications</div><div style={{padding:15}}><div style={{fontSize:10,color:'#777',marginBottom:10}}>Name　　　　　　　　　Date Added</div><div style={{padding:9,background:'#d9e8fb',borderRadius:5,fontSize:11}}>▣　MBP-Attendance-0.1.0-macOS.dmg</div></div></div>:installationStep===1||installationStep===2?<div style={{padding:20,minHeight:180,display:'grid',gridTemplateColumns:'1fr 65px 1fr',alignItems:'center',textAlign:'center',gap:10}}><div><div style={{fontSize:38,color:'#4d78bd'}}>▣</div><div style={{fontSize:11,fontWeight:700}}>MBP Attendance</div><div style={{fontSize:9,color:'#666'}}>{installationStep===1?'.app':'Application'}</div></div><div style={{fontSize:24,color:'#6e8fb7'}}>→</div><div><div style={{fontSize:38,color:'#4d78bd'}}>▰</div><div style={{fontSize:11,fontWeight:700}}>Applications</div><div style={{fontSize:9,color:'#666'}}>Folder shortcut</div></div><div style={{gridColumn:'1 / -1',fontSize:9,color:'#666'}}>Drag the app icon onto the Applications folder</div></div>:installationStep===3?<div style={{display:'grid',gridTemplateColumns:'105px 1fr',minHeight:175}}><div style={{padding:12,background:'#e9ebef',fontSize:10,lineHeight:2,color:'#525866'}}>Favorites<br/>AirDrop<br/>Recents<br/>Downloads<br/><b>Applications</b></div><div style={{padding:20,textAlign:'center'}}><div style={{fontSize:40,color:'#4d78bd'}}>▣</div><div style={{fontSize:11,fontWeight:700}}>MBP Attendance.app</div><div style={{fontSize:9,color:'#666'}}>Installed in Applications</div></div></div>:<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',minHeight:180}}><div style={{padding:18,background:'#f4f5f7',fontSize:10,color:'#555'}}>Privacy & Security<br/><div style={{marginTop:12,padding:9,background:'#fff',border:'1px solid #ddd',borderRadius:6,lineHeight:1.5}}>Security<br/><b>MBP Attendance was blocked</b><br/>because it is not from an identified developer.<div style={{marginTop:9,background:'#3478d4',color:'#fff',borderRadius:5,padding:5,textAlign:'center'}}>Open Anyway</div></div></div><div style={{padding:22,display:'grid',placeItems:'center',fontSize:10,textAlign:'center',color:'#555'}}>Confirm with your Mac password or Touch ID when prompted.</div></div>}
              </div>;
              return <div role="presentation" onClick={()=>setInstallationGuide(null)} style={{position:'fixed',inset:0,zIndex:3000,display:'grid',placeItems:'center',padding:12,background:'rgba(3,8,16,.78)',backdropFilter:'blur(9px)'}}>
                <section role="dialog" aria-modal="true" aria-labelledby="installation-guide-title" onClick={event=>event.stopPropagation()} style={{width:'min(100%,760px)',maxHeight:'min(92vh,900px)',overflowY:'auto',padding:'clamp(15px,3vw,25px)',border:'1px solid var(--crm-border,#3b4657)',borderRadius:16,background:'var(--crm-panel-bg,#171d29)',color:'var(--crm-text,#e5e7eb)',boxShadow:'0 28px 90px rgba(0,0,0,.5)'}}>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:14}}>
                    <div><div style={{fontSize:10,fontWeight:800,letterSpacing:'.15em',textTransform:'uppercase',color:'var(--crm-accent)'}}>STEP-BY-STEP SETUP</div><h2 id="installation-guide-title" style={{margin:'5px 0 4px',fontSize:22}}>{installationGuide==='ios'?'Install on iPhone or iPad':'Install on macOS'}</h2><p style={{margin:0,fontSize:12,color:'var(--crm-muted)'}}>{installationGuide==='ios'?'Configuration profile · Home Screen Web Clip':'Universal DMG · Apple Silicon and Intel'}</p></div>
                    <button type="button" aria-label="Close installation instructions" onClick={()=>setInstallationGuide(null)} style={{width:36,height:36,flexShrink:0,borderRadius:9,border:'1px solid var(--crm-border)',background:'transparent',color:'var(--crm-text)',fontSize:20,cursor:'pointer'}}>×</button>
                  </div>
                  <div style={{display:'flex',gap:5,margin:'18px 0 7px'}}>{steps.map((s,i)=><div key={s.title} style={{height:4,flex:1,borderRadius:8,background:i<=installationStep?'var(--crm-accent)':'var(--crm-border)'}}/>)}</div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--crm-muted)',marginBottom:15}}><span>Step {installationStep+1} of {steps.length}</span><span>{Math.round((installationStep+1)/steps.length*100)}% complete</span></div>
                  <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1.1fr)',gap:20,alignItems:'center'}}>
                    <div style={{minWidth:0}}>{installationGuide==='ios'?iosMock:macMock}</div>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:10,fontWeight:800,letterSpacing:'.1em',color:'var(--crm-accent)',textTransform:'uppercase'}}>Step {installationStep+1}</div>
                      <h3 style={{fontSize:19,lineHeight:1.25,margin:'7px 0'}}>{step.title}</h3>
                      <p style={{fontSize:12,color:'var(--crm-muted)',lineHeight:1.5,margin:'0 0 12px'}}>{step.subtitle}</p>
                      <p style={{fontSize:13,lineHeight:1.65,margin:'0 0 13px'}}>{step.detail}</p>
                      <div style={{padding:'10px 12px',borderRadius:9,border:'1px solid var(--crm-border)',background:'var(--crm-card-bg)',fontSize:12,fontWeight:750,lineHeight:1.5}}><span style={{color:'var(--crm-accent)',marginRight:6}}>ACTION</span>{step.action}</div>
                      <div style={{marginTop:10,padding:'9px 11px',borderRadius:8,background:'var(--crm-accent-soft)',fontSize:11,lineHeight:1.55,color:'var(--crm-muted)'}}><strong style={{color:'var(--crm-text)'}}>If you don't see this:</strong> {step.hint}</div>
                    </div>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',gap:10,marginTop:20,paddingTop:15,borderTop:'1px solid var(--crm-border)'}}>
                    <button type="button" disabled={installationStep===0} onClick={()=>setInstallationStep(s=>Math.max(0,s-1))} style={{padding:'10px 16px',borderRadius:8,border:'1px solid var(--crm-border)',background:'transparent',color:'var(--crm-text)',opacity:installationStep===0?.4:1,cursor:installationStep===0?'default':'pointer'}}>← Previous</button>
                    {installationStep<steps.length-1?<button type="button" onClick={()=>setInstallationStep(s=>Math.min(steps.length-1,s+1))} style={{padding:'10px 18px',border:0,borderRadius:8,background:'var(--crm-accent)',color:'#111827',fontWeight:800,cursor:'pointer'}}>Next step →</button>:<button type="button" onClick={()=>setInstallationGuide(null)} style={{padding:'10px 18px',border:0,borderRadius:8,background:'var(--crm-accent)',color:'#111827',fontWeight:800,cursor:'pointer'}}>Finish</button>}
                  </div>
                  <p style={{fontSize:10,lineHeight:1.5,color:'var(--crm-muted)',margin:'12px 0 0'}}>Interface previews are visual guides. Apple may adjust labels or screen layout between iOS and macOS releases. The steps above describe the current MBP Attendance profile and installer flow.</p>
                </section>
              </div>;
            })()}
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
              <label className="crm-settings-toggle"><span><span><strong>Glassy appearance</strong><small>Use translucent frosted-glass panels and softer depth while keeping your selected day or night theme.</small></span></span><input type="checkbox" checked={preferences.glassy} onChange={event=>updatePreference('glassy',event.target.checked)}/></label>
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
              <div><h2>Reset preferences</h2><p>Restore night mode, orange accent, standard surfaces, and default display options.</p></div>
              <button type="button" onClick={()=>{setPreferences({...DEFAULT_PREFERENCES});try{localStorage.setItem('mbp_crm_preferences',JSON.stringify(DEFAULT_PREFERENCES));}catch{}setSettingsNotice('Default preferences restored.');}}><RotateCcw size={16}/> Restore defaults</button>
            </section>
            {settingsNotice && <p className="crm-settings-notice" role="status">{settingsNotice}</p>}
          </>}
          {activePage === 'dashboard' && <>
{!canViewAdmin && <section
            style={{ padding: '28px 18px', margin: '20px 0', borderRadius: 14, border: '1px solid #34302c', background: 'radial-gradient(circle at 50% 28%, #25201a 0%, #151413 58%, #101010 100%)', textAlign: 'center' }}
          >
            <div style={{ color: openRecord ? '#86efac' : 'var(--crm-accent)', fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase' }}>{openRecord ? 'SHIFT IN PROGRESS' : 'ATTENDANCE'}</div>
            <h2 style={{ margin: '8px 0 4px', fontSize: 22 }}>{openRecord ? 'You are active on your shift' : 'Ready to start your shift?'}</h2>
            <p style={{ color: '#b7c0d1', margin: '0 auto 22px', maxWidth: 420, fontSize: 13 }}>{openRecord ? 'Your attendance is being recorded. Your live session timer is shown below.' : 'Check in when you begin work.'}</p>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', position: 'relative' }}>
              {showAttendanceLocationNotice && <div role="alert" style={{ position: 'absolute', zIndex: 7, bottom: 'calc(100% + 14px)', left: '50%', transform: 'translateX(-50%)', width: 'min(360px, calc(100vw - 40px))', padding: '13px 15px', borderRadius: 12, background: preferences.theme === 'day' ? '#ffffff' : '#202b3e', color: preferences.theme === 'day' ? '#24344a' : '#edf3fc', border: '1px solid #d97706', boxShadow: '0 12px 34px rgba(0,0,0,.38)', textAlign: 'left' }}>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{message}</div>
                <button type="button" onClick={() => { setShowAttendanceLocationNotice(false); setMessage(''); if (openRecord && normalizedRole === 'manager') void beginManagerCheckout(openRecord.id); }} style={{ display: 'block', marginTop: 10, padding: '9px 12px', border: 0, borderRadius: 8, background: 'var(--crm-accent-strong)', color: '#fff', fontWeight: 700, cursor: 'pointer', width: '100%' }}>Retry check-out</button>
                <button type="button" aria-label="Dismiss location notice" onClick={() => { setShowAttendanceLocationNotice(false); setMessage(''); }} style={{ position: 'absolute', top: 5, right: 7, border: 0, background: 'transparent', color: 'inherit', fontSize: 18, cursor: 'pointer' }}>×</button>
              </div>}
              {showCorrectionShortcut && <div role="alert" style={{ position: 'absolute', zIndex: 5, bottom: 'calc(100% + 14px)', left: '50%', transform: 'translateX(-50%)', width: 'min(340px, calc(100vw - 44px))', padding: '13px 14px', borderRadius: 12, background: preferences.theme === 'day' ? '#ffffff' : '#202b3e', color: preferences.theme === 'day' ? '#24344a' : '#edf3fc', border: '1px solid var(--crm-accent)', boxShadow: '0 12px 34px rgba(0,0,0,.35)', textAlign: 'left' }}>
                <div style={{ fontSize: 13, lineHeight: 1.45 }}>{message}</div>
                <button type="button" onClick={()=>{setMessage('');setWorkforceInitialTab('corrections');setActivePage('workforce-operations');setShowCorrectionShortcut(false);window.scrollTo(0,0);}} style={{display:'block',marginTop:10,padding:'9px 12px',border:0,borderRadius:8,background:'var(--crm-accent-strong)',color:'#fff',fontWeight:700,cursor:'pointer',width:'100%'}}>Open Attendance Corrections</button>
                <button type="button" aria-label="Dismiss notification" onClick={()=>{setShowCorrectionShortcut(false);setMessage('');}} style={{position:'absolute',top:5,right:7,border:0,background:'transparent',color:'inherit',fontSize:18,cursor:'pointer'}}>×</button>
              </div>}
              <button type="button" aria-label={openRecord ? 'Hold to stop shift' : 'Check in and start shift'} disabled={busy || loadingDashboard}
                onClick={() => { if (!openRecord) void beginCheckInAttempt(); else if (normalizedRole === 'manager') void beginManagerCheckout(openRecord.id); }}
                onPointerDown={() => { if (openRecord && normalizedRole !== 'manager') beginStopHold(openRecord.id); }}
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
            </> : <div style={{ minHeight: 24, marginTop: 16, color: '#9ca3af', fontSize: 12 }}>Your shift timer will start after successful check-in.</div>}
            <KnowMore>Location permission is required when starting and stopping a shift. If your device cannot provide a location fix, the attendance action will not be recorded.</KnowMore>
          </section>}

          {!canViewAdmin && (
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
              <div style={{ marginTop: 5, fontSize: 12, color: preferences.theme === 'day' ? '#667085' : '#b7c0d1' }}>
                Manually adjusted: <strong>{salaryManualAdjustmentMinutes < 0 ? '−' : '+'}{formatDuration(Math.abs(salaryManualAdjustmentMinutes) * 60000)}</strong>
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
          {(isAdmin || isSupervisor || canManageTeam) && ['team','manager-hierarchy','team-roles','team-links','team-assignments','team-invitations'].includes(activePage) && <ManagementTools supabase={supabase} profile={profile} profiles={profiles} page={activePage as 'team' | 'team-roles' | 'team-links' | 'team-assignments' | 'team-invitations'} />}
          {canUseHumanTelegram && activePage === 'telegram-human' && <ManagementTools key={telegramHumanNavKey} supabase={supabase} profile={profile} profiles={profiles} page="telegram-human" />}
          {(isAdmin || canManageTeam) && activePage === 'telegram-analytics' && <ManagementTools supabase={supabase} profile={profile} profiles={profiles} page="telegram-analytics" />}
          {isAdmin && activePage === 'security' && <><SecurityActivityPanel />{supabase && <DeviceSecurityMonitoring supabase={supabase} />}</>}

          {!canViewAdmin && !activePage.startsWith('team-') && activePage !== 'team' && <section style={{ marginTop: 28 }}>
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

          {activePage === 'manager-hierarchy' && (isAdmin || isSupervisor || canManageTeam) && <ManagerHierarchy profile={profile} profiles={profiles} assignments={managerAssignments} attendance={attendance} shifts={shifts} telegramMembers={telegramMembers} telegramMetrics={telegramResponseMetrics} isAdmin={isAdmin} />}
          {activePage === 'workforce-operations' && <WorkforceOperations key={activePage==='workforce-operations'?workforceInitialTab:'workforce-default'} initialTab={workforceInitialTab} profile={profile} profiles={profiles} isAdmin={isAdmin} isSupervisor={isSupervisor} attendance={attendance} shifts={shifts} />}
          {activePage === 'team-attendance' && (canViewAdmin || canManageTeam) && <TeamAttendanceReport attendance={attendance} shifts={shifts} profiles={profiles} assignments={managerAssignments} telegramMembers={telegramMembers} telegramMetrics={telegramResponseMetrics} approvedLeave={approvedLeave} holidays={workforceHolidays} loading={loadingDashboard} />}
          {activePage === 'attendance-records' && <>
          <section style={{ marginTop: 28 }}>
            <h2>{canViewAdmin ? 'Attendance records' : 'My attendance records'}</h2>
            <p style={{ color: '#b7c0d1' }}>
              {canViewAdmin ? 'Filter the latest team attendance records by employee and date.' : 'Filter the attendance records currently loaded for your account. This report uses the latest 100 records available to this dashboard.'}
            </p>
            {canViewAdmin && (
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

            {(canViewAdmin || canManageTeam) && (() => {
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
              const topLevelRoles = new Set(['supervisor', 'team_leader', 'senior', 'telemarketing']);
              const topLevelPeople = canViewAdmin
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
              if (canViewAdmin && selectedEmployeeId !== 'all') {
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
                      // The attendance capsule represents the latest applied correction for this employee/day.
                      // Sort by the actual correction timestamp, not array order or a stale corrected flag.
                      const record = [...records].sort((a, b) => {
                        const aCorrected = a.manually_adjusted === true || Number(a.manual_adjustment_minutes ?? 0) !== 0;
                        const bCorrected = b.manually_adjusted === true || Number(b.manual_adjustment_minutes ?? 0) !== 0;
                        if (aCorrected !== bCorrected) return aCorrected ? -1 : 1;
                        const aTime = a.manual_adjusted_at || a.check_in;
                        const bTime = b.manual_adjusted_at || b.check_in;
                        return bTime.localeCompare(aTime);
                      })[0];
                      const completed = Boolean(record?.check_out);
                      const present = Boolean(record);
                      const manuallyAdjusted = Boolean(record && (record.manually_adjusted === true || Number(record.manual_adjustment_minutes ?? 0) !== 0));
                      const manualInChanged = manuallyAdjusted && (record?.manual_check_in_changed ?? manuallyAdjusted);
                      const manualOutChanged = manuallyAdjusted && (record?.manual_check_out_changed ?? manuallyAdjusted);
                      const bg = !present ? '#541b20' : completed ? '#153c2a' : '#4b2d10';
                      const fg = !present ? '#ffb4b4' : completed ? '#8ce2ae' : '#ffd18a';
                      return <td key={date} style={{padding:6,borderBottom:'1px solid var(--crm-border)',textAlign:'center',minWidth:154}}>
                        <div title={!present?'Absent':completed?'Signed in and out': 'Signed in; not signed out'} style={{display:'inline-flex',alignItems:'stretch',justifyContent:'space-between',gap:8,padding:'7px 9px',width:142,minWidth:142,minHeight:54,boxSizing:'border-box',background:bg,color:fg,border:'1px solid '+(!present?'#8b2d35':completed?'#286947':'#8a5318'),borderRadius:4,fontSize:12,fontWeight:700,textAlign:'left',position:'relative'}}>
                          {!present ? <span style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%'}}>Absent</span> : <>
                            {canViewAdmin ? <>
                              <span style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:4,lineHeight:1.2}}>
                                <span>IN&nbsp; {timeOnly(record.check_in,record.work_timezone)}{manualInChanged && <small title="Check-in time was manually corrected" style={{marginLeft:4,fontWeight:900,color:'#fef0c7'}}>(M)</small>}</span>
                                <span>OUT {timeOnly(record.check_out,record.work_timezone)}{manualOutChanged && <small title="Check-out time was manually corrected" style={{marginLeft:4,fontWeight:900,color:'#fef0c7'}}>(M)</small>}</span>
                              </span>
                              <span style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:5,flexShrink:0}}>
                                {gpsButton(record.check_in_lat,record.check_in_lng,'Check-in location')}
                                {gpsButton(record.check_out_lat,record.check_out_lng,'Check-out location')}
                              </span>
                            </> : <span style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:4,lineHeight:1.2}}>
                              <span>IN&nbsp; {timeOnly(record.check_in,record.work_timezone)}{manualInChanged && <small title="Check-in time was manually corrected" style={{marginLeft:4,fontWeight:900,color:'#fef0c7'}}>(M)</small>}</span>
                              <span>OUT {timeOnly(record.check_out,record.work_timezone)}{manualOutChanged && <small title="Check-out time was manually corrected" style={{marginLeft:4,fontWeight:900,color:'#fef0c7'}}>(M)</small>}</span>
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
            {!canViewAdmin && !canManageTeam && reportAttendance.map((item) => {
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
                    Work date: {item.work_date ?? 'Not assigned'} {item.manually_adjusted && <strong title="Manually adjusted">(M)</strong>}
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
                    Worked time: {duration.worked}{(item.manual_adjustment_minutes ?? 0) !== 0 && <small style={{marginLeft:7,color:'#b7c0d1'}}>({item.manual_adjustment_minutes! > 0 ? '+' : '−'}{formatDuration(Math.abs(item.manual_adjustment_minutes!)*60000)} manually adjusted)</small>}
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

                  {canViewAdmin && (
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
          className="crm-status-notice"
          role="status"
          style={{
            maxWidth: 760,
            margin: '12px auto',
            padding: 12,
            borderRadius: 8,
            background: preferences.theme === 'day' ? 'rgba(255,255,255,.78)' : 'rgba(32,43,62,.72)',
            color: preferences.theme === 'day' ? '#24344a' : '#edf3fc',
            border: preferences.theme === 'day' ? '1px solid rgba(115,137,165,.35)' : '1px solid rgba(150,170,200,.22)',
            overflowWrap: 'anywhere',
          }}
        >
          {!showCorrectionShortcut && !showAttendanceLocationNotice && !message.toLowerCase().includes('already checked out for today') && message}
        </p>
      )}

      {screen === 'login' && (
        <p
          style={{
            maxWidth: 760,
            margin: '20px auto',
            color: '#98a2b3',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          Authorized accounts only. Contact your manager in case you do not have access.
        </p>
      )}
    </main>
  );
}