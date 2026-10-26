
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
};

type Shift = {
  id: string;
  starts_at: string;
  ends_at: string;
};

type Screen = 'loading' | 'login' | 'set-password' | 'signed-in';
type PasswordFlow = 'invite' | 'recovery' | null;

function readPasswordFlow(): PasswordFlow {
  const hash = new URLSearchParams(
    window.location.hash.replace(/^#/, '')
  );
  const query = new URLSearchParams(window.location.search);

  if (hash.get('error_code') ?? query.get('error_code')) return null;

  const type = hash.get('type') ?? query.get('type');
  return type === 'invite' || type === 'recovery' ? type : null;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function getLocation(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not supported by this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
        }),
      () => reject(new Error('Location permission was not granted.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

export default function App() {
  const [initialFlow] = useState<PasswordFlow>(readPasswordFlow);
  const [passwordFlow, setPasswordFlow] = useState<PasswordFlow>(initialFlow);
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
  const [locationNote, setLocationNote] = useState('');

  const loadDashboard = useCallback(async (userId: string) => {
    if (!supabase) return;

    setLoadingDashboard(true);

    const [attendanceResult, shiftsResult] = await Promise.all([
      supabase
        .from('attendance')
        .select(
          'id, check_in, check_out, check_in_lat, check_in_lng, check_out_lat, check_out_lng'
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
      setMessage(`Could not load attendance: ${attendanceResult.error.message}`);
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

    setLoadingDashboard(false);
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
        setScreen('set-password');
        setSession(nextSession);
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

      if (error) setMessage(error.message);
      else {
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
        setMessage('Your invitation session has expired. Ask the administrator for a new invitation.');
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
        setMessage('Password saved. Please sign out and then log in with your new password.');
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

  async function handleCheckIn() {
    if (!supabase || !session) return;

    setBusy(true);
    setMessage('');
    setLocationNote('');

    try {
      const openRecord = attendance.find((item) => !item.check_out);

      if (openRecord) {
        setMessage('You already have an open attendance record.');
        return;
      }

      let coords: { latitude: number; longitude: number } | null = null;

      try {
        coords = await getLocation();
      } catch {
        setLocationNote('Location was unavailable. Check-in will be attempted without coordinates.');
      }

      const payload: {
        employee_id: string;
        check_in: string;
        check_in_lat?: number;
        check_in_lng?: number;
      } = {
        employee_id: session.user.id,
        check_in: new Date().toISOString(),
      };

      if (coords) {
        payload.check_in_lat = coords.latitude;
        payload.check_in_lng = coords.longitude;
      }

      const { error } = await supabase.from('attendance').insert(payload);

      if (error) {
        setMessage(`Check-in failed: ${error.message}`);
        return;
      }

      setMessage('Check-in recorded successfully.');
      await loadDashboard(session.user.id);
    } catch {
      setMessage('Unable to check in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckOut() {
    if (!supabase || !session) return;

    setBusy(true);
    setMessage('');
    setLocationNote('');

    try {
      const { error } = await supabase.rpc('check_out_now');

      if (error) {
        setMessage(`Check-out failed: ${error.message}`);
        return;
      }

      setMessage('Check-out recorded successfully.');
      await loadDashboard(session.user.id);
    } catch {
      setMessage('Unable to check out. Please try again.');
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

  if (!supabase) {
    return (
      <main style={pageStyle}>
        <section style={panelStyle}>
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
        <section style={panelStyle}>Checking your session...</section>
      )}

      {screen === 'login' && (
        <section style={{ ...panelStyle, maxWidth: 430 }}>
          <h1>Welcome back</h1>
          <p style={{ color: '#b7c0d1' }}>Sign in with your approved account.</p>
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
            <label htmlFor="login-password" style={{ display: 'block', marginTop: 18 }}>
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
            <button type="submit" disabled={busy} style={{ ...buttonStyle, width: '100%', marginTop: 20 }}>
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </section>
      )}

      {screen === 'set-password' && (
        <section style={{ ...panelStyle, maxWidth: 430 }}>
          <h1>Create your password</h1>
          <p style={{ color: '#b7c0d1' }}>Create a password for your invited account.</p>
          <form onSubmit={handleSetPassword}>
            <label htmlFor="invited-email">Invited email</label>
            <input id="invited-email" type="email" value={email} readOnly style={inputStyle} />
            <label htmlFor="new-password" style={{ display: 'block', marginTop: 18 }}>New password</label>
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
            <label htmlFor="confirm-password" style={{ display: 'block', marginTop: 18 }}>Confirm password</label>
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
            <button type="submit" disabled={busy} style={{ ...buttonStyle, width: '100%', marginTop: 20 }}>
              {busy ? 'Saving password...' : 'Create password'}
            </button>
          </form>
        </section>
      )}

      {screen === 'signed-in' && session && (
        <section style={panelStyle}>
          <h1>Employee dashboard</h1>
          <p style={{ color: '#b7c0d1', overflowWrap: 'anywhere' }}>
            Signed in as {session.user.email}
          </p>

          <div style={{
            padding: 18,
            margin: '20px 0',
            borderRadius: 12,
            border: '1px solid #344054',
          }}>
            <h2 style={{ marginTop: 0 }}>Today's attendance</h2>
            {(() => {
              const openRecord = attendance.find((item) => !item.check_out);
              return (
                <>
                  <p>{openRecord ? `Checked in at ${formatDate(openRecord.check_in)}` : 'You are currently checked out.'}</p>
                  {openRecord ? (
                    <button disabled={busy} onClick={handleCheckOut} style={buttonStyle}>
                      {busy ? 'Please wait...' : 'Check out'}
                    </button>
                  ) : (
                    <button disabled={busy || loadingDashboard} onClick={handleCheckIn} style={buttonStyle}>
                      {busy ? 'Please wait...' : 'Check in'}
                    </button>
                  )}
                </>
              );
            })()}
            {locationNote && <p style={{ color: '#f4c76b' }}>{locationNote}</p>}
          </div>

          <div style={{ marginTop: 28 }}>
            <h2>Scheduled shifts</h2>
            {loadingDashboard && <p>Loading shifts...</p>}
            {!loadingDashboard && shifts.length === 0 && <p>No shifts are scheduled for this account yet.</p>}
            {shifts.map((shift) => (
              <article key={shift.id} style={{
                padding: 14,
                marginBottom: 10,
                border: '1px solid #344054',
                borderRadius: 10,
              }}>
                <p style={{ margin: '0 0 6px' }}>Start: {formatDate(shift.starts_at)}</p>
                <p style={{ margin: 0 }}>End: {formatDate(shift.ends_at)}</p>
              </article>
            ))}
          </div>

          <div style={{ marginTop: 28 }}>
            <h2>Recent attendance</h2>
            {loadingDashboard && <p>Loading attendance...</p>}
            {!loadingDashboard && attendance.length === 0 && <p>No attendance records yet.</p>}
            {attendance.map((item) => (
              <article key={item.id} style={{
                padding: 14,
                marginBottom: 10,
                border: '1px solid #344054',
                borderRadius: 10,
              }}>
                <p style={{ margin: '0 0 6px' }}>Check-in: {formatDate(item.check_in)}</p>
                <p style={{ margin: 0 }}>Check-out: {item.check_out ? formatDate(item.check_out) : 'Not checked out'}</p>
              </article>
            ))}
          </div>

          <div style={{ marginTop: 28, borderTop: '1px solid #344054', paddingTop: 20 }}>
            <button type="button" disabled={busy} onClick={handleLogout} style={buttonStyle}>
              {busy ? 'Please wait...' : 'Sign out'}
            </button>
          </div>
        </section>
      )}

      {message && (
        <p role="status" style={{
          maxWidth: 760,
          margin: '12px auto',
          padding: 12,
          borderRadius: 8,
          background: '#202b3e',
          overflowWrap: 'anywhere',
        }}>
          {message}
        </p>
      )}

      <p style={{ maxWidth: 760, margin: '20px auto', color: '#98a2b3', fontSize: 13 }}>
        Authorized accounts only. Location is requested for check-in and is not continuously tracked by this version.
      </p>
    </main>
  );
}
