
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setMessage(error.message);
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setSubmitting(true);
    setMessage('');

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setSubmitting(false);
    setMessage(
      error
        ? error.message
        : 'Signed in successfully.'
    );
  }

  async function handleLogout() {
    if (!supabase) return;

    const { error } = await supabase.auth.signOut();
    setMessage(error ? error.message : 'You have signed out.');
  }

  const pageStyle = {
    minHeight: '100vh',
    background: '#101522',
    color: '#f4f6fb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    fontFamily: 'system-ui, sans-serif',
  } as const;

  const panelStyle = {
    width: '100%',
    maxWidth: '420px',
    background: '#1a2232',
    border: '1px solid #344054',
    borderRadius: '16px',
    padding: '28px',
    boxSizing: 'border-box' as const,
  };

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '12px',
    marginTop: '7px',
    border: '1px solid #475467',
    borderRadius: '8px',
    background: '#101522',
    color: '#ffffff',
    fontSize: '16px',
  };

  if (!supabase) {
    return (
      <main style={pageStyle}>
        <section style={panelStyle}>
          <h1>Attendance CRM</h1>
          <p>Supabase is not configured.</p>
          <p>
            Check the VITE_SUPABASE_URL and
            VITE_SUPABASE_PUBLISHABLE_KEY
            GitHub Actions secrets.
          </p>
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <p>Loading your session...</p>
      </main>
    );
  }

  if (session) {
    return (
      <main style={pageStyle}>
        <section style={panelStyle}>
          <p style={{ color: '#82b4ff' }}>
            ATTENDANCE CRM
          </p>
          <h1>You’re signed in</h1>
          <p>Account: {session.user.email}</p>
          <p style={{ color: '#b7c0d1' }}>
            Authentication is connected. Attendance
            and role permissions are not yet enabled
            in this screen.
          </p>
          <button
            onClick={handleLogout}
            style={{
              ...inputStyle,
              background: '#315ee7',
              border: 0,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
          {message && <p role="status">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <section style={panelStyle}>
        <p style={{ color: '#82b4ff', fontWeight: 700 }}>
          ATTENDANCE CRM
        </p>
        <h1>Welcome back</h1>
        <p style={{ color: '#b7c0d1' }}>
          Sign in with your approved work account.
        </p>

        <form onSubmit={handleLogin}>
          <label htmlFor="email">Work email</label>
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
            htmlFor="password"
            style={{ display: 'block', marginTop: '18px' }}
          >
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

          <button
            type="submit"
            disabled={submitting}
            style={{
              ...inputStyle,
              marginTop: '22px',
              background: '#315ee7',
              border: 0,
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {message && (
          <p role="status" style={{ overflowWrap: 'anywhere' }}>
            {message}
          </p>
        )}

        <p style={{ color: '#98a2b3', fontSize: '13px' }}>
          Access is for authorized users only.
          Registration is not available on this screen.
        </p>
      </section>
    </main>
  );
}
