import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type Person = { id: string; full_name: string | null; email: string | null; role: string; active: boolean };
type Assignment = { manager_id: string; employee_id: string; created_at: string };
type Message = { telegram_chat_id: number; telegram_message_id: number; display_name: string | null; username: string | null; message_text: string | null; message_date: string; reply_to_message_id: number | null };
type Metric = { telegram_chat_id: number; question_message_id: number; question_user_id: number | null; first_reply_user_id: number | null; response_seconds: number | null; calculated_at: string };
type Group = { telegram_chat_id: number; title: string; enabled: boolean };

const panel: CSSProperties = { padding: 18, margin: '20px 0', border: '1px solid #344054', borderRadius: 12 };
const input: CSSProperties = { display: 'block', width: '100%', marginTop: 6, padding: 10, color: '#f8fafc', background: '#101828', border: '1px solid #475467', borderRadius: 8, boxSizing: 'border-box' };
const button: CSSProperties = { padding: '9px 13px', border: 0, borderRadius: 8, color: '#fff', background: '#f97316', cursor: 'pointer', fontWeight: 600 };
const muted: CSSProperties = { color: '#b7c0d1', fontSize: 13 };
const cell: CSSProperties = { padding: 10, borderBottom: '1px solid #344054', textAlign: 'left', verticalAlign: 'top' };

function prettyDuration(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return seconds + ' sec';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' min';
  return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
}

