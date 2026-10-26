
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

type Screen = 'loading' | 'login' | 'set-password' | 'signed-in';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!supabase) {
      setScreen('login');
      return;
    }

    let alive = true;

    const detectSession = async () => {
      const client = supabase;
      if (!client) return;

      const { data, error } = await client.auth.getSession();

      if (!alive) return;

      if (error) setMessage(error.message);

      const currentSession = data.session;
      setSession(currentSession);

      const hash = window.location.hash;
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const query = new URLSearchParams(window.location.search);

      const recovery =
        params.get('type') === 'recovery' ||
        query.get('type') === 'recovery';

      const invite =
        params.get('type') === 'invite' ||
        query.get('type') === 'invite';

      if (currentSession && (recovery || invite)) {
        setScreen('set-password');
      } else if (currentSession) {
        setScreen('signed-in');
      } else {
        setScreen('login');
      }
    };

    void detectSession();

    const {
      data: { subscription },
    } } = client.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);

      if (
        event === 'PASSWORD_RECOVERY' ||
        (nextSession &&
          ['SIGNED_IN', 'INITIAL_SESSION'].includes(event) &&
          ['invite', 'recovery'].includes(
            new URLSearchParams(
              window.location.hash.replace(/^#/, '')
            ).get('type') ?? ''
          ))
      ) {
        setScreen('set-password');
      } else if (nextSession) {
        setScreen((current) =>
          current === 'set-password' ? current : 'signed-in'
        );
      } else {
        setScreen('login');
      }
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setBusy(true);
    setMessage('');

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setBusy(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setSession(data.session);
    setScreen('signed-in');
    setPassword('');
    setMessage('Signed in successfully.');
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

    const { data, error } = await supabase.auth.updateUser({ password });

    setBusy(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    setSession(sessionData.session);
    setPassword('');
    setConfirmPassword('');
    setScreen('signed-in');
    window.history.replaceState(
      {},
      document.title,
      window.location.pathname
    );
    setMessage('Password created successfully.');
  }

  async function handleLogout() {
    if (!supabase) return;

    setBusy(true);
    const { error } = await supabase.auth.signOut();
    setBusy(false);

    setMessage(error ? error.message : 'You have signed out.');
    if (!error) {
      setSession(null);
      setScreen('login');
    }
  }

  const page: React.CSSProperties = {
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

  const panel: React.CSSProperties = {
    width: '100%',
    maxWidth: 430,
    padding: 28,
    boxSizing: 'border-box',
    borderRadius: 16,
    border: '1px solid #344054',
    background: '#1a2232',
  };

  const field: React.CSSProperties = {
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

  const primary: React.CSSProperties = {
    ...field,
    marginTop: 20,
    border: 0,
    background: '#315ee7',
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.7 : 1,
  };

  if (!supabase) {
    return (
      <main style={page}>
        <section style={panel}>
          <h1>Attendance CRM</h1>
          <p>Supabase is not configured.</p>
          <p>Check the GitHub Actions secrets for the Supabase URL and publishable key.</p>
        </section>
      </main>
    );
  }

  return (
    <main style={page}>
      <section style={panel}>
        <p style={{ color: '#82b4ff', fontWeight: 700 }}>
          ATTENDANCE CRM
        </p>

        {screen === 'loading' && <p>Checking your session…</p>}

        {screen === 'login' && (
          <>
            <h1>Welcome back</h1>
            <p style={{ color: '#b7c0d1' }}>
              Sign in with your approved account.
            </p>

            <form onSubmit={handleLogin}>
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={field}
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
                onChange={(e) => setPassword(e.target.value)}
                style={field}
              />

              <button type="submit" disabled={busy} style={primary}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </>
        )}

        {screen === 'set-password' && (
          <>
            <h1>Create your password</h1>
            <p style={{ color: '#b7c0d1' }}>
              Choose a password for your account. Use at least 8 characters.
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
                onChange={(e) => setPassword(e.target.value)}
                style={field}
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
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={field}
              />

              <button type="submit" disabled={busy} style={primary}>
                {busy ? 'Saving password…' : 'Create password'}
              </button>
            </form>
          </>
        )}

        {screen === 'signed-in' && (
          <>
            <h1>You’re signed in</h1>
            <p>Account: {session?.user.email ?? 'Authenticated user'}</p>
            <p style={{ color: '#b7c0d1' }}>
              Authentication is connected. Role checks, OTP, Telegram verification,
              and attendance features are not enabled in this screen yet.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={handleLogout}
              style={primary}
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </>
        )}

        {message && (
          <p role="status" style={{ overflowWrap: 'anywhere' }}>
            {message}
          </p>
        )}

        <p style={{ color: '#98a2b3', fontSize: 13 }}>
          Authorized accounts only. Registration is by invitation.
        </p>
      </section>
    </main>
  );
}
