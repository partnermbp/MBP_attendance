
import {
  ShieldCheck,
  Users,
  Clock3,
  MapPin,
  CalendarDays,
  Settings,
  LockKeyhole,
  Database,
} from 'lucide-react';
import { supabaseConfigured } from './lib/supabase';

const sections = [
  { name: 'Overview', icon: Clock3 },
  { name: 'Employees', icon: Users },
  { name: 'Attendance', icon: CalendarDays },
  { name: 'Locations', icon: MapPin },
  { name: 'Settings', icon: Settings },
];

export default function App() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <ShieldCheck size={23} />
          </div>
          <div>
            <strong>WorkTrack</strong>
            <small>Attendance CRM</small>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>

        <nav>
          {sections.map((section, index) => {
            const Icon = section.icon;

            return (
              <button
                key={section.name}
                className={`nav-item ${index === 0 ? 'active' : ''}`}
                onClick={() => {
                  if (index !== 0) {
                    alert('This section will be enabled in a later step.');
                  }
                }}
              >
                <Icon size={18} />
                <span>{section.name}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <LockKeyhole size={15} />
          <span>Access-controlled workspace</span>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKSPACE / OVERVIEW</div>
            <h1>Attendance dashboard</h1>
          </div>
          <span className="preview-badge">PREVIEW</span>
        </header>

        <section className="welcome">
          <div>
            <p className="eyebrow">YOUR TEAM, AT A GLANCE</p>
            <h2>Welcome to WorkTrack</h2>
            <p>
              A central workspace for attendance, schedules,
              employee management and team permissions.
            </p>
          </div>
          <div className="welcome-icon">
            <Users size={38} />
          </div>
        </section>

        <div className="section-heading">
          <div>
            <h2>Workspace setup</h2>
            <p>Connect and configure your application.</p>
          </div>
        </div>

        <div className="setup-grid">
          <article className="setup-card">
            <div className="card-icon"><Database size={20} /></div>
            <h3>Database connection</h3>
            <span className={`status ${supabaseConfigured ? 'status-ready' : 'status-pending'}`}>
              {supabaseConfigured ? 'Configuration found' : 'Setup required'}
            </span>
            <p>
              {supabaseConfigured
                ? 'Connection settings are present. Authentication and database access still need testing.'
                : 'Add your Supabase project URL and publishable key to the deployment environment.'}
            </p>
          </article>

          <article className="setup-card">
            <div className="card-icon"><Users size={20} /></div>
            <h3>Team access</h3>
            <span className="status status-pending">Not configured</span>
            <p>
              Admin invitations, manager assignments and employee
              permissions will be connected after backend setup.
            </p>
          </article>

          <article className="setup-card">
            <div className="card-icon"><Clock3 size={20} /></div>
            <h3>Attendance</h3>
            <span className="status status-pending">Not configured</span>
            <p>
              Check-in, check-out, shifts and attendance history
              will be connected to your database.
            </p>
          </article>
        </div>

        <div className="notice">
          <LockKeyhole size={19} />
          <div>
            <strong>Development preview</strong>
            <p>
              This screen uses no employee records and collects no
              location data. It is not yet connected to live attendance.
            </p>
          </div>
        </div>

        <footer>WorkTrack · Attendance CRM · Development build</footer>
      </section>
    </main>
  );
}
