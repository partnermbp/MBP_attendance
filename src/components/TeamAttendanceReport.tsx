import { useMemo, useState } from 'react';
import KnowMore from './KnowMore';
import type { CSSProperties } from 'react';

type Attendance = { id: string; employee_id?: string; check_in: string; check_out: string | null; work_date: string | null; work_timezone: string | null; credited_work_minutes?: number | null; auto_closed?: boolean | null };
type Shift = { id: string; employee_id?: string; starts_at: string; ends_at: string };
type Person = { id: string; full_name: string | null; email: string | null; role: string; active: boolean };
type Assignment = { manager_id: string; employee_id: string };
type TelegramMember = { telegram_user_id?: number; profile_id: string | null };
type TelegramMetric = { question_user_id?: number | null; first_reply_user_id?: number | null; response_seconds?: number | null; calculated_at?: string | null; profile_id?: string; asked_count?: number; reply_count?: number; average_response_seconds?: number | null; response_samples?: Array<{response_seconds:number;calculated_at:string|null}>; question_samples?: Array<{calculated_at:string|null;answered:boolean}> };

const panel: CSSProperties = { background: 'var(--crm-card-bg)', border: '1px solid var(--crm-border)', borderRadius: 14, padding: 18, minWidth: 0 };
const muted: CSSProperties = { color: 'var(--crm-text-muted)', fontSize: 12 };
const metricValue: CSSProperties = { fontSize: 27, fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1.15 };
const dayKey = (value: string) => value.slice(0, 10);
const attendanceDay = (a: Attendance) => a.work_date || (a.work_timezone ? new Intl.DateTimeFormat('en-CA', { timeZone: a.work_timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(a.check_in)) : dayKey(a.check_in));
const localMinuteOfDay = (a: Attendance) => { const d = new Date(a.check_in); const parts = a.work_timezone ? new Intl.DateTimeFormat('en-GB', { timeZone: a.work_timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).split(':').map(Number) : [d.getHours(), d.getMinutes()]; return parts[0] * 60 + parts[1]; };
const creditedMinutes = (a: Attendance) => a.credited_work_minutes != null ? Math.max(0, Number(a.credited_work_minutes) || 0) : a.check_out ? Math.max(0, (new Date(a.check_out).getTime() - new Date(a.check_in).getTime()) / 60000 - ((new Date(a.check_out).getTime() - new Date(a.check_in).getTime()) >= 5 * 3600000 ? 60 : 0)) : 0;
const dateLabel = (key: string) => new Date(key + 'T12:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
const pct = (n: number, d: number) => d ? Math.round(n / d * 100) : 0;
const roleLabel = (role: string) => role.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

function MiniBarChart({ title, subtitle, labels, values, color = 'var(--crm-accent)' }: { title: string; subtitle: string; labels: string[]; values: number[]; color?: string }) {
  const max = Math.max(1, ...values);
  const width = 640, height = 190, left = 30, bottom = 28, top = 12;
  const slot = (width - left - 12) / Math.max(1, values.length);
  const labelStep = Math.max(1, Math.ceil(labels.length / 10));
  return <section style={panel}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}><strong>{title}</strong><span style={muted}>{subtitle}</span></div>
    {values.length ? <div className="crm-report-chart-scroll"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ display: 'block', width: '100%', height: 'auto', marginTop: 12, overflow: 'visible' }}>
      {[0, .5, 1].map(t => <g key={t}><line x1={left} x2={width - 8} y1={top + (height - top - bottom) * t} y2={top + (height - top - bottom) * t} stroke="var(--crm-border)" strokeDasharray="4 4"/><text x={left - 8} y={top + (height - top - bottom) * t + 4} fill="var(--crm-text-muted)" fontSize="10" textAnchor="end">{Math.round(max * (1 - t))}</text></g>)}
      {values.map((value, i) => { const barH = (height - top - bottom) * value / max; const x = left + i * slot + slot * .18; const w = Math.max(5, slot * .62); return <g key={i}><rect x={x} y={height - bottom - barH} width={w} height={barH} rx="4" fill={color} opacity=".88"/>{(i % labelStep === 0 || i === labels.length - 1) && <text x={x + w / 2} y={height - 9} fill="var(--crm-text-muted)" fontSize="10" textAnchor="middle">{labels[i]}</text>}<title>{labels[i]}: {value}</title></g>; })}
    </svg></div> : <p style={muted}>No data in this period yet.</p>}
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

export default function TeamAttendanceReport({ attendance, shifts, profiles, assignments, telegramMembers, telegramMetrics, approvedLeave = [], holidays = [], loading }: {
  attendance: Attendance[]; shifts: Shift[]; profiles: Person[]; assignments: Assignment[];
  telegramMembers: TelegramMember[]; telegramMetrics: TelegramMetric[]; approvedLeave?: Array<{employee_id:string;start_date:string;end_date:string;status:string}>; holidays?: Array<{holiday_date:string;name:string}>; loading: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState('7');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(today);
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  const [expanded, setExpanded] = useState<string | null>(null);

  const activePeople = useMemo(() => profiles.filter(p => p.active && !['admin', 'supervisor'].includes(p.role.toLowerCase().replaceAll('_', ' '))), [profiles]);
  const personMap = useMemo(() => new Map(activePeople.map(p => [p.id, p])), [activePeople]);
  const scopedPeople = useMemo(() => employeeFilter === 'all' ? activePeople : activePeople.filter(p => p.id === employeeFilter), [activePeople, employeeFilter]);
  const scopedAttendance = useMemo(() => attendance.filter(a => {
    const date = attendanceDay(a);
    return date >= appliedFrom && date <= appliedTo && (employeeFilter === 'all' || a.employee_id === employeeFilter);
  }), [attendance, appliedFrom, appliedTo, employeeFilter]);
  const scopedShifts = useMemo(() => shifts.filter(s => { if (!s.employee_id || !personMap.has(s.employee_id) || (employeeFilter !== 'all' && s.employee_id !== employeeFilter)) return false; const timezone = attendance.find(a => a.employee_id === s.employee_id && a.work_timezone)?.work_timezone; const date = timezone ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s.starts_at)) : dayKey(s.starts_at); if (date < appliedFrom || date > appliedTo) return false; if (holidays.some(h => h.holiday_date === date)) return false; if (approvedLeave.some(l => l.employee_id === s.employee_id && l.start_date <= date && l.end_date >= date)) return false; return true; }), [shifts, personMap, attendance, appliedFrom, appliedTo, employeeFilter, approvedLeave, holidays]);
  const matchedShiftIds = useMemo(() => {
    const matched = new Set<string>();
    scopedShifts.forEach(s => {
      const check = scopedAttendance.find(a => a.employee_id === s.employee_id && attendanceDay(a) === (a.work_timezone ? new Intl.DateTimeFormat('en-CA', { timeZone: a.work_timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s.starts_at)) : dayKey(s.starts_at)) && new Date(a.check_in).getTime() <= new Date(s.ends_at).getTime() && new Date(a.check_in).getTime() >= new Date(s.starts_at).getTime() - 6 * 3600000);
      if (check) matched.add(s.id);
    });
    return matched;
  }, [scopedShifts, scopedAttendance]);
  const shiftRecords = useMemo(() => scopedShifts.map(s => {
    const check = scopedAttendance.find(a => a.employee_id === s.employee_id && attendanceDay(a) === (a.work_timezone ? new Intl.DateTimeFormat('en-CA', { timeZone: a.work_timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s.starts_at)) : dayKey(s.starts_at)) && new Date(a.check_in).getTime() <= new Date(s.ends_at).getTime() && new Date(a.check_in).getTime() >= new Date(s.starts_at).getTime() - 6 * 3600000);
    return { shift: s, check, late: Boolean(check && new Date(check.check_in).getTime() > new Date(s.starts_at).getTime() + 5 * 60000) };
  }), [scopedShifts, scopedAttendance]);
  const expected = scopedShifts.length, signed = matchedShiftIds.size, absent = expected - signed, late = shiftRecords.filter(r => r.late).length;
  const onTime = Math.max(0, signed - late);
  const activeToday = appliedFrom <= today && appliedTo >= today ? new Set(scopedAttendance.filter(a => attendanceDay(a) === today && a.employee_id).map(a => a.employee_id)).size : 0;
  const avgStart = scopedAttendance.length ? Math.round(scopedAttendance.reduce((sum, a) => sum + localMinuteOfDay(a), 0) / scopedAttendance.length) : null;
  const startText = avgStart == null ? '—' : `${String(Math.floor(avgStart / 60)).padStart(2,'0')}:${String(avgStart % 60).padStart(2,'0')}`;
  const memberProfile = new Map(telegramMembers.filter(m => m.profile_id && m.telegram_user_id != null).map(m => [m.telegram_user_id as number, m.profile_id as string]));
  const managerIds = new Set(assignments.map(a => a.manager_id));
  // Manager API returns per-profile aggregates only (no raw Telegram IDs); Admin
  // keeps the existing detailed metric path. Both feed the same report card.
  const aggregateMetrics = telegramMetrics.filter(m => m.profile_id && personMap.has(m.profile_id) && (employeeFilter === 'all' || m.profile_id === employeeFilter));
  const hasAggregateMetrics = aggregateMetrics.length > 0;
  const selectedResponses = hasAggregateMetrics
    ? aggregateMetrics.flatMap(m => (m.response_samples || []).filter(s => s.calculated_at && s.calculated_at.slice(0, 10) >= appliedFrom && s.calculated_at.slice(0, 10) <= appliedTo).map(s => s.response_seconds))
    : telegramMetrics.filter(m => m.question_user_id != null && m.first_reply_user_id != null && m.response_seconds != null && m.calculated_at && m.calculated_at.slice(0, 10) >= appliedFrom && m.calculated_at.slice(0, 10) <= appliedTo && memberProfile.has(m.question_user_id) && memberProfile.has(m.first_reply_user_id) && personMap.has(memberProfile.get(m.first_reply_user_id)!)).map(m => m.response_seconds || 0);
  const selectedQuestions = hasAggregateMetrics
    ? aggregateMetrics.flatMap(m => (m.question_samples || []).filter(s => s.calculated_at && s.calculated_at.slice(0, 10) >= appliedFrom && s.calculated_at.slice(0, 10) <= appliedTo).map(s => s.answered))
    : telegramMetrics.filter(m => m.question_user_id != null && memberProfile.has(m.question_user_id) && (employeeFilter === 'all' || memberProfile.get(m.question_user_id) === employeeFilter) && m.calculated_at && m.calculated_at.slice(0, 10) >= appliedFrom && m.calculated_at.slice(0, 10) <= appliedTo).map(m => m.first_reply_user_id != null);
  const askedCount = selectedQuestions.length;
  const replyCount = selectedQuestions.filter(Boolean).length;
  const responseRate = pct(replyCount, askedCount);
  const sortedResponses = [...selectedResponses].sort((a, b) => a - b);
  const medianResponse = sortedResponses.length ? Math.round(sortedResponses.length % 2 ? sortedResponses[Math.floor(sortedResponses.length / 2)] : (sortedResponses[sortedResponses.length / 2 - 1] + sortedResponses[sortedResponses.length / 2]) / 2) : null;
  const avgResponse = sortedResponses.length ? Math.round(sortedResponses.reduce((sum, value) => sum + value, 0) / sortedResponses.length) : null;
  const sla5 = pct(sortedResponses.filter(v => v <= 300).length, sortedResponses.length);
  const sla15 = pct(sortedResponses.filter(v => v <= 900).length, sortedResponses.length);
  const sla30 = pct(sortedResponses.filter(v => v <= 1800).length, sortedResponses.length);
  const days: string[] = []; const cursor = new Date(appliedFrom + 'T12:00:00'); const last = new Date(appliedTo + 'T12:00:00');
  while (cursor <= last) { days.push(cursor.toISOString().slice(0,10)); cursor.setDate(cursor.getDate()+1); }
  const dailyCounts = days.map(d => new Set(scopedAttendance.filter(a => attendanceDay(a) === d).map(a => a.employee_id)).size);
  const roleCounts = scopedPeople.reduce((acc, p) => { acc[roleLabel(p.role)] = (acc[roleLabel(p.role)] || 0) + 1; return acc; }, {} as Record<string, number>);
  const managerRows = scopedPeople.filter(p => managerIds.has(p.id)).map(manager => {
    const descendants: Person[] = []; const visited = new Set<string>([manager.id]); let frontier = [manager.id];
    for (let depth = 0; depth < 12 && frontier.length; depth++) { const next: string[] = []; for (const parentId of frontier) for (const assignment of assignments.filter(a => a.manager_id === parentId)) { if (visited.has(assignment.employee_id)) continue; visited.add(assignment.employee_id); const child = personMap.get(assignment.employee_id); if (child) { descendants.push(child); next.push(child.id); } } frontier = next; }
    const directIds = new Set(assignments.filter(a => a.manager_id === manager.id).map(a => a.employee_id));
    const ids = new Set([manager.id, ...descendants.map(p => p.id)]);
    const logs = scopedAttendance.filter(a => ids.has(a.employee_id || ''));
    const teamMembers = [manager, ...descendants];
    const teamDays = teamMembers.reduce((total, member) => total + days.filter(d => {
      const date = new Date(d + 'T12:00:00');
      return date.getDay() !== 0 && date.getDay() !== 6
        && !holidays.some(h => h.holiday_date === d)
        && !approvedLeave.some(l => l.employee_id === member.id && l.start_date <= d && l.end_date >= d);
    }).length, 0);
    const loggedDays = new Set(logs.map(a => (a.employee_id || '') + '|' + attendanceDay(a))).size;
    return { manager, teamMembers, directCount: descendants.filter(p => directIds.has(p.id)).length, indirectCount: descendants.filter(p => !directIds.has(p.id)).length, logs, activity: pct(loggedDays, teamDays) };
  });
  const lateHours = Array.from({ length: 8 }, (_, i) => ({ label: `${String(8 + i * 2).padStart(2,'0')}:00`, value: scopedAttendance.filter(a => { const h = new Date(a.check_in).getHours(); return h >= 8 + i * 2 && h < 10 + i * 2; }).length }));
  const lateByPerson = shiftRecords.filter(r => r.late && r.shift.employee_id).reduce((map, r) => map.set(r.shift.employee_id!, (map.get(r.shift.employee_id!) || 0) + 1), new Map<string, number>());
  const repeatedLatePeople = new Set([...lateByPerson].filter(([, count]) => count >= 3).map(([id]) => id));
  const autoClosedCount = scopedAttendance.filter(a => a.auto_closed).length;
  const creditedTotal = scopedAttendance.reduce((sum, a) => sum + creditedMinutes(a), 0);
  const expectedEmployeeDays = scopedPeople.reduce((total, person) => total + days.filter(d => {
    const date = new Date(d + 'T12:00:00');
    return date.getDay() !== 0 && date.getDay() !== 6
      && !holidays.some(h => h.holiday_date === d)
      && !approvedLeave.some(l => l.employee_id === person.id && l.start_date <= d && l.end_date >= d);
  }).length, 0);
  const creditedHoursPerWorkday = expectedEmployeeDays ? creditedTotal / 60 / expectedEmployeeDays : 0;
  const overtimeHours = scopedAttendance.reduce((sum, a) => sum + Math.max(0, creditedMinutes(a) - 480), 0) / 60;
  const earlyDepartures = shiftRecords.filter(r => r.check?.check_out && new Date(r.check.check_out).getTime() < new Date(r.shift.ends_at).getTime() - 15 * 60000).length;
  const personAttention = scopedPeople.map(person => {
    const personLate = shiftRecords.filter(r => r.shift.employee_id === person.id && r.late).length;
    const personMissed = shiftRecords.filter(r => r.shift.employee_id === person.id && !r.check).length;
    const personAutoClosed = scopedAttendance.filter(a => a.employee_id === person.id && a.auto_closed).length;
    const personEarly = shiftRecords.filter(r => r.shift.employee_id === person.id && r.check?.check_out && new Date(r.check.check_out).getTime() < new Date(r.shift.ends_at).getTime() - 15 * 60000).length;
    const reasons = [personLate >= 3 ? personLate + ' late arrivals' : '', personMissed ? personMissed + ' missed shifts' : '', personAutoClosed ? personAutoClosed + ' auto-closed sessions' : '', personEarly ? personEarly + ' early departures' : ''].filter(Boolean);
    return { person, reasons, score: personLate + personMissed * 2 + personAutoClosed + personEarly };
  }).filter(item => item.reasons.length).sort((a,b) => b.score-a.score).slice(0,20);
  const selectedPeriodDays = Math.max(1, Math.round((new Date(appliedTo+'T12:00:00').getTime()-new Date(appliedFrom+'T12:00:00').getTime())/86400000)+1);
  const previousTo = new Date(new Date(appliedFrom+'T12:00:00').getTime()-86400000).toISOString().slice(0,10);
  const previousFrom = new Date(new Date(previousTo+'T12:00:00').getTime()-(selectedPeriodDays-1)*86400000).toISOString().slice(0,10);
  const previousAttendance = attendance.filter(record => {
    const date = attendanceDay(record);
    return date >= previousFrom && date <= previousTo && (employeeFilter === 'all' || record.employee_id === employeeFilter) && record.employee_id && personMap.has(record.employee_id);
  });
  const currentCredited = scopedAttendance.reduce((sum, record) => sum + creditedMinutes(record), 0);
  const previousCredited = previousAttendance.reduce((sum, record) => sum + creditedMinutes(record), 0);
  const previousPeople = new Set(previousAttendance.map(record => record.employee_id)).size;
  const currentPeople = new Set(scopedAttendance.map(record => record.employee_id).filter(Boolean)).size;
  const previousSessions = previousAttendance.length;
  const periodDelta = (current: number, previous: number) => previous ? Math.round((current-previous)/previous*100) : null;
  const peopleDelta = periodDelta(currentPeople, previousPeople);
  const sessionsDelta = periodDelta(scopedAttendance.length, previousSessions);
  const hoursDelta = periodDelta(currentCredited, previousCredited);
  const payrollRows = scopedPeople.map(person => {
    const personShifts = scopedShifts.filter(shift => shift.employee_id === person.id);
    const personRecords = scopedAttendance.filter(record => record.employee_id === person.id);
    const byDay = new Map<string, number>();
    personRecords.forEach(record => byDay.set(attendanceDay(record), (byDay.get(attendanceDay(record)) || 0) + creditedMinutes(record)));
    const credited = [...byDay.values()].reduce((sum, minutes) => sum + minutes, 0);
    const overtime = [...byDay.values()].reduce((sum, minutes) => sum + Math.max(0, minutes - 480), 0);
    const leaveDays = days.filter(day => {
      const d = new Date(day + 'T12:00:00');
      return d.getDay() !== 0 && d.getDay() !== 6 && !holidays.some(h => h.holiday_date === day)
        && approvedLeave.some(l => l.employee_id === person.id && l.start_date <= day && l.end_date >= day);
    }).length;
    const personShiftRows = shiftRecords.filter(row => row.shift.employee_id === person.id);
    const missed = personShiftRows.filter(row => !row.check).length;
    const lateCount = personShiftRows.filter(row => row.late).length;
    const scheduled = personShifts.length;
    const attended = scheduled - missed;
    return { name: person.full_name || person.email || person.id, email: person.email || '', role: person.role, scheduled, attended, missed, late: lateCount, leaveDays, creditedHours: (credited/60).toFixed(2), overtimeHours: (overtime/60).toFixed(2), autoClosed: personRecords.filter(row => row.auto_closed).length, compliance: pct(attended, scheduled) };
  });
  const exportPayrollCsv = () => {
    const headers = ['Employee','Email','Role','Scheduled shifts','Attended shifts','Missed shifts','Late shifts','Approved leave weekdays','Credited hours','Overtime hours','Auto-closed sessions','Attendance compliance %'];
    const rows = payrollRows.map(row => [row.name,row.email,row.role,row.scheduled,row.attended,row.missed,row.late,row.leaveDays,row.creditedHours,row.overtimeHours,row.autoClosed,row.compliance]);
    const csv = [headers,...rows].map(row => row.map(value => '"' + String(value ?? '').replace(/"/g,'""') + '"').join(',')).join('\r\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `attendance-payroll-summary-${appliedFrom}-to-${appliedTo}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };
  const noSchedule = scopedShifts.length === 0;
  const card = (label: string, value: string | number, note: string, tone?: string) => <article style={{ ...panel, padding: 16 }}><div style={{ ...muted, marginBottom: 9 }}>{label}</div><div style={{ ...metricValue, color: tone || 'var(--crm-text)' }}>{value}</div><div style={{ ...muted, marginTop: 8 }}>{note}</div></article>;

  return <div style={{ display: 'grid', gap: 16, marginTop: 18 }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
      <div><h1 style={{ margin: 0, fontSize: 25 }}>Team attendance report</h1><KnowMore>Metrics are calculated from saved attendance, scheduled shifts and attributable Telegram group activity. Some metrics require shift schedules and linked Telegram identities.</KnowMore></div>
      <button type="button" onClick={() => { setFrom(appliedFrom); setTo(appliedTo); }} style={{ border: '1px solid var(--crm-border)', borderRadius: 8, padding: '9px 12px', background: 'var(--crm-card-raised)', color: 'var(--crm-text)', cursor: 'pointer' }}>Refresh filters</button>
      <button type="button" onClick={exportPayrollCsv} style={{ border: '1px solid var(--crm-border)', borderRadius: 8, padding: '9px 12px', background: 'var(--crm-accent-strong)', color: '#fff', cursor: 'pointer' }}>Export payroll attendance CSV</button>
    </header>
    <section style={{ ...panel, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
      <label style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{ display: 'block', marginTop: 5, padding: 9, borderRadius: 7, border: '1px solid var(--crm-border)', background: 'var(--crm-control-bg)', color: 'var(--crm-text)' }}/></label>
      <label style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>To<input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{ display: 'block', marginTop: 5, padding: 9, borderRadius: 7, border: '1px solid var(--crm-border)', background: 'var(--crm-control-bg)', color: 'var(--crm-text)' }}/></label>
      <label style={{ fontSize: 12, color: 'var(--crm-text-muted)', minWidth: 190 }}>Employee / manager<select value={employeeFilter} onChange={e=>setEmployeeFilter(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 5, padding: 10, borderRadius: 7, border: '1px solid var(--crm-border)', background: 'var(--crm-control-bg)', color: 'var(--crm-text)' }}><option value="all">All active employees</option>{activePeople.map(p=><option key={p.id} value={p.id}>{p.full_name || p.email || 'Employee'} · {roleLabel(p.role)}</option>)}</select></label>
      <button type="button" onClick={()=>{if(from<=to){setAppliedFrom(from);setAppliedTo(to);setRange('custom');}}} style={{ padding: '10px 14px', border: 0, borderRadius: 7, background: 'var(--crm-accent-strong)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Apply</button>
      {['7','30','90'].map(n=><button key={n} type="button" onClick={()=>{const d=new Date();d.setDate(d.getDate()-Number(n)+1);const start=d.toISOString().slice(0,10);const end=new Date().toISOString().slice(0,10);setFrom(start);setTo(end);setAppliedFrom(start);setAppliedTo(end);setRange(n);}} aria-pressed={range===n} style={{ padding: '9px 11px', border: '1px solid var(--crm-border)', borderRadius: 7, background: range===n?'var(--crm-accent-soft)':'var(--crm-card-raised)', color: range===n?'var(--crm-accent-strong)':'var(--crm-text)', cursor: 'pointer' }}>Last {n} days</button>)}
    </section>
    {loading && <p style={muted}>Loading team metrics…</p>}
    <div className="crm-report-stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 12 }}>
      {card('Active team members', scopedPeople.length, 'Active non-admin / non-supervisor profiles')}
      {card('Logged in today', activeToday, 'Employees with a check-in today')}
      {card('Attendance records', scopedAttendance.length, 'Check-in sessions in selected range')}
      {card('Completed sessions', scopedAttendance.filter(a=>a.check_out).length, 'Sessions with both IN and OUT')}
      {card('Average sign-in time', startText, 'Average check-in time in employee work timezone')}
      {card('Late sign-ins', noSchedule ? '—' : late, noSchedule ? 'Requires assigned shift schedules' : `${pct(late,signed)}% of signed-in shifts were over 5 min late`, '#f59e0b')}
      {card('Repeated lateness', noSchedule ? '—' : repeatedLatePeople.size, 'People late on 3+ scheduled shifts')}
      {card('Auto-closed sessions', autoClosedCount, 'Sessions closed automatically')}
      {card('Early departures', noSchedule ? '—' : earlyDepartures, 'Checkout over 15 minutes before shift end')}
      {card('Credited hours / workday', creditedHoursPerWorkday.toFixed(1), 'Average per active person and weekday')}
      {card('Overtime credited', overtimeHours.toFixed(1) + ' h', 'Credited time above 8 hours per session')}
    </div>
    {noSchedule ? <section style={{ ...panel, borderColor: '#b7791f' }}><strong>Shift compliance needs shift schedules</strong><p style={muted}>No shift records are currently available to the Admin dashboard. The report can show recorded check-ins, but it cannot fairly calculate missed sign-ins, late sign-ins or a not-signed-in rate without each employee’s scheduled shift start and end. Once shifts are available, these metrics will calculate automatically.</p></section> : <>
      <div className="crm-report-rate-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(270px,1fr))', gap: 12 }}>
        {card('Shift sign-in rate', `${pct(signed,expected)}%`, `${signed} signed in from ${expected} scheduled shifts`, '#34d399')}
        {card('Not signed-in rate', `${pct(absent,expected)}%`, `${absent} scheduled shifts with no matching check-in`, '#f87171')}
        {card('On-time rate', `${pct(onTime,expected)}%`, 'Check-ins at or before 5 minutes after shift start')}
        <Donut title="Shift outcome" total={expected} parts={[{label:'On time',value:onTime,color:'#22c55e'},{label:'Late',value:late,color:'#f59e0b'},{label:'No check-in',value:absent,color:'#ef4444'}]}/>
      </div>
    </>}
    <section style={panel}>
      <div style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap',alignItems:'baseline'}}>
        <strong>Previous-period comparison</strong>
        <span style={muted}>{previousFrom} – {previousTo} compared with {appliedFrom} – {appliedTo}</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:14,marginTop:14}}>
        <div><div style={muted}>People with attendance</div><strong style={metricValue}>{currentPeople}</strong><div style={muted}>{previousPeople} previous · {peopleDelta===null?'No baseline':(peopleDelta>0?'+':'')+peopleDelta+'%'}</div></div>
        <div><div style={muted}>Attendance sessions</div><strong style={metricValue}>{scopedAttendance.length}</strong><div style={muted}>{previousSessions} previous · {sessionsDelta===null?'No baseline':(sessionsDelta>0?'+':'')+sessionsDelta+'%'}</div></div>
        <div><div style={muted}>Credited hours</div><strong style={metricValue}>{(currentCredited/60).toFixed(1)}</strong><div style={muted}>{(previousCredited/60).toFixed(1)} previous · {hoursDelta===null?'No baseline':(hoursDelta>0?'+':'')+hoursDelta+'%'}</div></div>
      </div>
      <p style={{...muted,marginBottom:0}}>Comparison uses the immediately preceding period of equal length. Percentages are unavailable when the previous period has no records.</p>
    </section>
    <div className="crm-report-chart-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}>
      <MiniBarChart title="Daily team attendance" subtitle="Unique people checking in each day" labels={days.map(dateLabel)} values={dailyCounts}/>
      <MiniBarChart title="Check-in time distribution" subtitle="Recorded check-ins grouped by local hour" labels={lateHours.map(x=>x.label)} values={lateHours.map(x=>x.value)} color="#60a5fa"/>
    </div>
    <section style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}><strong>Attendance exceptions</strong><span style={muted}>People who may need a manager follow-up · selected date range</span></div>
      {personAttention.length ? <div style={{ overflowX: 'auto', marginTop: 10 }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr>{['Employee','Role','Exceptions'].map(x=><th key={x} style={{ textAlign: 'left', padding: 9, color: 'var(--crm-text-muted)', borderBottom: '1px solid var(--crm-border)' }}>{x}</th>)}</tr></thead><tbody>{personAttention.map(item=><tr key={item.person.id}><td style={{ padding: 9, borderBottom: '1px solid var(--crm-border)' }}>{item.person.full_name || item.person.email}</td><td style={{ padding: 9, borderBottom: '1px solid var(--crm-border)' }}>{roleLabel(item.person.role)}</td><td style={{ padding: 9, borderBottom: '1px solid var(--crm-border)' }}>{item.reasons.join(' · ')}</td></tr>)}</tbody></table></div> : <p style={muted}>No attendance exceptions found for this selection.</p>}
    </section>
    <div className="crm-report-secondary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
      <section style={panel}><strong>Telegram response performance</strong><div style={{ ...metricValue, marginTop: 12 }}>{askedCount ? responseRate + '%' : '—'}</div><p style={muted}>{askedCount ? `${replyCount} of ${askedCount} attributable questions answered · median ${medianResponse == null ? '—' : medianResponse < 60 ? medianResponse + ' sec' : Math.round(medianResponse/60) + ' min'} · average ${avgResponse == null ? '—' : avgResponse < 60 ? avgResponse + ' sec' : Math.round(avgResponse/60) + ' min'}.` : 'No attributable Telegram question/reply metrics are available for the selected period.'}</p><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 12 }}>{[['≤5 min',sla5],['≤15 min',sla15],['≤30 min',sla30]].map(([label,value])=><div key={String(label)} style={{ background: 'var(--crm-card-raised)', borderRadius: 8, padding: 9 }}><strong>{askedCount && selectedResponses.length ? value + '%' : '—'}</strong><div style={muted}>{label} SLA</div></div>)}</div></section>
      <section style={panel}><strong>Role distribution</strong><div style={{ display: 'grid', gap: 9, marginTop: 13 }}>{Object.entries(roleCounts).map(([role,count])=><div key={role}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}><span>{role}</span><strong>{count}</strong></div><div style={{ height: 7, background: 'var(--crm-border)', borderRadius: 8, overflow: 'hidden' }}><div style={{ width: pct(count,scopedPeople.length)+'%', height: '100%', background: 'var(--crm-accent)', borderRadius: 8 }}/></div></div>)}</div></section>
    </div>
    <section style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}><strong>Manager and reporting-line activity</strong><span style={muted}>All reporting levels · weekday check-in days / possible person-days</span></div>
      {managerRows.length ? <div style={{ overflowX: 'auto', marginTop: 12 }}><table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', fontSize: 12 }}><thead><tr>{['Manager','Team size','Direct / indirect','Check-in activity','Check-ins','Details'].map(x=><th key={x} style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid var(--crm-border)', color: 'var(--crm-text-muted)' }}>{x}</th>)}</tr></thead><tbody>{managerRows.map(row=><><tr key={row.manager.id}><td style={{ padding: 10, borderBottom: '1px solid var(--crm-border)' }}><strong>{row.manager.full_name || row.manager.email}</strong><div style={muted}>{roleLabel(row.manager.role)}</div></td><td style={{ padding: 10, borderBottom: '1px solid var(--crm-border)' }}>{row.teamMembers.length}</td><td style={{ padding: 10, borderBottom: '1px solid var(--crm-border)' }}>{row.directCount} / {row.indirectCount}</td><td style={{ padding: 10, borderBottom: '1px solid var(--crm-border)', minWidth: 170 }}><strong>{row.activity}%</strong><div style={{ height: 6, background: 'var(--crm-border)', borderRadius: 8, marginTop: 6 }}><div style={{ height: '100%', width: row.activity+'%', background: row.activity>=80?'#22c55e':row.activity>=50?'#f59e0b':'#ef4444', borderRadius: 8 }}/></div></td><td style={{ padding: 10, borderBottom: '1px solid var(--crm-border)' }}>{row.logs.length}</td><td style={{ padding: 10, borderBottom: '1px solid var(--crm-border)' }}><button type="button" onClick={()=>setExpanded(expanded===row.manager.id?null:row.manager.id)} style={{ background: 'transparent', color: 'var(--crm-accent-strong)', border: 0, cursor: 'pointer' }}>{expanded===row.manager.id?'Hide':'View team'}</button></td></tr>{expanded===row.manager.id&&<tr key={row.manager.id+'-detail'}><td colSpan={6} style={{ padding: 12, background: 'var(--crm-card-raised)' }}>{row.teamMembers.map(p=>{const count=scopedAttendance.filter(a=>a.employee_id===p.id).length;return <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--crm-border)' }}><span>{p.full_name||p.email} <small style={muted}>· {roleLabel(p.role)}</small></span><strong>{count} check-ins</strong></div>;})}</td></tr>}</>)}</tbody></table></div> : <p style={muted}>No manager-to-employee assignments are available for this selection.</p>}
    </section>
    <KnowMore>Attendance activity counts saved check-ins, not online presence or work output. Late and not-signed-in rates require scheduled shifts; the late threshold is 5 minutes. Team activity is a trend indicator, not a contractual score. Telegram response rate includes only group questions and first replies attributable to linked CRM identities; it excludes private chats.</KnowMore>
  </div>;
}
