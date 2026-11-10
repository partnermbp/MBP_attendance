import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { supabase } from '../lib/supabase';
import KnowMore from './KnowMore';

type Person = { id: string; full_name: string | null; email: string | null; role: string; active: boolean };
type Leave = { id: string; employee_id: string; leave_type: string; start_date: string; end_date: string; reason: string | null; status: string; created_at: string; review_note: string | null };
type Correction = { id: string; employee_id: string; attendance_id: string | null; work_date: string; requested_check_in: string | null; requested_check_out: string | null; reason: string; status: string; created_at: string; review_note: string | null; applied_at?: string | null };
type Followup = { id: string; employee_id: string; assigned_to: string; created_by: string; title: string; notes: string | null; due_date: string | null; priority: string; status: string; resolution_note: string | null };
type Holiday = { id: string; holiday_date: string; name: string };

const panel: CSSProperties = { padding: 16, border: '1px solid var(--crm-border)', borderRadius: 12, background: 'var(--crm-card)' };
const field: CSSProperties = { display: 'block', width: '100%', marginTop: 5, padding: 10, borderRadius: 8, border: '1px solid var(--crm-border)', background: 'var(--crm-control-bg)', color: 'var(--crm-text)' };
const action: CSSProperties = { padding: '9px 13px', border: 0, borderRadius: 8, background: 'var(--crm-accent-strong)', color: '#fff', fontWeight: 700, cursor: 'pointer' };
const muted: React.CSSProperties = { color: 'var(--crm-text-muted)', fontSize: 12 };

