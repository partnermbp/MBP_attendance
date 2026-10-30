import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

type Attendance = { id: string; employee_id?: string; check_in: string; check_out: string | null; work_date: string | null; work_timezone: string | null };
type Shift = { id: string; employee_id?: string; starts_at: string; ends_at: string };
type Person = { id: string; full_name: string | null; email: string | null; role: string; active: boolean };
type Assignment = { manager_id: string; employee_id: string };
type TelegramMember = { telegram_user_id: number; profile_id: string | null };
type TelegramMetric = { question_user_id: number | null; first_reply_user_id: number | null; response_seconds: number | null };

const panel: CSSProperties = { background: 'var(--crm-card-bg)', border: '1px solid var(--crm-border)', borderRadius: 14, padding: 18, minWidth: 0 };
const muted: CSSProperties = { color: 'var(--crm-text-muted)', fontSize: 12 };
const metricValue: CSSProperties = { fontSize: 27, fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1.15 };
const dayKey = (value: string) => value.slice(0, 10);
const dateLabel = (key: string) => new Date(key + 'T12:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
const pct = (n: number, d: number) => d ? Math.round(n / d * 100) : 0;
const roleLabel = (role: string) => role.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

function MiniBarChart({ title, subtitle, labels, values, color = 'var(--crm-accent)' }: { title: string; subtitle: string; labels: string[]; values: number[]; color?: string }) {
  const max = Math.max(1, ...values);
  const width = 640, height = 190, left = 30, bottom = 28, top = 12;
  const slot = (width - left - 12) / Math.max(1, values.length);
  return <section style={panel}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}><strong>{title}</strong><span style={muted}>{subtitle}</span></div>
    {values.length ? <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ display: 'block', width: '100%', height: 'auto', marginTop: 12, overflow: 'visible' }}>
      {[0, .5, 1].map(t => <g key={t}><line x1={left} x2={width - 8} y1={top + (height - top - bottom) * t} y2={top + (height - top - bottom) * t} stroke="var(--crm-border)" strokeDasharray="4 4"/><text x={left - 8} y={top + (height - top - bottom) * t + 4} fill="var(--crm-text-muted)" fontSize="10" textAnchor="end">{Math.round(max * (1 - t))}</text></g>)}
      {values.map((value, i) => { const barH = (height - top - bottom) * value / max; const x = left + i * slot + slot * .18; const w = Math.max(5, slot * .62); return <g key={i}><rect x={x} y={height - bottom - barH} width={w} height={barH} rx="4" fill={color} opacity=".88"/><text x={x + w / 2} y={height - 9} fill="var(--crm-text-muted)" fontSize="10" textAnchor="middle">{labels[i]}</text><title>{labels[i]}: {value}</title></g>; })}
    </svg> : <p style={muted}>No data in this period yet.</p>}
  </section>;
}

