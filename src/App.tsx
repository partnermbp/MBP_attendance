
import { useCallback, useEffect, useState } from 'react';
import { Menu, X, MapPin, LayoutDashboard, Users, CalendarDays, MessageCircle } from 'lucide-react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
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

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  active: boolean;
};

type Screen = 'loading' | 'login' | 'set-password' | 'signed-in';
type CrmPage = 'dashboard' | 'attendance' | 'team' | 'telegram';
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

export default function App() {
  const [passwordFlow, setPasswordFlow] =
    useState<PasswordFlow>(readPasswordFlow);
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
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('all');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [telegramLinkUrl, setTelegramLinkUrl] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClockNow(Date.now());
    }, 30000);

    return () => window.clearInterval(interval);
  }, []);

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

      const currentProfile = profileResult.data as Profile | null;
      setProfile(currentProfile);
      const isAdmin = currentProfile?.active === true &&
        String(currentProfile.role).toLowerCase() === 'admin';

      if (isAdmin) {
        const [peopleResult, attendanceResult] = await Promise.all([
          supabase.from('profiles')
            .select('id, email, full_name, role, active')
            .order('full_name', { ascending: true })
            .limit(500),
          supabase.from('attendance')
            .select('id, employee_id, check_in, check_out, check_in_lat, check_in_lng, check_out_lat, check_out_lng, work_date, work_timezone')
            .order('check_in', { ascending: false })
            .limit(1000),
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
        setShifts([]);
      } else {
        setProfiles([]);
        const [attendanceResult, shiftsResult] = await Promise.all([
          supabase.from('attendance')
            .select('id, check_in, check_out, check_in_lat, check_in_lng, check_out_lat, check_out_lng, work_date, work_timezone')
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
  }, []);

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
    background: '#101522',
    color: '#f4f6fb',
    fontFamily: 'system-ui, sans-serif',
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
    borderRadius: 16,
    border: '1px solid #344054',
    background: '#1a2232',
  };

  const inputStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    marginTop: 7,
    padding: 12,
    border: '1px solid #475467',
    borderRadius: 8,
    background: '#101522',
    color: '#fff',
    fontSize: 16,
  };

  const buttonStyle: React.CSSProperties = {
    padding: '12px 16px',
    border: 0,
    borderRadius: 8,
    background: '#315ee7',
    color: '#fff',
    fontSize: 15,
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.7 : 1,
  };

  // Only today's open session in its own saved timezone is the active session.
  // Older open sessions remain in history and are not automatically checked out.
  const isAdmin = profile?.active === true && String(profile.role).toLowerCase() === 'admin';
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
      <header style={{ maxWidth: 1440, margin: '0 auto' }}>
        <p style={{ color: '#82b4ff', fontWeight: 700 }}>ATTENDANCE CRM</p>
      </header>

      {screen === 'loading' && (
        <section style={panelStyle}>Checking your session…</section>
      )}

      {screen === 'login' && (
        <section style={{ ...panelStyle, maxWidth: 430 }}>
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
        <div style={{display:'grid',gridTemplateColumns:navOpen?'250px minmax(0,1fr)':'64px minmax(0,1fr)',gap:18,alignItems:'start',width:'100%',maxWidth:1600,margin:'0 auto'}}>
          <aside style={{position:'sticky',top:12,alignSelf:'start',minHeight:'calc(100vh - 24px)',padding:12,background:'#151e30',border:'1px solid #344054',borderRadius:14,color:'#dce4f2'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:navOpen?'space-between':'center',gap:8,marginBottom:20,color:'#fff',fontWeight:700}}>{navOpen&&<span>Partner CRM</span>}<button type="button" aria-label="Toggle sidebar" onClick={()=>setNavOpen(v=>!v)} style={{display:'grid',placeItems:'center',width:40,height:40,border:'1px solid #344054',borderRadius:9,background:'#202b3e',color:'#fff',cursor:'pointer'}}>{navOpen?<X size={20}/>:<Menu size={20}/>}</button></div>
            <nav aria-label="CRM pages" style={{display:'flex',flexDirection:'column',gap:6}}>
              {[{label:'Dashboard',icon:<LayoutDashboard size={18}/>,id:'dashboard' as CrmPage},{label:'Attendance & reports',icon:<CalendarDays size={18}/>,id:'attendance' as CrmPage},{label:'Team management',icon:<Users size={18}/>,id:'team' as CrmPage},{label:'Telegram chats & analytics',icon:<MessageCircle size={18}/>,id:'telegram' as CrmPage}].filter(item=>item.id==='dashboard'||String(profile?.role).toLowerCase()==='admin'||String(profile?.role).toLowerCase()==='manager').map(item=><button key={item.id} type="button" title={item.label} onClick={()=>{setActivePage(item.id);window.scrollTo(0,0)}} style={{display:'flex',alignItems:'center',justifyContent:navOpen?'flex-start':'center',gap:12,width:'100%',padding:12,textAlign:'left',border:0,borderRadius:9,background:activePage===item.id?'#344054':'transparent',color:activePage===item.id?'#fff':'#cbd5e1',cursor:'pointer'}}>{item.icon}{navOpen&&item.label}</button>)}
            </nav>
            {navOpen&&<div style={{marginTop:30,color:'#98a2b3',fontSize:12,overflowWrap:'anywhere'}}>{profile?.full_name||session.user.email}</div>}
          </aside>
          <main style={{minWidth:0}}>
          <section style={panelStyle}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:18,color:'#98a2b3',fontSize:13}}>Partner CRM / <strong style={{color:'#fff'}}>{{dashboard:'Dashboard',attendance:'Attendance & reports',team:'Team management',telegram:'Telegram chats & analytics'}[activePage]}</strong></div>
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
              borderRadius: 12,
              border: '1px solid #344054',
            }}
          >
            <h2 style={{ marginTop: 0 }}>Telegram account</h2>
            <p style={{ color: '#b7c0d1' }}>
              Link Telegram to receive login codes there. Once linked, you can use
              Telegram login from the sign-in screen as an alternative to your password.
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
                    borderRadius: 8,
                    background: '#229ED9',
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
          {(String(profile?.role).toLowerCase() === 'admin' || String(profile?.role).toLowerCase() === 'manager') && activePage === 'team' && <ManagementTools supabase={supabase} profile={profile} profiles={profiles} page="team" />}
          {(String(profile?.role).toLowerCase() === 'admin' || String(profile?.role).toLowerCase() === 'manager') && activePage === 'telegram' && <ManagementTools supabase={supabase} profile={profile} profiles={profiles} page="telegram" />}

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
                  value={reportStartDate}
                  max={reportEndDate || undefined}
                  onChange={(event) => setReportStartDate(event.target.value)}
                  style={inputStyle}
                />
              </label>
              <label>
                To date
                <input
                  aria-label="Report end date"
                  type="date"
                  min={reportStartDate || undefined}
                  value={reportEndDate}
                  onChange={(event) => setReportEndDate(event.target.value)}
                  style={inputStyle}
                />
              </label>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
              <button type="button" style={{ ...buttonStyle, background: '#475467' }} onClick={() => { setReportStartDate(''); setReportEndDate(''); }}>
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

            {isAdmin && (
              <div style={{ overflowX: 'auto', border: '1px solid #344054', borderRadius: 10, marginTop: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980, textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#202b3e' }}>
                      {['Employee', 'Work date', 'Check-in', 'Check-out', 'Status', 'Check-in GPS', 'Check-out GPS'].map(label => (
                        <th key={label} style={{ padding: 12, borderBottom: '1px solid #344054', fontSize: 13 }}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reportAttendance.map(item => {
                      const person = profiles.find(p => p.id === item.employee_id);
                      const date = item.work_date ?? item.check_in.slice(0, 10);
                      return (
                        <tr key={item.id}>
                          <td style={{ padding: 12, borderBottom: '1px solid #344054' }}>{person?.full_name || person?.email || item.employee_id || 'Unknown employee'}</td>
                          <td style={{ padding: 12, borderBottom: '1px solid #344054', whiteSpace: 'nowrap' }}>{date}</td>
                          <td style={{ padding: 12, borderBottom: '1px solid #344054', whiteSpace: 'nowrap' }}>{formatDate(item.check_in, item.work_timezone)}</td>
                          <td style={{ padding: 12, borderBottom: '1px solid #344054', whiteSpace: 'nowrap' }}>{item.check_out ? formatDate(item.check_out, item.work_timezone) : '—'}</td>
                          <td style={{ padding: 12, borderBottom: '1px solid #344054' }}>
                            <span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: 20, background: item.check_out ? '#173c2b' : '#4a3513', color: item.check_out ? '#8ce2ae' : '#ffd18a', fontSize: 12, fontWeight: 700 }}>
                              {item.check_out ? 'Checked out' : 'Present · open'}
                            </span>
                          </td>
                          <td style={{ padding: 12, borderBottom: '1px solid #344054', whiteSpace: 'nowrap' }}>{item.check_in_lat != null && item.check_in_lng != null ? <button type="button" onClick={() => setMapPreview({ title: 'Check-in location', latitude: item.check_in_lat!, longitude: item.check_in_lng! })} style={{ color: '#82b4ff', background: 'transparent', border: 0, cursor: 'pointer', textDecoration: 'underline' }}><MapPin size={14} style={{ verticalAlign: 'middle' }} /> View map</button> : '—'}</td>
                          <td style={{ padding: 12, borderBottom: '1px solid #344054', whiteSpace: 'nowrap' }}>{item.check_out_lat != null && item.check_out_lng != null ? <button type="button" onClick={() => setMapPreview({ title: 'Check-out location', latitude: item.check_out_lat!, longitude: item.check_out_lng! })} style={{ color: '#82b4ff', background: 'transparent', border: 0, cursor: 'pointer', textDecoration: 'underline' }}><MapPin size={14} style={{ verticalAlign: 'middle' }} /> View map</button> : '—'}</td>
                        </tr>
                      );
                    })}
                    {!loadingDashboard && reportAttendance.length === 0 && (
                      <tr><td colSpan={7} style={{ padding: 20, color: '#b7c0d1', textAlign: 'center' }}>No attendance records match this filter.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

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

                  <p style={{ margin: '0 0 6px' }}>
                    Check-in:{' '}
                    {formatDate(item.check_in, item.work_timezone)}
                  </p>

                  <p style={{ margin: '0 0 6px' }}>
                    Check-out:{' '}
                    {item.check_out
                      ? formatDate(item.check_out, item.work_timezone)
                      : 'Not checked out'}
                  </p>

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

          <div
            style={{
              marginTop: 28,
              borderTop: '1px solid #344054',
              paddingTop: 20,
            }}
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleLogout()}
              style={buttonStyle}
            >
              {busy ? 'Please wait…' : 'Sign out'}
            </button>
          </div>
          </>}
        </section>
          </main>
        </div>
      )}

      {mapPreview && <div role="dialog" aria-modal="true" aria-label={mapPreview.title} onClick={() => setMapPreview(null)} style={{position:'fixed',inset:0,zIndex:100,display:'grid',placeItems:'center',padding:18,background:'#0009'}}><section onClick={e=>e.stopPropagation()} style={{width:'min(760px,100%)',background:'#151e30',color:'#f8fafc',border:'1px solid #475467',borderRadius:14,overflow:'hidden',boxShadow:'0 20px 70px #0008'}}><header style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 18px'}}><strong>{mapPreview.title}</strong><button type="button" onClick={()=>setMapPreview(null)} aria-label="Close map" style={{background:'transparent',border:0,color:'#fff',cursor:'pointer'}}><X/></button></header><iframe title={mapPreview.title} src={`https://www.openstreetmap.org/export/embed.html?marker=${mapPreview.latitude}%2C${mapPreview.longitude}&zoom=16`} style={{width:'100%',height:420,border:0,display:'block'}} loading="lazy"/><p style={{margin:0,padding:'10px 18px',color:'#b7c0d1',fontSize:12}}>Coordinates: {mapPreview.latitude.toFixed(5)}, {mapPreview.longitude.toFixed(5)}</p></section></div>}
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
