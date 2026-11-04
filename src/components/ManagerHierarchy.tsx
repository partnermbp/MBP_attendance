import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, GitBranch, Mail, MessageCircle, CalendarDays, Clock3, Activity, Users, UserRound } from 'lucide-react';

type Person = { id: string; full_name: string | null; email: string | null; role: string; active: boolean };
type Assignment = { manager_id: string; employee_id: string };
type Attendance = { id: string; employee_id?: string; check_in: string; check_out: string | null; work_date: string | null; work_timezone: string | null };
type TelegramMember = { telegram_user_id: number; profile_id: string | null; username?: string | null; display_name?: string | null; verified_at?: string | null };
type TelegramMetric = { question_user_id: number | null; first_reply_user_id: number | null; response_seconds: number | null };

const managerRoles = new Set(['junior', 'middle', 'senior', 'team_leader', 'team leader']);
const roleName = (role: string) => role.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const duration = (seconds: number | null) => {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return Math.round(seconds) + ' sec';
  if (seconds < 3600) return Math.round(seconds / 60) + ' min';
  return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
};
const panel = { padding: 16, border: '1px solid var(--crm-border)', borderRadius: 12, background: 'var(--crm-card-bg)' } as const;
const muted = { color: 'var(--crm-text-muted)', fontSize: 12 } as const;

