import { useEffect, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type Person = { id: string; full_name: string | null; email: string | null; role: string; active: boolean };
type Assignment = { manager_id: string; employee_id: string; created_at: string };
type TeamNode = { id: string; email: string | null; full_name: string | null; role: string; active: boolean; manager_id: string; depth: number };
type Message = { telegram_chat_id: number; telegram_message_id: number; display_name: string | null; username: string | null; message_text: string | null; message_date: string; reply_to_message_id: number | null; raw_update?: Record<string, any> | null; message_kind?: string | null };
type Metric = { telegram_chat_id: number; question_message_id: number; question_user_id: number | null; first_reply_user_id: number | null; response_seconds: number | null; calculated_at: string };
type Group = { telegram_chat_id: number; title: string; enabled: boolean };
type TelegramMember = { id: number; telegram_chat_id: number; telegram_user_id: number; username: string | null; display_name: string | null; profile_id: string | null };

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

export default function ManagementTools({ supabase, profile, profiles, page = 'all' }: {
  supabase: SupabaseClient | null;
  profile: Person | null;
  profiles: Person[];
  page?: 'all' | 'team' | 'telegram';
}) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [managerId, setManagerId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [teamAttendance, setTeamAttendance] = useState<any[]>([]);
  const [teamTree, setTeamTree] = useState<TeamNode[]>([]);
  const [roleSelections, setRoleSelections] = useState<Record<string, string>>({});
  const [inviteRole, setInviteRole] = useState('junior');
  const [inviteAdminPanelName, setInviteAdminPanelName] = useState('');
  const [inviteCorporateEmail, setInviteCorporateEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [telegramMembers, setTelegramMembers] = useState<TelegramMember[]>([]);
  const [memberProfileSelections, setMemberProfileSelections] = useState<Record<number, string>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [activeMedia, setActiveMedia] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [mediaLoading, setMediaLoading] = useState('');
  const [mediaErrors, setMediaErrors] = useState<Record<string, string>>({});
  const isAdmin = profile?.active === true && profile.role.toLowerCase() === 'admin';
  const normalizedRole = String(profile?.role || '').toLowerCase().replaceAll('_', ' ');
  const isManager = profile?.active === true && ['middle', 'senior', 'team leader'].includes(normalizedRole);

  async function load() {
    if (!supabase || (!isAdmin && !isManager)) return;
    setLoading(true);
    setNotice('');
    try {
      const [assignmentResult, groupResult, metricResult, treeResult] = await Promise.all([
        supabase.from('manager_employee_assignments').select('manager_id,employee_id,created_at'),
        supabase.from('telegram_groups').select('telegram_chat_id,title,enabled').order('title'),
        supabase.from('telegram_response_metrics').select('telegram_chat_id,question_message_id,question_user_id,first_reply_user_id,response_seconds,calculated_at').order('calculated_at', { ascending: false }).limit(500),
        supabase.rpc('get_my_team_hierarchy'),
      ]);
      if (isAdmin) {
        const memberResult = await supabase.from('telegram_group_members')
          .select('id,telegram_chat_id,telegram_user_id,username,display_name,profile_id')
          .order('display_name').limit(1000);
        if (memberResult.error) setNotice((current) => current || 'Telegram members: ' + memberResult.error.message);
        else {
          const rows = (memberResult.data ?? []) as TelegramMember[];
          setTelegramMembers(rows);
          setMemberProfileSelections((current) => {
            const next = { ...current };
            for (const row of rows) if (next[row.id] === undefined) next[row.id] = row.profile_id ?? '';
            return next;
          });
        }
      }
      if (assignmentResult.error) setNotice('Assignments: ' + assignmentResult.error.message);
      else setAssignments((assignmentResult.data ?? []) as Assignment[]);
      if (treeResult.error) setNotice((current) => current || 'Team hierarchy: ' + treeResult.error.message);
      else setTeamTree((treeResult.data ?? []) as TeamNode[]);
      if (groupResult.error) setNotice((current) => current || 'Telegram groups: ' + groupResult.error.message);
      else setGroups((groupResult.data ?? []) as Group[]);
      if (metricResult.error) setNotice((current) => current || 'Telegram metrics: ' + metricResult.error.message);
      else setMetrics((metricResult.data ?? []) as Metric[]);
      const chosen = selectedGroup ? [Number(selectedGroup)] : [];
      if (chosen.length) {
        const messageResult = await supabase.from('telegram_messages')
          .select('telegram_chat_id,telegram_message_id,display_name,username,message_text,message_date,reply_to_message_id,raw_update,message_kind')
          .in('telegram_chat_id', chosen).order('message_date', { ascending: false }).limit(300);
        if (messageResult.error) setNotice((current) => current || 'Telegram messages: ' + messageResult.error.message);
        else setMessages((messageResult.data ?? []) as Message[]);
      } else setMessages([]);
      if (isManager) {
        const mine = [...new Set(((treeResult.data ?? []) as TeamNode[]).map(person => person.id))];
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

  useEffect(() => {
    return () => { if (activeMedia?.url) URL.revokeObjectURL(activeMedia.url); };
  }, [activeMedia?.url]);

  useEffect(() => { setActiveMedia(null); setMediaLoading(''); }, [selectedGroup, profile?.id]);

  async function openAttachment(message: Message, name: string) {
    if (!supabase) return;
    const key = message.telegram_chat_id + ':' + message.telegram_message_id;
    setMediaLoading(key);
    setMediaErrors(current => ({ ...current, [key]: '' }));
    setNotice('');
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error('Please sign in again to view this attachment.');
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !publishableKey) throw new Error('Supabase URL/key are missing from the deployed frontend environment. Check GitHub Pages build variables.');
      const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/telegram-media-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: publishableKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ chat_id: message.telegram_chat_id, message_id: message.telegram_message_id }),
      });
      if (!response.ok) {
        const contentType = response.headers.get('Content-Type') || '';
        const body = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
        const detail = body.error || (response.status === 404
          ? 'Media proxy endpoint not found. Deploy the telegram-media-proxy Edge Function in the Supabase project used by this CRM.'
          : response.status === 401 ? 'Your session expired. Sign out and sign back in.'
          : response.status === 403 ? 'Your CRM role or Telegram group access does not permit this attachment.'
          : `Attachment request failed (${response.status}). Check Supabase Edge Function logs.`);
        throw new Error(detail);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('The media service returned an empty file. Check the Telegram file metadata and Edge Function logs.');
      const mime = blob.type || response.headers.get('Content-Type') || 'application/octet-stream';
      if (mime.includes('application/json') || mime.includes('text/plain')) {
        const text = await blob.text();
        try { const body = JSON.parse(text); throw new Error(body.error || 'The media service returned an error instead of a file.'); }
        catch (error) { if (error instanceof Error && error.message !== 'Unexpected end of JSON input') throw error; throw new Error('The media service returned an error instead of a file.'); }
      }
      const url = URL.createObjectURL(blob);
      setActiveMedia({ url, mime, name });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Could not open attachment.';
      setMediaErrors(current => ({ ...current, [key]: messageText }));
      setNotice(messageText);
    } finally { setMediaLoading(''); }
  }

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

  async function saveTelegramMemberLink(member: TelegramMember) {
    if (!supabase || !isAdmin) return;
    setLoading(true); setNotice('');
    const selectedProfile = memberProfileSelections[member.id] || null;
    const { error } = await supabase.from('telegram_group_members').update({ profile_id: selectedProfile }).eq('id', member.id);
    setNotice(error ? 'Could not link Telegram member: ' + error.message : 'Telegram identity link saved.');
    if (!error) await load();
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
  const managers = profiles.filter(p => p.active && ['middle','senior','team_leader'].includes(p.role.toLowerCase()));
  const employees = profiles.filter(p => p.active && p.role.toLowerCase() !== 'admin' && !['manager','employee'].includes(p.role.toLowerCase()));
  const inviteRoles = isAdmin ? ['team_leader','senior','middle','junior','telemarketing'] : normalizedRole === 'team leader' ? ['senior','middle','junior'] : normalizedRole === 'senior' ? ['middle','junior'] : ['junior'];
  const myAssignments = assignments.filter(a => a.manager_id === profile?.id);
  const personName = (id: string) => profiles.find(p => p.id === id)?.full_name || profiles.find(p => p.id === id)?.email || id;
  const selectedMetrics = metrics.filter(m => selectedGroup !== '' && String(m.telegram_chat_id) === selectedGroup);
  const renderTeamNode = (person: TeamNode, depth = 0): ReactElement => {
    const children = teamTree.filter(child => child.manager_id === person.id);
    const expanded = Boolean(expandedManagers[person.id]);
    return <div key={person.id} style={{border:'1px solid #344054',borderRadius:8,padding:8,marginLeft:Math.min(depth,5)*12}}>
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
        <button type="button" style={{...button,background:'#344054',textAlign:'left'}} onClick={()=>setExpandedManagers(current=>({...current,[person.id]:!current[person.id]}))}>{children.length ? (expanded?'−':'+') : '•'} {person.full_name||person.email||person.id}</button>
        <span style={{...muted,margin:0}}>{person.role}</span>
      </div>
      {expanded && children.length>0 && <div style={{display:'grid',gap:6,marginTop:8}}>{children.map(child=>renderTeamNode(child,depth+1))}</div>}
    </div>;
  };
  const answered = selectedMetrics.filter(m => m.response_seconds != null);
  const avgSeconds = answered.length ? Math.round(answered.reduce((sum, m) => sum + (m.response_seconds ?? 0), 0) / answered.length) : null;

  return <section style={panel}>
    {page !== 'telegram' && <>
    <h2 style={{ marginTop: 0 }}>{isAdmin ? 'Team management' : 'My team'}</h2>
    <p style={muted}>Manager access is determined by database assignments and row-level security, not by the screen alone.</p>
    {isAdmin && <>
      <h3>Employee role management</h3>
      <p style={muted}>Admin accounts are protected and cannot be changed through this role selector.</p>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead><tr><th style={cell}>Employee</th><th style={cell}>Current role</th><th style={cell}>New role</th><th style={cell}>Action</th></tr></thead>
        <tbody>{profiles.filter(p=>p.active && p.role.toLowerCase()!=='admin').map(p=><tr key={p.id}>
          <td style={cell}>{p.full_name || p.email || p.id}</td><td style={cell}>{p.role}</td>
          <td style={cell}><select style={input} value={roleSelections[p.id] ?? p.role.toLowerCase().replaceAll(' ','_')} onChange={e=>setRoleSelections(current=>({...current,[p.id]:e.target.value}))}>
            {['junior','middle','senior','team_leader','telemarketing'].map(role=><option key={role} value={role}>{role==='team_leader'?'Team Leader':role[0].toUpperCase()+role.slice(1)}</option>)}
          </select></td>
          <td style={cell}><button type="button" style={button} disabled={loading || (roleSelections[p.id] ?? p.role.toLowerCase().replaceAll(' ','_'))===p.role.toLowerCase().replaceAll(' ','_')} onClick={async()=>{if(!supabase)return;setLoading(true);setNotice('');const {error}=await supabase.rpc('set_employee_role',{target_profile:p.id,new_role:roleSelections[p.id]});setNotice(error?'Could not update role: '+error.message:'Role updated.');if(!error)await load();setLoading(false);}}>Save role</button></td>
        </tr>)}</tbody></table></div>
      <h3>Link Telegram members to CRM employees</h3>
      <p style={muted}>Verify the Telegram user ID against the employee before saving. These links control which Telegram analytics managers can see.</p>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Telegram group','Telegram user','User ID','CRM employee','Action'].map(x => <th key={x} style={cell}>{x}</th>)}</tr></thead>
        <tbody>{telegramMembers.map(member => <tr key={member.id}>
          <td style={cell}>{groups.find(g => g.telegram_chat_id === member.telegram_chat_id)?.title || member.telegram_chat_id}</td>
          <td style={cell}>{member.display_name || 'Unknown'}{member.username ? ' @' + member.username : ''}</td>
          <td style={cell}>{member.telegram_user_id}</td>
          <td style={{ ...cell, minWidth: 220 }}><select style={input} value={memberProfileSelections[member.id] ?? ''} onChange={e => setMemberProfileSelections(current => ({ ...current, [member.id]: e.target.value }))}><option value="">Not linked</option>{profiles.filter(p => p.active && p.role.toLowerCase() !== 'admin').map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select></td>
          <td style={cell}><button type="button" style={button} disabled={loading || (memberProfileSelections[member.id] ?? '') === (member.profile_id ?? '')} onClick={() => void saveTelegramMemberLink(member)}>Save link</button></td>
        </tr>)}</tbody>
      </table></div>
      {!telegramMembers.length && <p style={muted}>No Telegram members found yet. Send messages in the test group and refresh the page.</p>}
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
    {(isManager || isAdmin) && <>
      <h3>{isAdmin ? 'Admin invitation — choose any role' : 'Invite an employee'}</h3>
      <p style={muted}>{isAdmin ? 'Admin can invite any role, including Telemarketing. Telemarketing is a separate track and does not join the reporting hierarchy.' : 'Generate a single-use registration link that expires in 24 hours. If registration has not happened, creating a replacement invitation for the same person invalidates the previous link. Existing accounts cannot use invitations to change roles.'}</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10}}>
        <label>Admin Panel Name<input style={input} value={inviteAdminPanelName} onChange={e=>setInviteAdminPanelName(e.target.value)} maxLength={120} required placeholder="Exact name from your Admin Panel"/></label>
        <label>Corporate Email<input style={input} type="email" value={inviteCorporateEmail} onChange={e=>setInviteCorporateEmail(e.target.value.trimStart())} maxLength={254} required placeholder="employee@company.com"/></label>
        <label>Role<select style={input} value={inviteRole} onChange={e=>setInviteRole(e.target.value)}>{inviteRoles.map(r=><option key={r} value={r}>{r==='team_leader'?'Team Leader':r[0].toUpperCase()+r.slice(1)}</option>)}</select></label>
        <div style={{display:'flex',alignItems:'end'}}><button type="button" style={button} disabled={inviteLoading || !inviteAdminPanelName.trim() || !inviteCorporateEmail.trim()} onClick={async()=>{if(!supabase){setNotice('Database connection is not configured. Please contact the CRM administrator.');return;}setInviteLoading(true);setInviteUrl('');setNotice('Generating invitation link…');try{const {data,error}=await supabase.rpc('create_manager_invitation',{invited_role:inviteRole,invitee_admin_panel_name:inviteAdminPanelName.trim(),invitee_corporate_email:inviteCorporateEmail.trim().toLowerCase()});if(error)throw new Error(error.message);if(typeof data!=='string'||!data.trim())throw new Error('The database did not return an invitation token. Confirm the latest invitation SQL migration has been applied in Supabase.');const url=new URL(window.location.href);url.searchParams.set('invite',data);url.hash='';setInviteUrl(url.toString());setNotice('Invitation created. Share it only with the intended new employee.');}catch(error){setNotice('Could not create invitation: '+(error instanceof Error?error.message:'Unexpected error. Please try again.'));}finally{setInviteLoading(false);}}}>{inviteLoading?'Generating…':'Generate invitation link'}</button></div>
      </div>
      {notice && <p role="status" style={{padding:10,marginTop:10,background:'#202b3e',borderRadius:8,overflowWrap:'anywhere'}}>{notice}</p>}
      {inviteUrl && <div style={{marginTop:12,padding:12,border:'1px solid #475467',borderRadius:8,overflowWrap:'anywhere'}}>
        <input aria-label="Invitation link" readOnly value={inviteUrl} style={input}/>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>
          <button type="button" style={button} onClick={()=>{void navigator.clipboard.writeText(inviteUrl);setNotice('Invitation link copied.');}}>Copy link</button>
          <a href={'https://t.me/share/url?url='+encodeURIComponent(inviteUrl)+'&text='+encodeURIComponent('You are invited to the Attendance CRM. Open this link to register and verify your identity.')} target="_blank" rel="noreferrer" style={{...button,textDecoration:'none'}}>Share via Telegram</a>
          <a href={'https://wa.me/?text='+encodeURIComponent('You are invited to the Attendance CRM: '+inviteUrl)} target="_blank" rel="noreferrer" style={{...button,textDecoration:'none'}}>Share via WhatsApp</a>
        </div>
      </div>}
      {!isAdmin && <>
      <h3>Reporting hierarchy</h3>
      <p style={muted}>People below are loaded from saved manager-to-employee database relationships.</p>
      <div style={{display:'grid',gap:8}}>{teamTree.filter(person=>person.manager_id===profile?.id).map(person=>renderTeamNode(person))}{teamTree.length===0&&<p style={muted}>No subordinate relationships found yet.</p>}</div>
      <h3>Assigned employees</h3>
      {myAssignments.length ? <ul>{myAssignments.map(a => <li key={a.employee_id}>{personName(a.employee_id)}</li>)}</ul> : <p>No employees have been assigned to you yet.</p>}
      <h3>Team attendance</h3>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Employee','Work date','Check-in','Check-out','GPS'].map(x => <th key={x} style={cell}>{x}</th>)}</tr></thead>
        <tbody>{teamAttendance.map(a => <tr key={a.id}><td style={cell}>{personName(a.employee_id)}</td><td style={cell}>{a.work_date || a.check_in?.slice(0,10)}</td><td style={cell}>{a.check_in ? new Date(a.check_in).toLocaleString() : '—'}</td><td style={cell}>{a.check_out ? new Date(a.check_out).toLocaleString() : 'Open session'}</td><td style={cell}>{a.check_in_lat != null && a.check_in_lng != null ? <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${a.check_in_lat},${a.check_in_lng}`}>📍 Check-in</a> : '—'}{a.check_out_lat != null && a.check_out_lng != null ? <> · <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${a.check_out_lat},${a.check_out_lng}`}>📍 Check-out</a></> : null}</td></tr>)}</tbody>
      </table></div>
      </>}
    </>}
    </>}
    {page !== 'team' && <>
    <hr style={{ borderColor: '#344054', margin: '24px 0' }}/>
    <h2>Telegram group analytics</h2>
    <p style={muted}>Messages and reply metrics collected after the bot is added to an authorized work group and its webhook is configured. Telegram does not provide group read receipts or arbitrary historic messages to bots.</p>
    <div style={{ padding: 14, margin: '12px 0 18px', border: '1px solid #b54708', borderRadius: 10, background: '#261b12' }}>
      <strong>Connect your work group with the dedicated CRM analytics bot</strong>
      <p style={muted}>This integration must use a separate Telegram bot created specifically for CRM group analytics. Do not use <code>@mbpauthbot</code>; it remains reserved for authentication.</p>
      <ol style={{ paddingLeft: 22, lineHeight: 1.7 }}>
        <li>Create a dedicated bot with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: '#fdba74' }}>@BotFather</a> and store its token as the Supabase Edge Function secret <code>TELEGRAM_BOT_TOKEN</code>. Do not put the token in this CRM or GitHub frontend files.</li>
        <li>Set <code>TELEGRAM_WEBHOOK_SECRET</code> and deploy the <code>telegram-group-webhook</code> Supabase Edge Function. Configure the Telegram webhook with the same secret token.</li>
        <li>Add the new analytics bot to each authorized work group. Enable group message access in BotFather (disable privacy mode if the bot must receive ordinary group messages); grant only the permissions needed.</li>
        <li>Send a new test message and reply in the group. New messages should appear below after the database migration is applied and the webhook is configured.</li>
      </ol>
      <p style={muted}>The bot cannot import older group history or read receipts. Avoid collecting private or unrelated conversations; tell group participants what is logged and obtain the required consent.</p>
    </div>
    <label style={{ display:'block', maxWidth:460, margin:'18px 0' }}>Select a group chat<select style={{ ...input, maxWidth: 460 }} value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}><option value="">Choose a Telegram group to open…</option>{groups.filter(g=>g.enabled).map(g => <option key={g.telegram_chat_id} value={String(g.telegram_chat_id)}>{g.title}</option>)}</select></label>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 12, margin: '14px 0' }}>
      <article style={{ padding: 14, border: '1px solid #344054', borderRadius: 10 }}><div style={muted}>Messages loaded</div><strong style={{ fontSize: 24 }}>{messages.length}</strong></article>
      <article style={{ padding: 14, border: '1px solid #344054', borderRadius: 10 }}><div style={muted}>Replies measured</div><strong style={{ fontSize: 24 }}>{answered.length}</strong></article>
      <article style={{ padding: 14, border: '1px solid #344054', borderRadius: 10 }}><div style={muted}>Average response</div><strong style={{ fontSize: 24 }}>{prettyDuration(avgSeconds)}</strong></article>
    </div>
    {notice && <p role="status" style={{ padding: 10, background: '#202b3e', borderRadius: 8, overflowWrap: 'anywhere' }}>{notice}</p>}
    {loading && <p style={muted}>Loading management data…</p>}
    {!selectedGroup ? <div style={{ padding:34, border:'1px dashed #475467', borderRadius:14, textAlign:'center', color:'#b7c0d1', background:'#101828' }}><div style={{ fontSize:30, marginBottom:10 }}>💬</div><strong style={{ color:'#f8fafc' }}>Choose a group to open its chat</strong><p style={muted}>Messages stay hidden until you select a Telegram group above.</p></div> : <>
      <h3>Chat · {groups.find(g=>String(g.telegram_chat_id)===selectedGroup)?.title || 'Selected group'}</h3>
      <div style={{ border:'1px solid #344054', borderRadius:14, overflow:'hidden', background:'#0e1726' }}>
        <header style={{ padding:'13px 16px', background:'#18263a', borderBottom:'1px solid #344054', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}><div><strong>{groups.find(g=>String(g.telegram_chat_id)===selectedGroup)?.title || 'Telegram group'}</strong><div style={{ ...muted, marginTop:3 }}>{messages.length} captured messages · newest first</div></div><span style={{ fontSize:11, color:'#8dd8ae' }}>● CRM archive</span></header>
        <div style={{ padding:16, display:'flex', flexDirection:'column', gap:10, maxHeight:480, overflowY:'auto', backgroundImage:'radial-gradient(#24344b 0.7px, transparent 0.7px)', backgroundSize:'14px 14px' }}>
          {[...messages].filter(m=>String(m.telegram_chat_id)===selectedGroup).reverse().map(m => { const raw=m.raw_update || {}; const msg=(raw.message || raw.edited_message || raw.channel_post || raw.edited_channel_post || {}) as Record<string, any>; const photo=Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length-1] : null; const doc=msg.document || msg.video || msg.animation || msg.audio || msg.voice || null; const media=photo || doc; const mediaName=doc?.file_name || (photo ? 'Photo attachment' : msg.video ? 'Video attachment' : msg.voice ? 'Voice message' : msg.sticker ? 'Sticker' : null); return <article key={m.telegram_chat_id+':'+m.telegram_message_id} style={{ alignSelf:'flex-start', width:'fit-content', maxWidth:'min(620px, 92%)', padding:'9px 12px 7px', border:'1px solid #30445b', borderRadius:'4px 13px 13px 13px', background:'#1b2b40', color:'#edf4ff', boxShadow:'0 1px 2px #0002' }}><div style={{ color:'#8ed0ff', fontSize:12, fontWeight:700, marginBottom:5 }}>{m.display_name || (m.username ? '@'+m.username : 'Unknown sender')}</div>{media && <div style={{margin:'6px 0',padding:10,border:'1px solid #41566e',background:'#132033',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}><span style={{fontSize:24}}>{photo ? '🖼️' : msg.video ? '🎞️' : msg.voice || msg.audio ? '🎙️' : msg.sticker ? '✨' : '📎'}</span><span style={{fontSize:12,overflowWrap:'anywhere',flex:1,minWidth:120}}><strong>{mediaName || 'Attachment'}</strong><br/><span style={{color:'#9aaec5'}}>{media.file_size ? (media.file_size > 1048576 ? (media.file_size / 1048576).toFixed(1)+' MB' : Math.max(1,Math.round(media.file_size / 1024))+' KB')+' · ' : ''}Private on-demand preview</span></span><button type="button" style={{...button,padding:'7px 10px',fontSize:12}} disabled={mediaLoading===m.telegram_chat_id+':'+m.telegram_message_id} onClick={() => void openAttachment(m, mediaName || 'Telegram attachment')}>{mediaLoading===m.telegram_chat_id+':'+m.telegram_message_id ? 'Loading…' : 'Preview'}</button>{mediaErrors[m.telegram_chat_id+':'+m.telegram_message_id] && <p role="alert" style={{width:'100%',margin:'4px 0 0',color:'#fda29b',fontSize:12,overflowWrap:'anywhere'}}>{mediaErrors[m.telegram_chat_id+':'+m.telegram_message_id]}</p>}</div>}<div style={{ whiteSpace:'pre-wrap', overflowWrap:'anywhere', lineHeight:1.5, fontSize:14 }}>{m.message_text || (!media ? '[non-text message]' : '')}</div><div style={{ textAlign:'right', color:'#91a2b8', fontSize:10, marginTop:5 }}>{new Date(m.message_date).toLocaleString()}{m.reply_to_message_id ? ' · ↩ '+m.reply_to_message_id : ''}</div></article> })}
          {!messages.some(m=>String(m.telegram_chat_id)===selectedGroup) && <p style={{ ...muted, textAlign:'center', padding:20 }}>No captured messages for this group yet. New messages appear after the analytics bot receives them.</p>}
        </div>
        {activeMedia && <div role="dialog" aria-modal="true" aria-label="Telegram attachment preview" style={{position:'fixed',inset:0,zIndex:1000,background:'#020617eF',display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={() => setActiveMedia(null)}><div style={{width:'min(900px,100%)',maxHeight:'90vh',overflow:'auto',background:'#101828',border:'1px solid #475467',borderRadius:14,padding:16}} onClick={e => e.stopPropagation()}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:12}}><strong style={{overflowWrap:'anywhere'}}>{activeMedia.name}</strong><button type="button" style={button} onClick={() => setActiveMedia(null)}>Close</button></div>{activeMedia.mime.startsWith('image/') ? <img src={activeMedia.url} alt={activeMedia.name} style={{display:'block',maxWidth:'100%',maxHeight:'70vh',margin:'0 auto',objectFit:'contain'}}/> : activeMedia.mime.startsWith('video/') ? <video src={activeMedia.url} controls playsInline style={{display:'block',width:'100%',maxHeight:'70vh'}}/> : activeMedia.mime.startsWith('audio/') ? <audio src={activeMedia.url} controls style={{width:'100%'}}/> : <p style={muted}>This file type is not previewable in the browser. Use the button below to open or save it.</p>}<div style={{marginTop:14}}><a href={activeMedia.url} download={activeMedia.name} target="_blank" rel="noreferrer" style={{...button,display:'inline-block',textDecoration:'none'}}>Download / open file</a></div><p style={muted}>This temporary preview stays in memory and is cleared when closed or when you change groups.</p></div></div>}
        <footer style={{ padding:'10px 14px', borderTop:'1px solid #344054', color:'#8291a8', fontSize:11 }}>Read-only view of messages captured by the CRM analytics bot. Sending messages from this window is not supported.</footer>
      </div>
    </>}
    <h3>Response-time samples</h3>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['Group','Question message','Response time','Measured'].map(x => <th key={x} style={cell}>{x}</th>)}</tr></thead><tbody>{selectedMetrics.slice(0,100).map(m => <tr key={m.telegram_chat_id + ':' + m.question_message_id}><td style={cell}>{groups.find(g => g.telegram_chat_id === m.telegram_chat_id)?.title || m.telegram_chat_id}</td><td style={cell}>{m.question_message_id}</td><td style={cell}>{prettyDuration(m.response_seconds)}</td><td style={cell}>{new Date(m.calculated_at).toLocaleString()}</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}
