
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

type Attendance = {
  id: string;
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

type Screen = 'loading' | 'login' | 'set-password' | 'signed-in';
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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [locationTest, setLocationTest] = useState('');
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
      const [attendanceResult, shiftsResult] = await Promise.all([
        supabase
          .from('attendance')
          .select(
            'id, check_in, check_out, check_in_lat, check_in_lng, check_out_lat, check_out_lng, work_date, work_timezone'
          )
          .eq('employee_id', userId)
          .order('check_in', { ascending: false })
          .limit(100),

        supabase
          .from('shifts')
          .select('id, starts_at, ends_at')
          .eq('employee_id', userId)
          .order('starts_at', { ascending: true })
          .limit(100),
      ]);

      if (attendanceResult.error) {
        setMessage(
          `Could not load attendance: ${attendanceResult.error.message}`
        );
      } else {
        setAttendance((attendanceResult.data ?? []) as Attendance[]);
      }

      if (shiftsResult.error) {
        setMessage((current) =>
          current || `Could not load shifts: ${shiftsResult.error.message}`
        );
      } else {
        setShifts((shiftsResult.data ?? []) as Shift[]);
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

  async function handleLogout() {
    if (!supabase) return;

    setBusy(true);
    setMessage('');

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        setMessage(error.message);
      } else {
        setSession(null);
        setAttendance([]);
        setShifts([]);
        setTelegramLinkUrl('');
        setScreen('login');
        setMessage('You have been signed out.');
      }
    } catch {
      setMessage('Unable to sign out. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTelegramLink() {
    if (!supabase || !session) {
      setMessage('Please sign in before linking your Telegram account.');
      return;
    }

    setBusy(true);
    setMessage('');
    setTelegramLinkUrl('');

    try {
      const { data, error } = await supabase.functions.invoke(
        'telegram-auth',
        {
          body: { action: 'create_link_token' },
        }
      );

      if (error) {
        setMessage(
          `Could not create a Telegram linking link: ${
            error.message || 'The request failed.'
          }`
        );
        return;
      }

      if (!data?.ok || !data?.bot_url) {
        setMessage(
          data?.message ||
            'The Telegram linking link could not be created. Please try again.'
        );
        return;
      }

      setTelegramLinkUrl(data.bot_url);
      setMessage(
        'Your temporary Telegram linking link is ready. Open it in Telegram within 10 minutes.'
      );
    } catch (error) {
      setMessage(
        `Could not create a Telegram linking link: ${getErrorMessage(error)}`
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleTestLocation() {
    setLocationTest('');
    setMessage('');

    try {
      const coordinates = await getLocation();

      setLocationTest(
        `Location permission works. Latitude: ${coordinates.latitude.toFixed(
          5
        )}, longitude: ${coordinates.longitude.toFixed(5)}.`
      );
    } catch (error) {
      setLocationTest(getErrorMessage(error));
    }
  }

  async function resolveTimezone(coordinates: Coordinates) {
    if (!supabase) {
      throw new Error('Supabase is not configured.');
    }

    const { data, error } = await supabase.functions.invoke(
      'resolve-timezone',
      {
        body: {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        },
      }
    );

    if (error) {
      throw new Error(
        `Could not determine your timezone: ${error.message}`
      );
    }

    if (!data?.timezone || typeof data.timezone !== 'string') {
      throw new Error(
        data?.message || 'The timezone service returned no timezone.'
      );
    }

    return data.timezone as string;
  }

  async function handleCheckIn() {
    if (!supabase || !session) return;

    setBusy(true);
    setMessage('');

    try {
      const coordinates = await getLocation();
      const timezone = await resolveTimezone(coordinates);

      const { error } = await supabase.rpc('check_in_with_timezone', {
        p_latitude: coordinates.latitude,
        p_longitude: coordinates.longitude,
        p_timezone: timezone,
      });

      if (error) {
        setMessage(`Check-in failed: ${error.message}`);
        return;
      }

      setMessage('Check-in recorded successfully.');
      await loadDashboard(session.user.id);
    } catch (error) {
      setMessage(`Check-in failed: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckOut(item: Attendance) {
    if (!supabase || !session) return;

    setBusy(true);
    setMessage('');

    try {
      const coordinates = await getLocation();

      const { error } = await supabase.rpc('check_out_attendance', {
        p_attendance_id: item.id,
        p_latitude: coordinates.latitude,
        p_longitude: coordinates.longitude,
      });

      if (error) {
        setMessage(`Check-out failed: ${error.message}`);
        return;
      }

      setMessage('Check-out recorded successfully.');
      await loadDashboard(session.user.id);
    } catch (error) {
      setMessage(`Check-out failed: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const openAttendance = attendance.filter((item) => !item.check_out);
  const completedAttendance = attendance.filter((item) => item.check_out);

  if (screen === 'loading') {
    return (
      <main className="app-shell">
        <section className="panel">
          <p>Loading your account…</p>
        </section>
      </main>
    );
  }

  if (!supabase) {
    return (
      <main className="app-shell">
        <section className="panel">
          <h1>MBP Attendance</h1>
          <p>
            Supabase is not configured. Check the GitHub repository secrets
            and the frontend build configuration.
          </p>
        </section>
      </main>
    );
  }

  if (screen === 'set-password') {
    return (
      <main className="app-shell">
        <section className="panel auth-panel">
          <div className="brand-mark">MBP</div>
          <h1>Create your password</h1>
          <p>
            Set a password for your approved work account to finish setting
            up your attendance account.
          </p>

          <form onSubmit={handleSetPassword}>
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />

            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
            />

            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save password'}
            </button>
          </form>

          {message && <p className="notice">{message}</p>}
        </section>
      </main>
    );
  }

  if (screen === 'login') {
    return (
      <main className="app-shell">
        <section className="panel auth-panel">
          <div className="brand-mark">MBP</div>
          <h1>MBP Attendance</h1>
          <p>Sign in with your approved work email and password.</p>

          <form onSubmit={handleLogin}>
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
            />

            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />

            <button type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {message && <p className="notice">{message}</p>}

          <p className="muted">
            If you have not received an invitation, contact your administrator.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-mark small">MBP</div>
          <h1>Attendance</h1>
          <p className="muted">{session?.user.email}</p>
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={handleLogout}
          disabled={busy}
        >
          Sign out
        </button>
      </header>

      {message && <p className="notice">{message}</p>}

      <section className="panel">
        <h2>Today's attendance</h2>
        <p className="muted">
          Check-in and check-out require location permission. Your location
          is collected when you perform these actions.
        </p>

        <div className="button-row">
          <button type="button" onClick={handleCheckIn} disabled={busy}>
            {busy ? 'Please wait…' : 'Check in'}
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={handleTestLocation}
            disabled={busy}
          >
            Test location permission
          </button>
        </div>

        {locationTest && <p className="notice">{locationTest}</p>}
      </section>

      <section className="panel">
        <h2>Telegram account</h2>
        <p className="muted">
          Link your Telegram account for future login-code features. Your
          current password login remains unchanged.
        </p>

        <button
          type="button"
          onClick={handleCreateTelegramLink}
          disabled={busy || !session}
        >
          {busy ? 'Please wait…' : 'Create Telegram linking link'}
        </button>

        {telegramLinkUrl && (
          <p>
            <a href={telegramLinkUrl} target="_blank" rel="noreferrer">
              Open Telegram to link account
            </a>
          </p>
        )}

        <p className="muted">
          This link contains a temporary, one-time token. Do not share it
          with anyone. If it expires, create a new one.
        </p>
      </section>

      <section className="panel">
        <h2>Open attendance sessions</h2>

        {loadingDashboard ? (
          <p>Loading attendance…</p>
        ) : openAttendance.length === 0 ? (
          <p className="muted">There are no open sessions.</p>
        ) : (
          <div className="record-list">
            {openAttendance.map((item) => {
              const duration = getSessionDuration(item, clockNow);

              return (
                <article className="record" key={item.id}>
                  <div className="record-header">
                    <strong>
                      {item.work_date || 'Work date unavailable'}
                    </strong>
                    <span className="status-pill open">
                      {duration.status}
                    </span>
                  </div>

                  <p>
                    <strong>Check-in:</strong>{' '}
                    {formatDate(item.check_in, item.work_timezone)}
                  </p>

                  <p>
                    <strong>Timezone:</strong>{' '}
                    {item.work_timezone || 'Not recorded'}
                  </p>

                  <p>
                    <strong>Elapsed time:</strong> {duration.elapsed}
                  </p>

                  <p>
                    <strong>Worked time:</strong> {duration.worked}
                  </p>

                  <button
                    type="button"
                    onClick={() => handleCheckOut(item)}
                    disabled={busy}
                  >
                    {busy ? 'Please wait…' : 'Check out'}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Completed attendance</h2>
        <p className="muted">
          Completed sessions deduct a fixed one-hour break, up to the total
          elapsed session time. Open sessions do not receive a break deduction
          until checkout.
        </p>

        {loadingDashboard ? (
          <p>Loading attendance…</p>
        ) : completedAttendance.length === 0 ? (
          <p className="muted">No completed sessions yet.</p>
        ) : (
          <div className="record-list">
            {completedAttendance.map((item) => {
              const duration = getSessionDuration(item, clockNow);

              return (
                <article className="record" key={item.id}>
                  <div className="record-header">
                    <strong>
                      {item.work_date || 'Work date unavailable'}
                    </strong>
                    <span className="status-pill completed">
                      {duration.status}
                    </span>
                  </div>

                  <p>
                    <strong>Check-in:</strong>{' '}
                    {formatDate(item.check_in, item.work_timezone)}
                  </p>

                  <p>
                    <strong>Check-out:</strong>{' '}
                    {item.check_out
                      ? formatDate(item.check_out, item.work_timezone)
                      : 'Not recorded'}
                  </p>

                  <p>
                    <strong>Timezone:</strong>{' '}
                    {item.work_timezone || 'Not recorded'}
                  </p>

                  <p>
                    <strong>Total elapsed:</strong> {duration.elapsed}
                  </p>

                  <p>
                    <strong>Break deduction:</strong>{' '}
                    {duration.breakDeduction}
                  </p>

                  <p>
                    <strong>Net worked time:</strong> {duration.worked}
                  </p>

                  <div className="coordinates">
                    <p>
                      <strong>Check-in coordinates:</strong>{' '}
                      {item.check_in_lat != null &&
                      item.check_in_lng != null
                        ? `${item.check_in_lat}, ${item.check_in_lng}`
                        : 'Not recorded'}
                    </p>

                    <p>
                      <strong>Check-out coordinates:</strong>{' '}
                      {item.check_out_lat != null &&
                      item.check_out_lng != null
                        ? `${item.check_out_lat}, ${item.check_out_lng}`
                        : 'Not recorded'}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Scheduled shifts</h2>

        {shifts.length === 0 ? (
          <p className="muted">No shifts have been assigned to your account.</p>
        ) : (
          <div className="record-list">
            {shifts.map((shift) => (
              <article className="record" key={shift.id}>
                <p>
                  <strong>Starts:</strong> {formatDate(shift.starts_at)}
                </p>
                <p>
                  <strong>Ends:</strong> {formatDate(shift.ends_at)}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="app-footer">
        <p>
          MBP Attendance · Location is requested when you check in, check
          out, or test location permission.
        </p>
      </footer>
    </main>
  );
}