export default function WorkforceOperations({ profile, profiles, isAdmin, isSupervisor, attendance = [], shifts = [] }: { profile: Person | null; profiles: Person[]; isAdmin: boolean; isSupervisor: boolean; attendance?: Array<{id:string;employee_id?:string;check_in:string;check_out:string|null;work_date?:string|null;work_timezone?:string|null;auto_closed?:boolean|null}>; shifts?: Array<{id:string;employee_id?:string;starts_at:string;ends_at:string}> }) {
  const [tab, setTab] = useState<'leave'|'corrections'|'followups'|'holidays'>('leave');
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [leaveType, setLeaveType] = useState('Annual leave');
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0,10));
  const [checkIn, setCheckIn] = useState('');
  const [mySessions, setMySessions] = useState<Array<{id:string;work_date:string|null;check_in:string;check_out:string|null}>>([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [targetEmployee, setTargetEmployee] = useState('');
  const [assignedTo, setAssignedTo] = useState(profile?.id || '');
  const [followTitle, setFollowTitle] = useState('');
  const [followNotes, setFollowNotes] = useState('');
  const [followDue, setFollowDue] = useState('');
  const [followPriority, setFollowPriority] = useState('normal');
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');

  const canReview = isAdmin || isSupervisor || ['junior','middle','senior','team_leader','team leader'].includes(String(profile?.role || '').toLowerCase());
  const people = useMemo(() => profiles.filter(p => p.active && p.role !== 'admin' && p.id !== profile?.id), [profiles, profile?.id]);
  const nameOf = (id: string) => { const p = profiles.find(x => x.id === id); return p?.full_name || p?.email || 'Employee'; };

  const load = useCallback(async () => {
    if (!supabase || !profile) return;
    setLoading(true);
    const fetchPaged = async (queryForRange: (from: number, to: number) => any) => {
      const rows: any[] = [];
      for (let from = 0; from < 50000; from += 1000) {
        const { data, error } = await queryForRange(from, from + 999);
        if (error) throw error;
        const page = data || [];
        rows.push(...page);
        if (page.length < 1000) break;
      }
      return rows;
    };
    try {
      const [leaveRows, correctionRows, followupRows, holidayRows] = await Promise.all([
        fetchPaged((from,to) => supabase!.from('workforce_leave_requests').select('*').order('created_at',{ascending:false}).range(from,to)),
        fetchPaged((from,to) => supabase!.from('attendance_correction_requests').select('*').order('created_at',{ascending:false}).range(from,to)),
        fetchPaged((from,to) => supabase!.from('manager_followups').select('*').order('created_at',{ascending:false}).range(from,to)),
        fetchPaged((from,to) => supabase!.from('workforce_holidays').select('*').order('holiday_date',{ascending:true}).range(from,to)),
      ]);
      setLeaves(leaveRows as Leave[]); setCorrections(correctionRows as Correction[]);
      setFollowups(followupRows as Followup[]); setHolidays(holidayRows as Holiday[]);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Some workforce records could not be loaded.');
    } finally { setLoading(false); }
  }, [profile]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!supabase || !profile?.id) return;
    let cancelled = false;
    void supabase.from('attendance').select('id,work_date,check_in,check_out').eq('employee_id',profile.id).order('check_in',{ascending:false}).limit(500)
      .then(({data,error}) => { if (cancelled) return; if (!error) setMySessions((data || []) as Array<{id:string;work_date:string|null;check_in:string;check_out:string|null}>); });
    return () => { cancelled = true; };
  }, [profile?.id]);

  async function run(task: () => PromiseLike<{ error: any }>, success: string) {
    if (!supabase) return;
    setBusy(true); setMessage('');
    try { const result = await task(); if (result.error) throw result.error; setMessage(success); await load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'The action could not be completed.'); }
    finally { setBusy(false); }
  }
  const review = async (table: 'workforce_leave_requests'|'attendance_correction_requests', id: string, status: 'approved'|'rejected') =>
    run(() => supabase!.from(table).update({status,reviewed_by:profile?.id,reviewed_at:new Date().toISOString()}).eq('id',id), status === 'approved' ? 'Request approved.' : 'Request rejected.');
  const button = (label: string, onClick: () => void, disabled = busy) => <button type="button" disabled={disabled} onClick={onClick} style={{...action,opacity:disabled ? 0.55 : 1}}>{label}</button>;

  const todayKey = new Date().toISOString().slice(0,10);
  const openFollowups = followups.filter(item => item.status !== 'resolved').length;
  const overdueFollowups = followups.filter(item => item.status !== 'resolved' && item.due_date && item.due_date < todayKey).length;
  const pendingLeave = leaves.filter(item => item.status === 'pending').length;
  const pendingCorrections = corrections.filter(item => item.status === 'pending').length;
  const todayShifts = shifts.filter(shift => {
    if (!shift.employee_id) return false;
    const timezone = attendance.find(item=>item.employee_id===shift.employee_id && item.work_timezone)?.work_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const todayForEmployee = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(shift.starts_at)) === todayForEmployee;
  });
  const missedCheckins = todayShifts.filter(shift => {
    if (new Date(shift.starts_at).getTime() > Date.now()-15*60000) return false;
    const timezone = attendance.find(item=>item.employee_id===shift.employee_id && item.work_timezone)?.work_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const shiftDate = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(shift.starts_at));
    return !attendance.some(item => {
      if (item.employee_id !== shift.employee_id) return false;
      const recordDate = item.work_date || (item.work_timezone ? new Intl.DateTimeFormat('en-CA',{timeZone:item.work_timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(item.check_in)) : item.check_in.slice(0,10));
      return recordDate === shiftDate && new Date(item.check_in).getTime() >= new Date(shift.starts_at).getTime()-6*3600000 && new Date(item.check_in).getTime() <= new Date(shift.ends_at).getTime();
    });
  }).length;
  const autoClosedToday = attendance.filter(item => {
    if (!item.auto_closed) return false;
    const timezone = item.work_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const todayForEmployee = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    return (item.work_date || item.check_in.slice(0,10)) === todayForEmployee;
  }).length;

  return <div style={{display:'grid',gap:14}}>
    <div><h1 style={{margin:'0 0 5px'}}>Workforce operations</h1><p style={muted}>Leave, attendance corrections, manager follow-ups and public holidays.</p></div>
    <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>{([['leave','Leave'],['corrections','Attendance corrections'],['followups','Manager follow-ups'],['holidays','Holidays']] as const).map(([id,label])=><button key={id} type="button" onClick={()=>setTab(id)} aria-pressed={tab===id} style={{...action,background:tab===id?'var(--crm-accent-strong)':'var(--crm-card-raised)',color:tab===id?'#fff':'var(--crm-text)',border:'1px solid var(--crm-border)'}}>{label}</button>)}</div>
    <section style={{...panel,borderColor:missedCheckins||overdueFollowups||autoClosedToday?'#b45309':'var(--crm-border)'}}>
      <strong>Attendance and follow-up alerts</strong>
      <div style={{display:'flex',gap:18,flexWrap:'wrap',marginTop:10,fontSize:13}}>
        <span>Missed check-ins today: <strong style={{color:missedCheckins?'#f87171':'var(--crm-text)'}}>{missedCheckins}</strong></span>
        <span>Auto-closed sessions today: <strong>{autoClosedToday}</strong></span>
        <span>Overdue follow-ups: <strong style={{color:overdueFollowups?'#f87171':'var(--crm-text)'}}>{overdueFollowups}</strong></span>
      </div>
      <p style={muted}>Alerts are calculated from loaded shift, attendance and follow-up records when this page opens.</p>
    </section>
    <section style={{...panel,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(135px,1fr))',gap:12}}>
      <div><div style={muted}>Pending leave</div><strong style={{fontSize:23}}>{pendingLeave}</strong></div>
      <div><div style={muted}>Pending corrections</div><strong style={{fontSize:23}}>{pendingCorrections}</strong></div>
      <div><div style={muted}>Open follow-ups</div><strong style={{fontSize:23}}>{openFollowups}</strong></div>
      <div><div style={muted}>Overdue follow-ups</div><strong style={{fontSize:23,color:overdueFollowups?'#f87171':'var(--crm-text)'}}>{overdueFollowups}</strong></div>
    </section>
    {message && <p role="status" style={{...muted,color:message.includes('could not')?'#f87171':'var(--crm-accent-strong)'}}>{message}</p>}
    {loading ? <p style={muted}>Loading workforce records…</p> : <>
    {tab==='leave' && <>
      <section style={panel}><h2 style={{marginTop:0,fontSize:16}}>Request leave</h2><form data-leave-form onSubmit={e=>{e.preventDefault();if(!profile)return;void run(()=>supabase!.from('workforce_leave_requests').insert({employee_id:profile.id,leave_type:leaveType,start_date:leaveStart,end_date:leaveEnd,reason:leaveReason||null}), 'Leave request submitted for review.');setLeaveReason('');}} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10,alignItems:'end'}}>
        <label style={muted}>Type<select value={leaveType} onChange={e=>setLeaveType(e.target.value)} style={field}>{['Annual leave','Sick leave','Unpaid leave','Other'].map(x=><option key={x}>{x}</option>)}</select></label>
        <label style={muted}>Start date<input type="date" required value={leaveStart} onChange={e=>setLeaveStart(e.target.value)} style={field}/></label>
        <label style={muted}>End date<input type="date" required min={leaveStart||undefined} value={leaveEnd} onChange={e=>setLeaveEnd(e.target.value)} style={field}/></label>
        <label style={muted}>Reason<input value={leaveReason} onChange={e=>setLeaveReason(e.target.value)} style={field} placeholder="Optional"/></label>
        <div>{button('Submit request',()=>{const form=document.querySelector<HTMLFormElement>('[data-leave-form]');form?.requestSubmit();},!leaveStart||!leaveEnd)}</div>
      </form></section>
      <section style={panel}><h2 style={{marginTop:0,fontSize:16}}>Leave requests</h2>{leaves.length?leaves.map(x=><article key={x.id} style={{padding:'11px 0',borderBottom:'1px solid var(--crm-border)',display:'flex',gap:12,justifyContent:'space-between',flexWrap:'wrap'}}><div><strong>{nameOf(x.employee_id)}</strong><div style={muted}>{x.leave_type} · {x.start_date} to {x.end_date} · {x.status}</div>{x.reason&&<p style={muted}>{x.reason}</p>}</div>{canReview&&x.status==='pending'&&<div style={{display:'flex',gap:6}}>{button('Approve',()=>void review('workforce_leave_requests',x.id,'approved'))}{button('Reject',()=>void review('workforce_leave_requests',x.id,'rejected'))}</div>}</article>):<p style={muted}>No leave requests yet.</p>}</section>
    </>}
    {tab==='corrections' && <>
      <section style={panel}><h2 style={{marginTop:0,fontSize:16}}>Request attendance correction</h2><form data-correction-form onSubmit={e=>{e.preventDefault();if(!profile)return;void run(()=>supabase!.from('attendance_correction_requests').insert({employee_id:profile.id,attendance_id:selectedSession||null,work_date:workDate,requested_check_in:checkIn?new Date(checkIn).toISOString():null,requested_check_out:checkOut?new Date(checkOut).toISOString():null,reason:correctionReason}), 'Correction request submitted.');setCheckIn('');setCheckOut('');setSelectedSession('');setCorrectionReason('');}} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
        <label style={muted}>Work date<input type="date" required value={workDate} onChange={e=>setWorkDate(e.target.value)} style={field}/></label>
        <label style={muted}>Attendance session (optional)<select value={selectedSession} onChange={e=>{const id=e.target.value;setSelectedSession(id);const session=mySessions.find(x=>x.id===id);if(session?.work_date)setWorkDate(session.work_date);}} style={field}><option value="">No existing session / missed day</option>{mySessions.map(x=><option key={x.id} value={x.id}>{x.work_date||x.check_in.slice(0,10)} · IN {new Date(x.check_in).toLocaleString()} · OUT {x.check_out?new Date(x.check_out).toLocaleTimeString():'open'}</option>)}</select></label>
        <label style={muted}>Correct check-in<input type="datetime-local" value={checkIn} onChange={e=>setCheckIn(e.target.value)} style={field}/></label>
        <label style={muted}>Correct check-out<input type="datetime-local" value={checkOut} onChange={e=>setCheckOut(e.target.value)} style={field}/></label>
        <label style={muted}>Reason<input required value={correctionReason} onChange={e=>setCorrectionReason(e.target.value)} style={field}/></label>
        <div>{button('Submit correction',()=>{document.querySelector<HTMLFormElement>('[data-correction-form]')?.requestSubmit();},!checkIn&&!checkOut||!correctionReason.trim())}</div>
      </form></section>
      <section style={panel}><h2 style={{marginTop:0,fontSize:16}}>Correction requests</h2>{corrections.length?corrections.map(x=><article key={x.id} style={{padding:'11px 0',borderBottom:'1px solid var(--crm-border)',display:'flex',gap:12,justifyContent:'space-between',flexWrap:'wrap'}}><div><strong>{nameOf(x.employee_id)}</strong><div style={muted}>{x.work_date} · IN {x.requested_check_in?new Date(x.requested_check_in).toLocaleString():'unchanged'} · OUT {x.requested_check_out?new Date(x.requested_check_out).toLocaleString():'unchanged'} · {x.status}{x.attendance_id?' · linked session':''}</div><p style={muted}>{x.reason}</p></div>{canReview&&x.status==='pending'&&<div style={{display:'flex',gap:6}}>{button('Approve',()=>void review('attendance_correction_requests',x.id,'approved'))}{button('Reject',()=>void review('attendance_correction_requests',x.id,'rejected'))}</div>}{isAdmin&&x.status==='approved'&&x.attendance_id&&!x.applied_at&&button('Apply to attendance',()=>void run(()=>supabase!.rpc('apply_attendance_correction',{request_id:x.id}),'Correction applied and original values archived.'))}{x.applied_at&&<span style={muted}>Applied {new Date(x.applied_at).toLocaleString()}</span>}</article>):<p style={muted}>No correction requests yet.</p>}</section>
    </>}
    {tab==='followups' && <>
      {canReview&&<section style={panel}><h2 style={{marginTop:0,fontSize:16}}>Create follow-up</h2><form data-followup-form onSubmit={e=>{e.preventDefault();if(!profile)return;void run(()=>supabase!.from('manager_followups').insert({employee_id:targetEmployee,assigned_to:assignedTo||profile.id,created_by:profile.id,title:followTitle,notes:followNotes||null,due_date:followDue||null,priority:followPriority}), 'Follow-up assigned.');setFollowTitle('');setFollowNotes('');}} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
        <label style={muted}>Employee<select required value={targetEmployee} onChange={e=>setTargetEmployee(e.target.value)} style={field}><option value="">Select employee</option>{people.map(p=><option key={p.id} value={p.id}>{nameOf(p.id)}</option>)}</select></label>
        <label style={muted}>Assigned manager<select value={assignedTo} onChange={e=>setAssignedTo(e.target.value)} style={field}><option value={profile?.id}>{nameOf(profile?.id||'')}</option>{profiles.filter(p=>p.active&&p.id!==profile?.id&&['supervisor','junior','middle','senior','team_leader','team leader'].includes(p.role.toLowerCase())).map(p=><option key={p.id} value={p.id}>{nameOf(p.id)}</option>)}</select></label>
        <label style={muted}>Title<input required value={followTitle} onChange={e=>setFollowTitle(e.target.value)} style={field}/></label>
        <label style={muted}>Due date<input type="date" value={followDue} onChange={e=>setFollowDue(e.target.value)} style={field}/></label>
        <label style={muted}>Priority<select value={followPriority} onChange={e=>setFollowPriority(e.target.value)} style={field}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
        <label style={muted}>Notes<input value={followNotes} onChange={e=>setFollowNotes(e.target.value)} style={field}/></label>
        <div>{button('Create follow-up',()=>document.querySelector<HTMLFormElement>('[data-followup-form]')?.requestSubmit(),!targetEmployee||!followTitle.trim())}</div>
      </form></section>}
      <section style={panel}><h2 style={{marginTop:0,fontSize:16}}>Follow-up queue</h2>{followups.length?followups.map(x=><article key={x.id} style={{padding:'11px 0',borderBottom:'1px solid var(--crm-border)',display:'flex',gap:12,justifyContent:'space-between',flexWrap:'wrap'}}><div><strong>{x.title}</strong><div style={muted}>{nameOf(x.employee_id)} · assigned to {nameOf(x.assigned_to)} · {x.priority} · due {x.due_date||'not set'} · {x.status}</div>{x.notes&&<p style={muted}>{x.notes}</p>}</div>{(x.assigned_to===profile?.id||x.created_by===profile?.id||isAdmin||isSupervisor)&&x.status!=='resolved'&&button('Mark resolved',()=>void run(()=>supabase!.from('manager_followups').update({status:'resolved'}).eq('id',x.id),'Follow-up resolved.'))}</article>):<p style={muted}>No follow-ups assigned.</p>}</section>
    </>}
    {tab==='holidays' && <>
      {(isAdmin||isSupervisor)&&<section style={panel}><h2 style={{marginTop:0,fontSize:16}}>Add public holiday</h2><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><label style={muted}>Date<input type="date" value={holidayDate} onChange={e=>setHolidayDate(e.target.value)} style={field}/></label><label style={muted}>Name<input value={holidayName} onChange={e=>setHolidayName(e.target.value)} style={field}/></label><div style={{alignSelf:'end'}}>{button('Add holiday',()=>void run(()=>supabase!.from('workforce_holidays').insert({holiday_date:holidayDate,name:holidayName,created_by:profile?.id}), 'Holiday added.'),!holidayDate||!holidayName.trim())}</div></div></section>}
      <section style={panel}><h2 style={{marginTop:0,fontSize:16}}>Public holidays</h2>{holidays.length?holidays.map(h=><div key={h.id} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid var(--crm-border)'}}><span>{h.holiday_date} · {h.name}</span>{(isAdmin||isSupervisor)&&button('Remove',()=>void run(()=>supabase!.from('workforce_holidays').delete().eq('id',h.id),'Holiday removed.'))}</div>):<p style={muted}>No public holidays configured.</p>}</section>
    </>}
    </>}
    <KnowMore>Approved leave and public holidays are excluded from scheduled absence calculations and monthly attendance targets. Overlapping pending or approved leave requests are blocked. Approved attendance corrections are applied only by an admin to a linked session; the previous check-in and check-out values are retained in the correction record for audit.</KnowMore>
  </div>;
}
