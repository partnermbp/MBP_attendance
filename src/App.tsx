
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

type Screen = 'loading' | 'login' | 'set-password' | 'signed-in';

function getInitialLinkType(): string | null {
  const hash = new URLSearchParams(
    window.location.hash.replace(/^#/, '')
  );
  const query = new URLSearchParams(window.location.search);

  const type = hash.get('type') ?? query.get('type');

  return type === 'invite' || type === 'recovery' ? type : null;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [passwordFlow, setPasswordFlow] = useState<string | null>(
    getInitialLinkType
  );

  useEffect(() => {
    const client = supabase;

    if (!client) {
      setScreen('login');
      return;
    }

    let alive = true;

    client.auth.getSession().then(({ data, error }) => {
      if (!alive) return;

      if (error) setMessage(error.message);

      setSession(data.session);

      if (passwordFlow && data.session) {
        setScreen('set-password');
      } else if (data.session) {
        setScreen('signed-in');
      } else {
        setScreen('login');
      }
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!alive) return;

      setSession(nextSession);

      if (
        passwordFlow ||
        event === 'PASSWORD_RECOVERY'
      ) {
        setScreen(nextSession ? 'set-password' : 'login');
      } else if (nextSession) {
        setScreen('signed-in');
      } else {
        setScreen('login');
      }
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [passwordFlow]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setBusy(true);
    setMessage('');

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      setSession(data.session);
      setPassword('');
      setScreen('signed-in');
      setMessage('Signed in successfully.');
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
      const { data, error } = await supabase.auth.updateUser({ password });

      if (error) {
        setMessage(error.message);
        return;
      }

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) {
        setMessage('Password updated. Please sign in with your new password.');
        setScreen('login');
        setPasswordFlow(null);
        return;
      }

      setSession(sessionData.session);
      setPassword('');
      setConfirmPassword('');
      setPasswordFlow(null);
      setScreen(sessionData.session ? 'signed-in' : 'login');

      window.history.replaceState(
        {},
        document.title,
        window.location.pathname
      );

      setMessage('Password created successfully.');
    } catch {
      setMessage('Unable to update the password. Please try again.');
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    boxSizing: 'border-box',
    background: '#101522',
    color: '#f4f6fb',
    fontFamily: 'system-ui, sans-serif',
  };

  const panelStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 430,
    padding: 28,
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
    ...inputStyle,
    marginTop: 20,
    border: 0,
    background: '#315ee7',
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.7 : 1,
  };

  if (!supabase) {
    return (
      <main style={pageStyle}>
        <section style={panelStyle}>
          <h1>Attendance CRM</h1>
          <p>Supabase is not configured.</p>
          <p>Check the GitHub Actions secrets for your Supabase URL and publishable key.</p>
        </section>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <section style={panelStyle}>
        <p style={{ color: '#82b4ff', fontWeight: 700 }}>ATTENDANCE CRM</p>

        {screen === 'loading' && <p>Checking your session...</p>}

        {screen === 'login' && (
          <>
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
              <label htmlFor="password" style={{ display: 'block', marginTop: 18 }}>
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={inputStyle}
              />
              <button type="submit" disabled={busy} style={buttonStyle}>
                {busy ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          </>
        )}

        {screen === 'set-password' && (
          <>
            <h1>Create your password</h1>
            <p style={{ color: '#b7c0d1' }}>
              Choose a password with at least 8 characters.
            </p>
            <form onSubmit={handleSetPassword}>
              <label htmlFor="new-password">New password</label>
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
              <label htmlFor="confirm-password" style={{ display: 'block', marginTop: 18 }}>
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
              <button type="submit" disabled={busy} style={buttonStyle}>
                {busy ? 'Saving password...' : 'Create password'}
              </button>
            </form>
          </>
        )}

        {screen === 'signed-in' && (
          <>
            <h1>You're signed in</h1>
            <p>Account: {session?.user.email ?? 'Authenticated user'}</p>
            <p style={{ color: '#b7c0d1' }}>
              Basic authentication is connected. Role enforcement, email OTP,
              Telegram verification, and attendance features are not yet enabled.
            </p>
            <button type="button" disabled={busy} onClick={handleLogout} style={buttonStyle}>
              {busy ? 'Signing out...' : 'Sign out'}
            </button>
          </>
        )}

        {message && (
          <p role="status" style={{ overflowWrap: 'anywhere' }}>{message}</p>
        )}

        <p style={{ color: '#98a2b3', fontSize: 13 }}>
          Authorized accounts only. Registration is by invitation.
        </p>
      </section>
    </main>
  );
}