function Donut({ title, parts, total }: { title: string; parts: { label: string; value: number; color: string }[]; total: number }) {
  const safeTotal = Math.max(total, 1); let offset = 0;
  return <section style={panel}>
    <strong>{title}</strong>
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', marginTop: 14 }}>
      <svg viewBox="0 0 120 120" width="116" height="116" role="img" aria-label={title}>
        <circle cx="60" cy="60" r="43" fill="none" stroke="var(--crm-border)" strokeWidth="13"/>
        {parts.map((part, i) => { const length = part.value / safeTotal * 270.2; const dash = `${length} ${270.2 - length}`; const node = <circle key={i} cx="60" cy="60" r="43" fill="none" stroke={part.color} strokeWidth="13" strokeDasharray={dash} strokeDashoffset={-offset} transform="rotate(-90 60 60)"/>; offset += length; return node; })}
        <text x="60" y="57" textAnchor="middle" fill="var(--crm-text)" fontSize="22" fontWeight="800">{total}</text><text x="60" y="72" textAnchor="middle" fill="var(--crm-text-muted)" fontSize="9">SHIFTS</text>
      </svg>
      <div style={{ display: 'grid', gap: 9, flex: 1, minWidth: 140 }}>{parts.map(p => <div key={p.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><i style={{ width: 9, height: 9, borderRadius: 3, background: p.color }}/>{p.label}</span><strong>{p.value} · {pct(p.value, total)}%</strong></div>)}</div>
    </div>
  </section>;
}

export default function TeamAttendanceReport({ attendance, shifts, profiles, assignments, telegramMembers, telegramMetrics, loading }: {
  attendance: Attendance[]; shifts: Shift[]; profiles: Person[]; assignments: Assignment[];
  telegramMembers: TelegramMember[]; telegramMetrics: TelegramMetric[]; loading: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState('7');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(today);
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  const [expanded, setExpanded] = useState<string | null>(null);

  const activePeople = useMemo(() => profiles.filter(p => p.active && p.role.toLowerCase() !== 'admin'), [profiles]);
  const personMap = useMemo(() => new Map(activePeople.map(p => [p.id, p])), [activePeople]);
  const scopedPeople = useMemo(() => employeeFilter === 'all' ? activePeople : activePeople.filter(p => p.id === employeeFilter), [activePeople, employeeFilter]);
  const scopedAttendance = useMemo(() => attendance.filter(a => {
    const date = a.work_date || (a.work_timezone ? new Intl.DateTimeFormat('en-CA', { timeZone: a.work_timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(a.check_in)) : dayKey(a.check_in));
    return date >= appliedFrom && date <= appliedTo && (employeeFilter === 'all' || a.employee_id === employeeFilter);
  }), [attendance, appliedFrom, appliedTo, employeeFilter]);
  const scopedShifts = useMemo(() => shifts.filter(s => s.employee_id && personMap.has(s.employee_id) && dayKey(s.starts_at) >= appliedFrom && dayKey(s.starts_at) <= appliedTo && (employeeFilter === 'all' || s.employee_id === employeeFilter)), [shifts, personMap, appliedFrom, appliedTo, employeeFilter]);
  const matchedShiftIds = useMemo(() => {
    const matched = new Set<string>();
    scopedShifts.forEach(s => {
      const check = scopedAttendance.find(a => a.employee_id === s.employee_id && dayKey(a.work_date || a.check_in) === dayKey(s.starts_at) && new Date(a.check_in).getTime() <= new Date(s.ends_at).getTime() && new Date(a.check_in).getTime() >= new Date(s.starts_at).getTime() - 6 * 3600000);
      if (check) matched.add(s.id);
    });
    return matched;
  }, [scopedShifts, scopedAttendance]);
  const shiftRecords = useMemo(() => scopedShifts.map(s => {
    const check = scopedAttendance.find(a => a.employee_id === s.employee_id && dayKey(a.work_date || a.check_in) === dayKey(s.starts_at) && new Date(a.check_in).getTime() <= new Date(s.ends_at).getTime() && new Date(a.check_in).getTime() >= new Date(s.starts_at).getTime() - 6 * 3600000);
    return { shift: s, check, late: Boolean(check && new Date(check.check_in).getTime() > new Date(s.starts_at).getTime() + 5 * 60000) };
  }), [scopedShifts, scopedAttendance]);
  const expected = scopedShifts.length, signed = matchedShiftIds.size, absent = expected - signed, late = shiftRecords.filter(r => r.late).length;
  const onTime = Math.max(0, signed - late);
  const activeToday = new Set(attendance.filter(a => dayKey(a.work_date || a.check_in) === today && a.employee_id).map(a => a.employee_id)).size;
  const avgStart = scopedAttendance.length ? Math.round(scopedAttendance.reduce((sum, a) => { const d = new Date(a.check_in); return sum + d.getHours() * 60 + d.getMinutes(); }, 0) / scopedAttendance.length) : null;
  const startText = avgStart == null ? '—' : `${String(Math.floor(avgStart / 60)).padStart(2,'0')}:${String(avgStart % 60).padStart(2,'0')}`;
  const memberProfile = new Map(telegramMembers.filter(m => m.profile_id).map(m => [m.telegram_user_id, m.profile_id as string]));
  const managerIds = new Set(assignments.map(a => a.manager_id));
  const teamResponseMetrics = telegramMetrics.filter(m => m.question_user_id != null && m.first_reply_user_id != null && memberProfile.has(m.question_user_id) && memberProfile.has(m.first_reply_user_id) && personMap.has(memberProfile.get(m.first_reply_user_id)!));
  const responseRate = pct(teamResponseMetrics.length, telegramMetrics.filter(m => m.question_user_id != null && memberProfile.has(m.question_user_id)).length);
  const avgResponse = teamResponseMetrics.length ? Math.round(teamResponseMetrics.reduce((s,m) => s + (m.response_seconds || 0), 0) / teamResponseMetrics.length) : null;
  const days: string[] = []; const cursor = new Date(appliedFrom + 'T12:00:00'); const last = new Date(appliedTo + 'T12:00:00');
  while (cursor <= last && days.length < 62) { days.push(cursor.toISOString().slice(0,10)); cursor.setDate(cursor.getDate()+1); }
  const dailyCounts = days.map(d => new Set(scopedAttendance.filter(a => dayKey(a.work_date || a.check_in) === d).map(a => a.employee_id)).size);
  const roleCounts = activePeople.reduce((acc, p) => { acc[roleLabel(p.role)] = (acc[roleLabel(p.role)] || 0) + 1; return acc; }, {} as Record<string, number>);
  const managerRows = scopedPeople.filter(p => managerIds.has(p.id)).map(manager => {
    const children = assignments.filter(a => a.manager_id === manager.id).map(a => personMap.get(a.employee_id)).filter(Boolean) as Person[];
    const descendants = children.flatMap(c => [c, ...assignments.filter(a => a.manager_id === c.id).map(a => personMap.get(a.employee_id)).filter(Boolean) as Person[]]);
    const ids = new Set([manager.id, ...descendants.map(p => p.id)]);
    const logs = scopedAttendance.filter(a => ids.has(a.employee_id || ''));
    const teamMembers = [manager, ...descendants];
    const teamDays = teamMembers.length * Math.max(1, days.length);
    const loggedDays = new Set(logs.map(a => (a.employee_id || '') + '|' + dayKey(a.work_date || a.check_in))).size;
    return { manager, teamMembers, logs, activity: pct(loggedDays, teamDays) };
  });
  const lateHours = Array.from({ length: 8 }, (_, i) => ({ label: `${String(8 + i * 2).padStart(2,'0')}:00`, value: scopedAttendance.filter(a => { const h = new Date(a.check_in).getHours(); return h >= 8 + i * 2 && h < 10 + i * 2; }).length }));
  const noSchedule = shifts.length === 0;
  const card = (label: string, value: string | number, note: string, tone?: string) => <article style={{ ...panel, padding: 16 }}><div style={{ ...muted, marginBottom: 9 }}>{label}</div><div style={{ ...metricValue, color: tone || 'var(--crm-text)' }}>{value}</div><div style={{ ...muted, marginTop: 8 }}>{note}</div></article>;

  return <div style={{ display: 'grid', gap: 16, marginTop: 18 }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
      <div><h1 style={{ margin: 0, fontSize: 25 }}>Team attendance report</h1><p style={{ ...muted, marginTop: 7, maxWidth: 760 }}>A live overview of shift attendance, team activity, punctuality and tracked Telegram response behaviour. Metrics are calculated from saved CRM records.</p></div>
      <button type="button" onClick={() => { setFrom(appliedFrom); setTo(appliedTo); }} style={{ border: '1px solid var(--crm-border)', borderRadius: 8, padding: '9px 12px', background: 'var(--crm-card-raised)', color: 'var(--crm-text)', cursor: 'pointer' }}>Refresh filters</button>
    </header>
    <section style={{ ...panel, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
      <label style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{ display: 'block', marginTop: 5, padding: 9, borderRadius: 7, border: '1px solid var(--crm-border)', background: 'var(--crm-control-bg)', color: 'var(--crm-text)' }}/></label>
      <label style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>To<input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{ display: 'block', marginTop: 5, padding: 9, borderRadius: 7, border: '1px solid var(--crm-border)', background: 'var(--crm-control-bg)', color: 'var(--crm-text)' }}/></label>
      <label style={{ fontSize: 12, color: 'var(--crm-text-muted)', minWidth: 190 }}>Employee / manager<select value={employeeFilter} onChange={e=>setEmployeeFilter(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 5, padding: 10, borderRadius: 7, border: '1px solid var(--crm-border)', background: 'var(--crm-control-bg)', color: 'var(--crm-text)' }}><option value="all">All active employees</option>{activePeople.map(p=><option key={p.id} value={p.id}>{p.full_name || p.email || 'Employee'} · {roleLabel(p.role)}</option>)}</select></label>
      <button type="button" onClick={()=>{if(from<=to){setAppliedFrom(from);setAppliedTo(to);setRange('custom');}}} style={{ padding: '10px 14px', border: 0, borderRadius: 7, background: 'var(--crm-accent-strong)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Apply</button>
      {['7','30','90'].map(n=><button key={n} type="button" onClick={()=>{const d=new Date();d.setDate(d.getDate()-Number(n)+1);const start=d.toISOString().slice(0,10);const end=new Date().toISOString().slice(0,10);setFrom(start);setTo(end);setAppliedFrom(start);setAppliedTo(end);setRange(n);}} aria-pressed={range===n} style={{ padding: '9px 11px', border: '1px solid var(--crm-border)', borderRadius: 7, background: range===n?'var(--crm-accent-soft)':'var(--crm-card-raised)', color: range===n?'var(--crm-accent-strong)':'var(--crm-text)', cursor: 'pointer' }}>Last {n} days</button>)}
    </section>
    {loading && <p style={muted}>Loading team metrics…</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 12 }}>
      {card('Active team members', scopedPeople.length, 'Active non-admin profiles')}
      {card('Logged in today', activeToday, 'Employees with a check-in today')}
      {card('Attendance records', scopedAttendance.length, 'Check-in sessions in selected range')}
      {card('Completed sessions', scopedAttendance.filter(a=>a.check_out).length, 'Sessions with both IN and OUT')}
      {card('Average sign-in time', startText, 'Average local browser time of recorded check-ins')}
      {card('Late sign-ins', noSchedule ? '—' : late, noSchedule ? 'Requires assigned shift schedules' : `${pct(late,signed)}% of signed-in shifts were over 5 min late`, '#f59e0b')}
    </div>
    {noSchedule ? <section style={{ ...panel, borderColor: '#b7791f' }}><strong>Shift compliance needs shift schedules</strong><p style={muted}>No shift records are currently available to the Admin dashboard. The report can show recorded check-ins, but it cannot fairly calculate missed sign-ins, late sign-ins or a not-signed-in rate without each employee’s scheduled shift start and end. Once shifts are available, these metrics will calculate automatically.</p></section> : <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(270px,1fr))', gap: 12 }}>
        {card('Shift sign-in rate', `${pct(signed,expected)}%`, `${signed} signed in from ${expected} scheduled shifts`, '#34d399')}
        {card('Not signed-in rate', `${pct(absent,expected)}%`, `${absent} scheduled shifts with no matching check-in`, '#f87171')}
        {card('On-time rate', `${pct(onTime,expected)}%`, 'Check-ins at or before 5 minutes after shift start')}
        <Donut title="Shift outcome" total={expected} parts={[{label:'On time',value:onTime,color:'#22c55e'},{label:'Late',value:late,color:'#f59e0b'},{label:'No check-in',value:absent,color:'#ef4444'}]}/>
      </div>
    </>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}>
      <MiniBarChart title="Daily team attendance" subtitle="Unique people checking in each day" labels={days.map(dateLabel)} values={dailyCounts}/>
      <MiniBarChart title="Check-in time distribution" subtitle="Recorded check-ins grouped by local hour" labels={lateHours.map(x=>x.label)} values={lateHours.map(x=>x.value)} color="#60a5fa"/>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
      <section style={panel}><strong>Telegram response rate</strong><div style={{ ...metricValue, marginTop: 12 }}>{teamResponseMetrics.length ? responseRate + '%' : '—'}</div><p style={muted}>{teamResponseMetrics.length ? `Average first response: ${avgResponse == null ? '—' : avgResponse < 60 ? avgResponse + ' sec' : Math.round(avgResponse/60) + ' min'}. Based on linked team identities in tracked Telegram groups.` : 'No attributable Telegram question/reply metrics are available for the selected team.'}</p></section>
      <section style={panel}><strong>Role distribution</strong><div style={{ display: 'grid', gap: 9, marginTop: 13 }}>{Object.entries(roleCounts).map(([role,count])=><div key={role}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}><span>{role}</span><strong>{count}</strong></div><div style={{ height: 7, background: 'var(--crm-border)', borderRadius: 8, overflow: 'hidden' }}><div style={{ width: pct(count,activePeople.length)+'%', height: '100%', background: 'var(--crm-accent)', borderRadius: 8 }}/></div></div>)}</div></section>
    </div>
    <section style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}><strong>Manager and reporting-line activity</strong><span style={muted}>Direct and second-level reports · check-in days / possible person-days</span></div>
      {managerRows.length ? <div style={{ overflowX: 'auto', marginTop: 12 }}><table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', fontSize: 12 }}><thead><tr>{['Manager','Team size','Check-in activity','Check-ins','Details'].map(x=><th key={x} style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid var(--crm-border)', color: 'var(--crm-text-muted)' }}>{x}</th>)}</tr></thead><tbody>{managerRows.map(row=><><tr key={row.manager.id}><td style={{ padding: 10, borderBottom: '1px solid var(--crm-border)' }}><strong>{row.manager.full_name || row.manager.email}</strong><div style={muted}>{roleLabel(row.manager.role)}</div></td><td style={{ padding: 10, borderBottom: '1px solid var(--crm-border)' }}>{row.teamMembers.length}</td><td style={{ padding: 10, borderBottom: '1px solid var(--crm-border)', minWidth: 170 }}><strong>{row.activity}%</strong><div style={{ height: 6, background: 'var(--crm-border)', borderRadius: 8, marginTop: 6 }}><div style={{ height: '100%', width: row.activity+'%', background: row.activity>=80?'#22c55e':row.activity>=50?'#f59e0b':'#ef4444', borderRadius: 8 }}/></div></td><td style={{ padding: 10, borderBottom: '1px solid var(--crm-border)' }}>{row.logs.length}</td><td style={{ padding: 10, borderBottom: '1px solid var(--crm-border)' }}><button type="button" onClick={()=>setExpanded(expanded===row.manager.id?null:row.manager.id)} style={{ background: 'transparent', color: 'var(--crm-accent-strong)', border: 0, cursor: 'pointer' }}>{expanded===row.manager.id?'Hide':'View team'}</button></td></tr>{expanded===row.manager.id&&<tr key={row.manager.id+'-detail'}><td colSpan={5} style={{ padding: 12, background: 'var(--crm-card-raised)' }}>{row.teamMembers.map(p=>{const count=scopedAttendance.filter(a=>a.employee_id===p.id).length;return <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--crm-border)' }}><span>{p.full_name||p.email} <small style={muted}>· {roleLabel(p.role)}</small></span><strong>{count} check-ins</strong></div>;})}</td></tr>}</>)}</tbody></table></div> : <p style={muted}>No manager-to-employee assignments are available for this selection.</p>}
    </section>
    <section style={panel}><strong>How to read these metrics</strong><ul style={{ ...muted, lineHeight: 1.7, paddingLeft: 19 }}><li>Attendance activity counts saved check-ins, not online presence or work output.</li><li>Late and not-signed-in rates are shown only when scheduled shifts are available; the late threshold is 5 minutes after shift start.</li><li>Team activity compares logged employee-days with calendar person-days. It is a trend indicator, not a contractual attendance score.</li><li>Telegram response rate uses only questions and first replies attributable to linked CRM identities in tracked groups. It does not measure private-chat response times.</li></ul></section>
  </div>;
}