export default function ManagementTools({ supabase, profile, profiles }: {
  supabase: SupabaseClient | null;
  profile: Person | null;
  profiles: Person[];
}) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [managerId, setManagerId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [teamAttendance, setTeamAttendance] = useState<any[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const isAdmin = profile?.active === true && profile.role.toLowerCase() === 'admin';
  const isManager = profile?.active === true && profile.role.toLowerCase() === 'manager';

  async function load() {
    if (!supabase || (!isAdmin && !isManager)) return;
    setLoading(true);
    setNotice('');
    try {
      const [assignmentResult, groupResult, metricResult] = await Promise.all([
        supabase.from('manager_employee_assignments').select('manager_id,employee_id,created_at'),
        supabase.from('telegram_groups').select('telegram_chat_id,title,enabled').order('title'),
        supabase.from('telegram_response_metrics').select('telegram_chat_id,question_message_id,question_user_id,first_reply_user_id,response_seconds,calculated_at').order('calculated_at', { ascending: false }).limit(500),
      ]);
      if (assignmentResult.error) setNotice('Assignments: ' + assignmentResult.error.message);
      else setAssignments((assignmentResult.data ?? []) as Assignment[]);
      if (groupResult.error) setNotice((current) => current || 'Telegram groups: ' + groupResult.error.message);
      else setGroups((groupResult.data ?? []) as Group[]);
      if (metricResult.error) setNotice((current) => current || 'Telegram metrics: ' + metricResult.error.message);
      else setMetrics((metricResult.data ?? []) as Metric[]);
      const allowedGroupIds = (groupResult.data ?? []).map((g: Group) => g.telegram_chat_id);
      const chosen = selectedGroup === 'all' ? allowedGroupIds : [Number(selectedGroup)];
      if (chosen.length) {
        const messageResult = await supabase.from('telegram_messages')
          .select('telegram_chat_id,telegram_message_id,display_name,username,message_text,message_date,reply_to_message_id')
          .in('telegram_chat_id', chosen).order('message_date', { ascending: false }).limit(300);
        if (messageResult.error) setNotice((current) => current || 'Telegram messages: ' + messageResult.error.message);
        else setMessages((messageResult.data ?? []) as Message[]);
      } else setMessages([]);
      if (isManager) {
        const mine = ((assignmentResult.data ?? []) as Assignment[]).filter(a => a.manager_id === profile?.id).map(a => a.employee_id);
        if (mine.length) {
          const attendanceResult = await supabase.from('attendance')
            .select('id,employee_id,check_in,check_out,work_date,work_timezone,check_in_lat,check_in_lng,check_out_lat,check_out_lng')
            .in('employee_id', mine).order('check_in', { ascending: false }).limit(500);
          if (attendanceResult.error) setNotice((current) => current || 'Team attendance: ' + attendanceResult.error.message);
          else setTeamAttendance(attendanceResult.data ?? []);
        } else setTeamAttendance([]);
      }
    } catch {
      setNotice('Could not load management data. Check the database migration and access policies.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [supabase, profile?.id, profile?.role, selectedGroup]);

  async function addAssignment() {
    if (!supabase || !managerId || !employeeId) return;
    setLoading(true); setNotice('');
    const { error } = await supabase.from('manager_employee_assignments').upsert({
      manager_id: managerId, employee_id: employeeId, created_by: profile?.id,
    }, { onConflict: 'manager_id,employee_id' });
    if (error) setNotice('Could not save assignment: ' + error.message);
    else { setNotice('Assignment saved.'); await load(); }
    setLoading(false);
  }

  async function removeAssignment(a: Assignment) {
    if (!supabase) return;
    setLoading(true);
    const { error } = await supabase.from('manager_employee_assignments').delete()
      .eq('manager_id', a.manager_id).eq('employee_id', a.employee_id);
    setNotice(error ? 'Could not remove assignment: ' + error.message : 'Assignment removed.');
    await load(); setLoading(false);
  }

  if (!isAdmin && !isManager) return null;
  const managers = profiles.filter(p => p.active && p.role.toLowerCase() === 'manager');
  const employees = profiles.filter(p => p.active && p.role.toLowerCase() !== 'admin' && p.role.toLowerCase() !== 'manager');
  const myAssignments = assignments.filter(a => a.manager_id === profile?.id);
  const personName = (id: string) => profiles.find(p => p.id === id)?.full_name || profiles.find(p => p.id === id)?.email || id;
  const selectedMetrics = metrics.filter(m => selectedGroup === 'all' || String(m.telegram_chat_id) === selectedGroup);
  const answered = selectedMetrics.filter(m => m.response_seconds != null);
  const avgSeconds = answered.length ? Math.round(answered.reduce((sum, m) => sum + (m.response_seconds ?? 0), 0) / answered.length) : null;

  return <section style={panel}>
    <h2 style={{ marginTop: 0 }}>{isAdmin ? 'Team management' : 'My team'}</h2>
    <p style={muted}>Manager access is determined by database assignments and row-level security, not by the screen alone.</p>
    {isAdmin && <>
      <h3>Assign employees to managers</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12 }}>
        <label>Manager<select style={input} value={managerId} onChange={e => setManagerId(e.target.value)}><option value="">Choose manager</option>{managers.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select></label>
        <label>Employee<select style={input} value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">Choose employee</option>{employees.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select></label>
      </div>
      <button type="button" style={{ ...button, marginTop: 12 }} disabled={loading || !managerId || !employeeId} onClick={() => void addAssignment()}>Save assignment</button>
      <div style={{ overflowX: 'auto', marginTop: 14 }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={cell}>Manager</th><th style={cell}>Employee</th><th style={cell}>Assigned</th><th style={cell}>Action</th></tr></thead>
        <tbody>{assignments.map(a => <tr key={a.manager_id + ':' + a.employee_id}><td style={cell}>{personName(a.manager_id)}</td><td style={cell}>{personName(a.employee_id)}</td><td style={cell}>{new Date(a.created_at).toLocaleDateString()}</td><td style={cell}><button type="button" style={{ ...button, background: '#b42318' }} disabled={loading} onClick={() => void removeAssignment(a)}>Remove</button></td></tr>)}</tbody>
      </table></div>
    </>}
    {isManager && <>
      <h3>Assigned employees</h3>
      {myAssignments.length ? <ul>{myAssignments.map(a => <li key={a.employee_id}>{personName(a.employee_id)}</li>)}</ul> : <p>No employees have been assigned to you yet.</p>}
      <h3>Team attendance</h3>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Employee','Work date','Check-in','Check-out','GPS'].map(x => <th key={x} style={cell}>{x}</th>)}</tr></thead>
        <tbody>{teamAttendance.map(a => <tr key={a.id}><td style={cell}>{personName(a.employee_id)}</td><td style={cell}>{a.work_date || a.check_in?.slice(0,10)}</td><td style={cell}>{a.check_in ? new Date(a.check_in).toLocaleString() : '—'}</td><td style={cell}>{a.check_out ? new Date(a.check_out).toLocaleString() : 'Open session'}</td><td style={cell}>{a.check_in_lat != null && a.check_in_lng != null ? <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${a.check_in_lat},${a.check_in_lng}`}>📍 Check-in</a> : '—'}{a.check_out_lat != null && a.check_out_lng != null ? <> · <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${a.check_out_lat},${a.check_out_lng}`}>📍 Check-out</a></> : null}</td></tr>)}</tbody>
      </table></div>
    </>}
    <hr style={{ borderColor: '#344054', margin: '24px 0' }}/>
    <h2>Telegram group analytics</h2>
    <p style={muted}>Messages and reply metrics collected after the bot is added to an authorized work group and its webhook is configured. Telegram does not provide group read receipts or arbitrary historic messages to bots.</p>
    <label>Group<select style={{ ...input, maxWidth: 420 }} value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}><option value="all">All groups</option>{groups.map(g => <option key={g.telegram_chat_id} value={String(g.telegram_chat_id)}>{g.title} ({g.telegram_chat_id})</option>)}</select></label>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 12, margin: '14px 0' }}>
      <article style={{ padding: 14, border: '1px solid #344054', borderRadius: 10 }}><div style={muted}>Messages loaded</div><strong style={{ fontSize: 24 }}>{messages.length}</strong></article>
      <article style={{ padding: 14, border: '1px solid #344054', borderRadius: 10 }}><div style={muted}>Replies measured</div><strong style={{ fontSize: 24 }}>{answered.length}</strong></article>
      <article style={{ padding: 14, border: '1px solid #344054', borderRadius: 10 }}><div style={muted}>Average response</div><strong style={{ fontSize: 24 }}>{prettyDuration(avgSeconds)}</strong></article>
    </div>
    {notice && <p role="status" style={{ padding: 10, background: '#202b3e', borderRadius: 8, overflowWrap: 'anywhere' }}>{notice}</p>}
    {loading && <p style={muted}>Loading management data…</p>}
    <h3>Recent messages</h3>
    <div style={{ overflowX: 'auto', maxHeight: 420 }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>{['Time','Group','Sender','Message','Reply to'].map(x => <th key={x} style={cell}>{x}</th>)}</tr></thead>
      <tbody>{messages.map(m => <tr key={m.telegram_chat_id + ':' + m.telegram_message_id}><td style={{ ...cell, whiteSpace: 'nowrap' }}>{new Date(m.message_date).toLocaleString()}</td><td style={cell}>{groups.find(g => g.telegram_chat_id === m.telegram_chat_id)?.title || m.telegram_chat_id}</td><td style={cell}>{m.display_name || m.username || 'Unknown'}{m.username ? ' @' + m.username : ''}</td><td style={{ ...cell, minWidth: 240, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.message_text || '[non-text message]'}</td><td style={cell}>{m.reply_to_message_id ?? '—'}</td></tr>)}</tbody>
    </table></div>
    <h3>Response-time samples</h3>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['Group','Question message','Response time','Measured'].map(x => <th key={x} style={cell}>{x}</th>)}</tr></thead><tbody>{selectedMetrics.slice(0,100).map(m => <tr key={m.telegram_chat_id + ':' + m.question_message_id}><td style={cell}>{groups.find(g => g.telegram_chat_id === m.telegram_chat_id)?.title || m.telegram_chat_id}</td><td style={cell}>{m.question_message_id}</td><td style={cell}>{prettyDuration(m.response_seconds)}</td><td style={cell}>{new Date(m.calculated_at).toLocaleString()}</td></tr>)}</tbody></table></div>
  </section>;
}