export default function ManagerHierarchy({ profile, profiles, assignments, attendance, telegramMembers, telegramMetrics }: {
  profile: Person | null;
  profiles: Person[];
  assignments: Assignment[];
  attendance: Attendance[];
  telegramMembers: TelegramMember[];
  telegramMetrics: TelegramMetric[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(profile ? [profile.id] : []));
  const people = useMemo(() => new Map(profiles.filter(p => p.active).map(p => [p.id, p])), [profiles]);
  const children = useMemo(() => {
    const result = new Map<string, string[]>();
    assignments.forEach(a => {
      if (!people.has(a.manager_id) || !people.has(a.employee_id)) return;
      const ids = result.get(a.manager_id) || [];
      if (!ids.includes(a.employee_id)) ids.push(a.employee_id);
      result.set(a.manager_id, ids);
    });
    return result;
  }, [assignments, people]);
  const managers = useMemo(() => new Set([...people.values()].filter(p => managerRoles.has(p.role.toLowerCase().replaceAll(' ', '_')) || managerRoles.has(p.role.toLowerCase())).map(p => p.id)), [people]);
  const visibleManagers = useMemo(() => {
    if (profile?.role.toLowerCase() === 'admin') return managers;
    return new Set([...managers].filter(id => id === profile?.id || (() => {
      const seen = new Set<string>(); let frontier = [profile?.id || ''];
      while (frontier.length) {
        const parent = frontier.shift()!;
        if (seen.has(parent)) continue; seen.add(parent);
        for (const child of children.get(parent) || []) { if (child === id) return true; frontier.push(child); }
      }
      return false;
    })()));
  }, [managers, profile, children]);
  const roots = [...visibleManagers].filter(id => {
    if (id === profile?.id && profile?.role.toLowerCase() !== 'admin') return true;
    const parents = assignments.filter(a => a.employee_id === id && visibleManagers.has(a.manager_id));
    return parents.length === 0;
  }).map(id => people.get(id)!).filter(Boolean).sort((a,b)=>(a.full_name||a.email||'').localeCompare(b.full_name||b.email||''));
  const selected = selectedId ? people.get(selectedId) : null;
  const descendantsOf = (id: string) => {
    const ids = new Set<string>([id]); const queue = [id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const child of children.get(current) || []) if (!ids.has(child)) { ids.add(child); queue.push(child); }
    }
    return ids;
  };
  const renderNode = (person: Person, depth: number, path: Set<string>): ReactElement | null => {
    if (path.has(person.id)) return null;
    const nextPath = new Set(path); nextPath.add(person.id);
    const direct = (children.get(person.id) || []).filter(id => visibleManagers.has(id)).map(id => people.get(id)).filter((p): p is Person => Boolean(p)).sort((a,b)=>(a.full_name||a.email||'').localeCompare(b.full_name||b.email||''));
    const isOpen = expanded.has(person.id);
    const isSelected = selectedId === person.id;
    return <div key={person.id} style={{ marginLeft: depth ? 22 : 0, position: 'relative' }}>
      {depth > 0 && <div aria-hidden="true" style={{ position: 'absolute', left: -12, top: -12, height: 36, borderLeft: '1px solid var(--crm-border)' }}/>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '7px 0' }}>
        <button type="button" onClick={() => setSelectedId(person.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 1, minWidth: 0, padding: '12px 13px', textAlign: 'left', border: '1px solid '+(isSelected?'var(--crm-accent-strong)':'var(--crm-border)'), borderRadius: 10, background: isSelected?'var(--crm-accent-soft)':'var(--crm-card-bg)', color: 'var(--crm-text)', cursor: 'pointer' }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', flexShrink: 0, background: 'var(--crm-card-raised)', color: 'var(--crm-accent)' }}><UserRound size={18}/></span>
          <span style={{ minWidth: 0, flex: 1 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.full_name || 'Unnamed manager'}</strong><small style={muted}>{roleName(person.role)} · {direct.length} direct manager reports</small></span>
          <ChevronRight size={17}/>
        </button>
        {direct.length > 0 && <button type="button" aria-label={isOpen?'Collapse reports':'Expand reports'} onClick={() => setExpanded(prev => { const next = new Set(prev); if (next.has(person.id)) next.delete(person.id); else next.add(person.id); return next; })} style={{ width: 38, height: 38, border: '1px solid var(--crm-border)', borderRadius: 9, background: 'var(--crm-card-raised)', color: 'var(--crm-text)', cursor: 'pointer' }}>{isOpen?<ChevronDown size={17}/>:<ChevronRight size={17}/>}</button>}
      </div>
      {isOpen && direct.map(child => renderNode(child, depth + 1, nextPath))}
    </div>;
  };

  if (selected) {
    const scope = descendantsOf(selected.id);
    const ownAndTeam = attendance.filter(a => scope.has(a.employee_id || ''));
    const own = attendance.filter(a => a.employee_id === selected.id);
    const completed = own.filter(a => a.check_out);
    const workedSeconds = completed.reduce((sum,a) => sum + Math.max(0,(new Date(a.check_out!).getTime()-new Date(a.check_in).getTime())/1000-3600),0);
    const avgShift = completed.length ? workedSeconds/completed.length : null;
    const ownTelegramMembers = telegramMembers.filter(m => m.profile_id === selected.id);
    const ownTelegramIds = new Set(ownTelegramMembers.map(m => m.telegram_user_id));
    const verifiedTelegramLink = ownTelegramMembers.some(m => Boolean(m.verified_at));
    const handles = [...new Set(ownTelegramMembers.map(m => m.username).filter(Boolean))];
    const sentReplies = telegramMetrics.filter(m => m.first_reply_user_id != null && ownTelegramIds.has(m.first_reply_user_id));
    const asked = telegramMetrics.filter(m => m.question_user_id != null && ownTelegramIds.has(m.question_user_id));
    const replyAvg = sentReplies.length ? sentReplies.reduce((sum,m) => sum + (m.response_seconds || 0),0)/sentReplies.length : null;
    const today = new Date(); const since = new Date(today.getTime()-29*86400000);
    const daysActive = new Set(own.filter(a => new Date(a.check_in) >= since).map(a => a.work_date || a.check_in.slice(0,10))).size;
    const activity = Math.round(daysActive/30*100);
    const teamSize = Math.max(0,scope.size-1);
    const stat = (label: string, value: string | number, note: string, icon: ReactElement) => <article style={{...panel,minWidth:0}}><div style={{display:'flex',alignItems:'center',gap:8,...muted}}>{icon}{label}</div><strong style={{display:'block',fontSize:25,marginTop:12,color:'var(--crm-text)'}}>{value}</strong><p style={{...muted,margin:'6px 0 0'}}>{note}</p></article>;
    return <div style={{display:'grid',gap:16,marginTop:18}}>
      <button type="button" onClick={()=>setSelectedId(null)} style={{display:'inline-flex',alignItems:'center',gap:8,width:'fit-content',padding:'9px 12px',border:'1px solid var(--crm-border)',borderRadius:8,background:'var(--crm-card-raised)',color:'var(--crm-text)',cursor:'pointer'}}><ArrowLeft size={16}/> Back to manager hierarchy</button>
      <header style={{...panel,display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
        <div style={{width:54,height:54,borderRadius:14,display:'grid',placeItems:'center',background:'var(--crm-accent-soft)',color:'var(--crm-accent)'}}><UserRound size={26}/></div>
        <div style={{flex:1,minWidth:220}}><h1 style={{margin:0,fontSize:25}}>{selected.full_name || 'Unnamed manager'}</h1><div style={{...muted,marginTop:5}}>{roleName(selected.role)} · {selected.active?'Active account':'Inactive account'}</div></div>
        <div style={{display:'grid',gap:6,fontSize:13}}><span style={{display:'flex',alignItems:'center',gap:7}}><Mail size={14}/>{selected.email || 'Corporate email unavailable'}</span><span style={{display:'flex',alignItems:'center',gap:7}}><MessageCircle size={14}/>{handles.length?handles.map(h=>'@'+h).join(', '):verifiedTelegramLink?'Telegram linked':'Telegram account not linked'}</span></div>
      </header>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(175px,1fr))',gap:12}}>
        {stat('Attendance sessions',own.length,String(completed.length)+' completed · '+(own.length-completed.length)+' open',<CalendarDays size={15}/> )}
        {stat('Active attendance days',daysActive+' / 30','Days with at least one recorded check-in',<Activity size={15}/> )}
        {stat('Average completed shift',duration(avgShift),'One-hour break deducted, matching CRM attendance rules',<Clock3 size={15}/> )}
        {stat('Telegram replies',sentReplies.length,'Tracked first replies attributed to this manager',<MessageCircle size={15}/> )}
        {stat('Average reply delay',duration(replyAvg),'Across tracked group replies attributed to this account',<Clock3 size={15}/> )}
        {stat('Reporting team',teamSize,'All direct and indirect reports',<Users size={15}/> )}
      </div>
      <section style={panel}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}><strong>Overall activity · last 30 days</strong><strong style={{fontSize:22,color:activity>=70?'#22c55e':activity>=35?'#f59e0b':'#ef4444'}}>{activity}%</strong></div>
        <div style={{height:9,background:'var(--crm-border)',borderRadius:99,overflow:'hidden',marginTop:12}}><div style={{height:'100%',width:activity+'%',background:'var(--crm-accent-strong)',borderRadius:99}}/></div>
        <p style={{...muted,marginBottom:0}}>Attendance activity is based on days with recorded check-ins. Telegram activity is shown separately because message totals and private-chat activity are not fully available in the group analytics feed.</p>
      </section>
      <section style={panel}><strong>Attendance overview · manager and reporting line</strong><p style={muted}>{ownAndTeam.length} total attendance sessions across {scope.size} people. Exact GPS coordinates are not displayed on manager profiles.</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10}}><div><strong style={{fontSize:21}}>{ownAndTeam.filter(a=>a.check_out).length}</strong><div style={muted}>Completed team sessions</div></div><div><strong style={{fontSize:21}}>{ownAndTeam.filter(a=>!a.check_out).length}</strong><div style={muted}>Open team sessions</div></div><div><strong style={{fontSize:21}}>{new Set(ownAndTeam.map(a=>a.employee_id)).size}</strong><div style={muted}>People with attendance</div></div></div></section>
      <section style={panel}><strong>Telegram response performance</strong><p style={muted}>Response delay uses tracked group questions and first replies linked to this manager's Telegram identity.</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:12,marginTop:12}}><div><strong style={{fontSize:22}}>{sentReplies.length}</strong><div style={muted}>Attributed replies</div></div><div><strong style={{fontSize:22}}>{duration(replyAvg)}</strong><div style={muted}>Average first reply delay</div></div><div><strong style={{fontSize:22}}>{asked.length}</strong><div style={muted}>Tracked messages by manager</div></div></div></section>
      <section style={panel}><strong>Direct reports</strong><div style={{display:'grid',gap:8,marginTop:12}}>{(children.get(selected.id)||[]).map(id=>people.get(id)).filter((p):p is Person=>Boolean(p)).map(p=><button key={p.id} type="button" onClick={()=>setSelectedId(p.id)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:11,border:'1px solid var(--crm-border)',borderRadius:8,background:'var(--crm-card-raised)',color:'var(--crm-text)',textAlign:'left',cursor:'pointer'}}><span><strong>{p.full_name||p.email}</strong><small style={{display:'block',...muted}}>{roleName(p.role)}</small></span><ChevronRight size={16}/></button>)}{(children.get(selected.id)||[]).length===0&&<p style={muted}>No direct reports assigned.</p>}</div></section>
    </div>;
  }

  return <section style={{display:'grid',gap:14,marginTop:18}}>
    <header><h1 style={{margin:0,fontSize:25}}>Manager hierarchy</h1><p style={{...muted,marginTop:7,maxWidth:760}}>Explore the reporting structure from top to bottom. Select any manager to open their individual profile and performance statistics.</p></header>
    {roots.length ? <div style={{...panel,display:'grid',gap:5}}>{roots.map(root=>renderNode(root,0,new Set()))}</div> : <div style={{...panel,textAlign:'center',padding:30}}><GitBranch size={28} color="var(--crm-accent)"/><strong style={{display:'block',marginTop:10}}>No manager hierarchy available</strong><p style={muted}>No active manager reporting lines are visible to this account yet.</p></div>}
    <p style={muted}>GPS privacy: manager profiles show attendance and coarse activity only. Exact latitude, longitude and map pins remain restricted to Admin.</p>
  </section>;
}
