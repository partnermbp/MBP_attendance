
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
      // Fall back to the browser's local timezone.
    }
  }

  return date.toLocaleString();
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
          .limit(20),

        supabase
          .from('shifts')
          .select('id, starts_at, ends_at')
          .eq('employee_id', userId)
          .order('starts_at', { ascending: true })
          .limit(20),
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

    setBusy(true);
    setMessage('');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
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

  async function handleTestLocation() {
    setLocationTest('Requesting current location…');

    try {
      const coords = await getLocation();

      setLocationTest(
        `Location received successfully. Latitude: ${coords.latitude.toFixed(5)}, longitude: ${coords.longitude.toFixed(5)}. Not saved.`
      );
    } catch (error) {
      setLocationTest(getErrorMessage(error));
    }
  }

  async function handleCheckIn() {
    if (!supabase || !session) return;

    setBusy(true);
    setMessage('');
    setLocationTest('');

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

      // Resolve the timezone from the current GPS coordinates.
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

      // The database calculates work_date using this timezone and prevents
      // duplicate open check-ins for the same work date.
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
    setLocationTest('');

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

      // Close only the selected attendance session, never an arbitrary
      // open record belonging to this employee.
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

  const panelStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 760,
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

  // Ignore legacy open records without a work_date. This prevents the
  // existing legacy record from being selected for checkout automatically.
  // If a prior day's dated session was never closed, it remains eligible
  // for checkout until a newer dated session is opened.
  const openRecord = attendance
    .filter((item) => !item.check_out && item.work_date && item.work_timezone)
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
      <header style={{ maxWidth: 760, margin: '0 auto' }}>
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

          <form onSubmit={handleLogin}>
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

            <label
              htmlFor="login-password"
              style={{ display: 'block', marginTop: 18 }}
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
              style={{ ...buttonStyle, width: '100%', marginTop: 20 }}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
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
        <section style={panelStyle}>
          <h1>Employee dashboard</h1>
          <p
            style={{
              color: '#b7c0d1',
              overflowWrap: 'anywhere',
            }}
          >
            Signed in as {session.user.email}
          </p>

          <section
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
                  No dated open attendance session was found. You can start a
                  new session; the database will prevent a duplicate open
                  session for the same work date.
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

            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                onClick={() => void handleTestLocation()}
                disabled={busy}
                style={{ ...buttonStyle, background: '#475467' }}
              >
                Test location
              </button>

              {locationTest && (
                <p role="status" style={{ overflowWrap: 'anywhere' }}>
                  {locationTest}
                </p>
              )}
            </div>
          </section>

          <section style={{ marginTop: 28 }}>
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
          </section>

          <section style={{ marginTop: 28 }}>
            <h2>Recent attendance</h2>

            {loadingDashboard && <p>Loading attendance…</p>}

            {!loadingDashboard && attendance.length === 0 && (
              <p>No attendance records yet.</p>
            )}

            {attendance.map((item) => (
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

                <p
                  style={{
                    margin: '0 0 6px',
                    color: '#b7c0d1',
                    overflowWrap: 'anywhere',
                  }}
                >
                  Timezone: {item.work_timezone ?? 'Not recorded'}
                </p>

                <p
                  style={{
                    margin: '0 0 6px',
                    color: '#b7c0d1',
                    overflowWrap: 'anywhere',
                  }}
                >
                  Check-in GPS:{' '}
                  {item.check_in_lat != null && item.check_in_lng != null
                    ? `${item.check_in_lat.toFixed(5)}, ${item.check_in_lng.toFixed(5)}`
                    : 'Not recorded'}
                </p>

                <p
                  style={{
                    margin: 0,
                    color: '#b7c0d1',
                    overflowWrap: 'anywhere',
                  }}
                >
                  Check-out GPS:{' '}
                  {item.check_out_lat != null && item.check_out_lng != null
                    ? `${item.check_out_lat.toFixed(5)}, ${item.check_out_lng.toFixed(5)}`
                    : 'Not recorded'}
                </p>
              </article>
            ))}
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
        </section>
      )}

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
        Authorized accounts only. Check-in and check-out require browser
        location permission. Test location does not save coordinates.
      </p>
    </main>
  );
}
