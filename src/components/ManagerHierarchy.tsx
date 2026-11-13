import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, GitBranch, Mail, MessageCircle, CalendarDays, Clock3, Activity, Users, UserRound } from 'lucide-react';
import KnowMore from './KnowMore';

type Person = { id: string; full_name: string | null; email: string | null; role: string; active: boolean; telegram_user_id?: number | null; telegram_username?: string | null; telegram_verified_at?: string | null };
type Assignment = { manager_id: string; employee_id: string };
type Attendance = { id: string; employee_id?: string; check_in: string; check_out: string | null; work_date: string | null; work_timezone: string | null; credited_work_minutes?: number | null; auto_closed?: boolean };
type Shift = { id: string; employee_id?: string; starts_at: string; ends_at: string };
type TelegramMember = { telegram_user_id?: number; profile_id: string | null; username?: string | null; display_name?: string | null; verified_at?: string | null };
type TelegramMetric = { question_user_id: number | null; first_reply_user_id: number | null; response_seconds: number | null };

const managerRoles = new Set(['supervisor', 'junior', 'middle', 'senior', 'team_leader', 'team leader']);
const roleRank = (role: string) => ({ telemarketing: 1, junior: 1, middle: 2, senior: 3, team_leader: 4, 'team leader': 4, supervisor: 5 } as Record<string, number>)[role.toLowerCase().replaceAll('_', ' ')] ?? 0;
const roleName = (role: string) => role.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const duration = (seconds: number | null) => {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return Math.round(seconds) + ' sec';
  if (seconds < 3600) return Math.round(seconds / 60) + ' min';
  return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
};
function renderProfileAvatar(avatarKey:string,size:number) {
  const [,kind='male',rawIndex='1'] = avatarKey.match(/^(male|female|animal|alien|superhero)-(\d+)$/) || [];
  const index = Math.max(0,Math.min(9,Number(rawIndex)-1));
  const palettes = [
    {skin:'#e8b58f',shadow:'#c98768',hair:'#27354a',shirt:'#e9a05b',bg:'#e7efff'},
    {skin:'#c98e6b',shadow:'#a96c55',hair:'#392d2b',shirt:'#7aa9bd',bg:'#fff0e4'},
    {skin:'#f0c9a7',shadow:'#d9a17f',hair:'#4b3540',shirt:'#8bb8a6',bg:'#eae7ff'},
    {skin:'#9b6248',shadow:'#754431',hair:'#202b38',shirt:'#d58c70',bg:'#e5f5ee'},
    {skin:'#d99c78',shadow:'#b9775d',hair:'#594337',shirt:'#8d91c2',bg:'#fff3d9'},
    {skin:'#edc09a',shadow:'#cf9878',hair:'#273e50',shirt:'#d4a75e',bg:'#e6f2f6'},
    {skin:'#b87555',shadow:'#8f543f',hair:'#302b35',shirt:'#80a7c9',bg:'#f3e9e4'},
    {skin:'#f0c9a8',shadow:'#d8a17e',hair:'#76513c',shirt:'#8bb7ad',bg:'#e8eff7'},
    {skin:'#a96d50',shadow:'#7e4c3c',hair:'#252b36',shirt:'#d99a78',bg:'#f1eafa'},
    {skin:'#dca27e',shadow:'#b9785e',hair:'#4b3030',shirt:'#9babc8',bg:'#e7f3ee'}
  ];
  const p = palettes[index];
  const animalColors=['#e6e2d7','#e8a05b','#d8a16d','#77b99a','#d69b8d'];
  const alienColors=['#86d5bd','#a6b6f2','#b8df79','#9bd4e7','#d3a6e8'];
  const id='profile-avatar-'+avatarKey;
  const human = kind==='male'||kind==='female';
  const heroColors = [{suit:'#1769aa',accent:'#d93642',detail:'#e8f3ff'},{suit:'#b72d3c',accent:'#f1c65b',detail:'#1d4f91'},{suit:'#a83232',accent:'#d9b45d',detail:'#f3d58a'},{suit:'#202733',accent:'#778392',detail:'#d9e1ea'},{suit:'#b92f3b',accent:'#f3c84d',detail:'#fff0d2'},{suit:'#173b69',accent:'#c94b4b',detail:'#f2d36b'},{suit:'#553a91',accent:'#8dd7e8',detail:'#e7d9ff'},{suit:'#20252d',accent:'#9c72d6',detail:'#d9d5e6'},{suit:'#315c83',accent:'#e2b66d',detail:'#e7eef8'},{suit:'#4e8c55',accent:'#a6d16d',detail:'#e7f3d4'}];
  const hero=heroColors[index];
  const hairBack = kind==='female' ? [
    <path d="M20 48 Q10 7 48 7 Q87 8 77 52 L73 78 Q65 88 62 65 L63 34 Q48 20 30 35 L32 66 Q28 87 19 76Z"/>,
    <path d="M18 49 Q12 12 43 8 Q76 3 80 39 L76 70 Q68 81 66 53 L65 31 Q43 17 27 35 L29 61 Q25 79 18 69Z"/>,
    <path d="M17 51 Q9 13 35 8 Q67 0 80 26 Q88 45 78 72 L69 79 L66 34 Q48 17 28 34 L27 76 L19 70Z"/>,
    <path d="M20 44 Q14 8 48 8 Q81 8 76 46 L72 65 L66 31 Q48 17 29 33 L28 66Z"/>,
    <path d="M18 45 Q12 13 43 7 Q73 3 79 34 L75 68 Q66 79 65 48 L64 30 Q46 19 29 34 L29 63Z"/>
  ] : [
    <path d="M23 43 Q18 12 47 9 Q76 9 74 42 L66 34 Q47 27 28 35Z"/>,
    <path d="M21 42 Q18 10 49 9 Q77 12 75 39 Q62 24 43 27 Q30 29 21 42Z"/>,
    <path d="M21 39 Q17 9 43 8 Q73 5 77 31 L72 41 Q66 23 52 24 Q35 20 24 39Z"/>,
    <path d="M20 42 Q16 11 45 8 Q73 7 77 32 L68 28 Q49 22 29 37 L26 45Z"/>,
    <path d="M20 40 Q17 9 48 8 Q77 8 75 43 L66 34 Q49 31 29 35Z"/>
  ];
  const hairstyle = index % 5;
  const hairTop = kind==='female' ? [
    <path d="M20 43 Q13 7 48 7 Q83 8 76 47 Q69 27 52 22 Q35 20 24 39Z"/>,
    <path d="M19 43 Q12 11 39 7 Q69 0 79 27 Q82 36 75 48 Q67 28 51 22 Q35 20 25 40Z"/>,
    <path d="M19 42 Q12 8 42 7 Q72 2 79 32 L73 44 Q63 20 47 22 Q30 20 23 43Z"/>,
    <path d="M19 41 Q19 9 49 8 Q79 8 77 43 L68 34 Q51 24 28 37Z"/>,
    <path d="M19 44 Q11 8 44 7 Q78 6 77 42 Q64 22 47 21 Q30 21 19 44Z"/>
  ] : [
    <path d="M20 42 Q16 9 47 8 Q77 8 76 40 Q64 28 49 26 Q32 25 20 42Z"/>,
    <path d="M19 41 Q16 8 48 8 Q76 9 77 37 Q62 23 42 26 Q28 28 19 41Z"/>,
    <path d="M18 40 Q14 8 39 7 Q70 3 79 30 Q67 22 57 25 Q39 18 18 40Z"/>,
    <path d="M18 39 Q17 8 48 7 Q78 8 77 36 L66 29 Q47 24 28 37Z"/>,
    <path d="M18 41 Q14 8 46 7 Q77 7 77 41 Q64 28 49 27 Q31 26 18 41Z"/>
  ];
  const glasses = index===2 || index===6 || index===9;
  const freckles = index===1 || index===4 || index===7;
  const mole = index===3 || index===8;
  const beard = kind==='male' && (index===1 || index===4 || index===7);
  const animalShape = index===0 ? 'cat' : index===1 ? 'fox' : index===2 ? 'bear' : index===3 ? 'rabbit' : 'dog';
  return <svg width={size} height={size} viewBox="0 0 96 96" role="img" aria-label={kind==='superhero'?'superhero':kind+' illustrated avatar'} style={{display:'block',flexShrink:0}}>
    <defs>
      <linearGradient id={id+'bg'} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={human?p.bg:'#eaf0f7'}/><stop offset="100%" stopColor="#ffffff"/></linearGradient>
      <linearGradient id={id+'skin'} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={p.skin}/><stop offset="100%" stopColor={p.shadow}/></linearGradient>
      <linearGradient id={id+'shirt'} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={human?p.shirt:'#4e83a5'}/><stop offset="100%" stopColor="#253b54"/></linearGradient>
    </defs>
    <rect x="2" y="2" width="92" height="92" rx="25" fill={'url(#'+id+'bg)'}/>
    <circle cx="76" cy="19" r="5" fill="var(--crm-accent)" opacity=".14"/><circle cx="17" cy="72" r="3" fill="var(--crm-accent)" opacity=".18"/>
    {human ? <>
      <path d="M11 96 Q15 68 48 66 Q81 68 85 96Z" fill={'url(#'+id+'shirt)'}/>
      <path d="M35 67 L48 80 L61 67 L58 61 L38 61Z" fill="#ffffff" opacity=".78"/>
      <path d="M37 57 L37 72 Q48 83 59 72 L59 57Z" fill={'url(#'+id+'skin)'}/>
      <path d="M20 43 Q18 25 28 18 Q38 10 49 11 Q65 10 73 23 Q78 34 76 48 Q75 67 61 75 Q48 82 34 74 Q21 66 20 43Z" fill={'url(#'+id+'skin)'}/>
      <path d="M20 42 Q15 35 18 44 Q18 55 24 56 L25 44Z M76 42 Q81 35 78 44 Q78 55 72 56 L71 44Z" fill={p.skin} stroke={p.shadow} strokeWidth="1"/>
      <path d="M29 39 Q36 35 43 39 M53 39 Q60 35 67 39" fill="none" stroke={p.hair} strokeWidth="2.5" strokeLinecap="round"/>
      <ellipse cx="37" cy="46" rx="3.1" ry="3.8" fill="#273447"/><ellipse cx="59" cy="46" rx="3.1" ry="3.8" fill="#273447"/>
      <circle cx="38" cy="45" r="1" fill="#fff"/><circle cx="60" cy="45" r="1" fill="#fff"/>
      <path d="M48 47 Q44 54 48 56" fill="none" stroke={p.shadow} strokeWidth="1.6" strokeLinecap="round"/>
      <path d={index%3===0 ? "M42 62 Q48 65 54 61" : index%3===1 ? "M42 61 Q48 68 55 60" : "M42 62 Q48 59 54 62"} fill="none" stroke="#874d4c" strokeWidth="2" strokeLinecap="round"/>
      {beard&&<path d="M29 56 Q31 72 48 75 Q65 72 67 56 Q61 65 55 64 Q48 69 41 64 Q34 65 29 56Z" fill={p.hair} opacity=".88"/>}
      {freckles&&<g fill={p.shadow} opacity=".8"><circle cx="31" cy="55" r="1.1"/><circle cx="35" cy="58" r="1"/><circle cx="39" cy="55" r=".9"/><circle cx="57" cy="55" r=".9"/><circle cx="61" cy="58" r="1"/><circle cx="65" cy="54" r="1.1"/><circle cx="46" cy="53" r=".8"/></g>}
      {mole&&<circle cx={index===3?64:32} cy={index===3?57:58} r="1.45" fill="#593c36"/>}
      {glasses&&<g fill="none" stroke="#29384c" strokeWidth="2.1"><rect x="27" y="40" width="19" height="14" rx="5"/><rect x="50" y="40" width="19" height="14" rx="5"/><path d="M46 46 Q48 44 50 46 M27 45 L23 43 M69 45 L73 43"/></g>}
      {kind==='female' && index===8 && <><circle cx="48" cy="10" r="8" fill={p.hair}/><path d="M43 11 Q48 3 53 11" fill="none" stroke="#8b6653" strokeWidth="2"/></>}
      {kind==='female' && index===9 && <path d="M20 28 Q8 38 15 57 M76 28 Q88 38 81 57" fill="none" stroke={p.hair} strokeWidth="6" strokeLinecap="round"/>}
      <g fill={p.hair} stroke={p.hair} strokeLinejoin="round">
        {hairBack[hairstyle]}
        {hairTop[hairstyle]}
      </g>
      {kind==='female' && index===5 && <path d="M23 37 Q11 54 23 74 M73 37 Q85 54 73 74" fill="none" stroke={p.hair} strokeWidth="6" strokeLinecap="round"/>}
      {kind==='male' && index===5 && <path d="M25 20 Q48 2 70 20" fill="none" stroke="#d8e2ee" strokeWidth="4" strokeLinecap="round"/>}
    </> : kind==='superhero' ? <>
    <path d="M8 96 Q10 59 48 58 Q86 59 88 96Z" fill={hero.suit}/>
    {index===3&&<path d="M18 64 L4 96 L29 87 L48 96 L67 87 L92 96 L78 63Z" fill="#151b24"/>}
    {index===6&&<path d="M17 68 L4 96 L27 88 L48 96 L69 88 L92 96 L79 68Z" fill="#3a2868"/>}
    {index===7&&<path d="M19 38 L17 13 L37 27 L59 27 L79 13 L77 39Z" fill="#20252d" stroke={hero.accent} strokeWidth="2"/>}
    <path d="M34 61 L34 72 L48 84 L62 72 L62 61Z" fill={hero.detail} opacity=".9"/>
    <path d="M19 41 Q18 12 48 11 Q78 12 77 41 L70 59 Q48 73 26 59Z" fill={index===2?'#d8b45b':index===7?'#20252d':hero.suit} stroke={hero.accent} strokeWidth="2"/>
    {index===0&&<><path d="M21 36 Q48 17 75 36 L72 53 Q48 70 24 53Z" fill="#c92e3b"/><path d="M25 37 L71 53 M71 37 L25 53 M48 29 L48 60 M31 30 L65 58 M65 30 L31 58" stroke="#f1d8d6" strokeWidth="1" opacity=".8"/><path d="M30 43 Q36 38 42 43 L40 48 L32 48Z M54 43 Q60 38 66 43 L64 48 L56 48Z" fill="#fff"/></>}
    {index===1&&<><path d="M23 39 Q48 20 73 39 L69 56 Q48 68 27 56Z" fill="#b72d3c"/><path d="M31 27 L48 13 L65 27 L58 31 L48 24 L38 31Z" fill={hero.accent}/><path d="M36 46 L42 44 M54 44 L60 46" stroke="#fff" strokeWidth="3" strokeLinecap="round"/></>}
    {index===2&&<><path d="M23 31 Q48 17 73 31 L70 59 L48 69 L26 59Z" fill="#d6aa4f"/><path d="M31 35 L65 35 L61 55 L48 63 L35 55Z" fill="#9b292c"/><path d="M34 40 L62 40 M34 47 L62 47 M38 54 L58 54" stroke="#f3d58a" strokeWidth="2"/></>}
    {index===3&&<><path d="M20 39 Q48 16 76 39 L70 59 Q48 69 26 59Z" fill="#202733"/><path d="M28 44 L43 43 L39 49 L29 49Z M53 43 L68 44 L67 49 L57 49Z" fill="#f3f6fa"/><path d="M48 50 L43 61 L53 61Z" fill={hero.accent}/></>}
    {index===4&&<><path d="M22 38 Q48 16 74 38 L70 58 Q48 68 26 58Z" fill="#b92f3b"/><path d="M48 17 L54 34 L48 32 L42 47 L44 31 L38 32Z" fill={hero.accent}/><path d="M32 45 L42 45 M54 45 L64 45" stroke="#fff" strokeWidth="3" strokeLinecap="round"/></>}
    {index===5&&<><path d="M23 38 Q48 18 73 38 L69 57 Q48 68 27 57Z" fill="#173b69"/><path d="M48 36 L52 45 L62 45 L54 51 L57 61 L48 55 L39 61 L42 51 L34 45 L44 45Z" fill={hero.accent}/></>}
    {index===6&&<><path d="M23 38 Q48 18 73 38 L69 57 Q48 68 27 57Z" fill="#553a91"/><circle cx="38" cy="44" r="3" fill={hero.detail}/><circle cx="58" cy="50" r="2.5" fill={hero.detail}/><path d="M48 30 L52 39 L62 40 L54 47 L56 57 L48 51 L40 57 L42 47 L34 40 L44 39Z" fill={hero.accent}/></>}
    {index===7&&<><path d="M22 39 Q48 18 74 39 L68 59 Q48 68 28 59Z" fill="#20252d"/><path d="M31 44 L43 43 L40 50 L32 50Z M53 43 L65 44 L64 50 L56 50Z" fill={hero.accent}/><path d="M48 51 L44 57 L52 57Z" fill={hero.detail}/></>}
    {index===8&&<><path d="M21 37 Q48 16 75 37 L69 59 Q48 68 27 59Z" fill="#315c83"/><path d="M48 20 L52 35 L66 39 L53 45 L48 60 L43 45 L30 39 L44 35Z" fill={hero.accent}/><path d="M34 47 L42 47 M54 47 L62 47" stroke="#fff" strokeWidth="3" strokeLinecap="round"/></>}
    {index===9&&<><path d="M20 35 Q48 15 76 35 L72 60 Q48 74 24 60Z" fill="#4e8c55"/><path d="M30 44 Q37 38 43 44 M53 44 Q59 38 66 44" stroke="#233b2a" strokeWidth="4" fill="none" strokeLinecap="round"/><path d="M40 59 Q48 64 56 59" stroke="#233b2a" strokeWidth="3" fill="none" strokeLinecap="round"/></>}
    <path d="M15 75 L31 68 L35 84 L18 90Z M81 75 L65 68 L61 84 L78 90Z" fill={hero.accent}/>
    <path d="M41 70 L48 78 L55 70" fill="none" stroke={hero.detail} strokeWidth="3"/>
    </> : kind==='animal' ? <>
      <path d={animalShape==='cat'?"M17 43 L16 17 Q18 11 26 19 L37 31 M79 43 L80 17 Q78 11 70 19 L59 31":animalShape==='fox'?"M14 43 L20 12 L40 30 M82 43 L76 12 L56 30":animalShape==='rabbit'?"M28 32 Q17 3 28 5 Q40 6 41 31 M55 31 Q58 5 70 5 Q82 7 68 34":"M17 43 Q13 18 28 22 L39 33 M79 43 Q83 18 68 22 L57 33"} fill={animalColors[index]} stroke="#705b55" strokeWidth="2" strokeLinejoin="round"/>
      <ellipse cx="48" cy="53" rx="31" ry="29" fill={animalColors[index]} stroke="#705b55" strokeWidth="1.5"/>
      <ellipse cx="37" cy="48" rx="3" ry="4" fill="#293447"/><ellipse cx="59" cy="48" rx="3" ry="4" fill="#293447"/>
      <ellipse cx="48" cy="61" rx="11" ry="8" fill="#f4d8cb"/><path d="M44 58 L48 62 L52 58Z" fill="#79535a"/><path d="M48 64 Q43 70 38 66 M48 64 Q53 70 58 66" fill="none" stroke="#79535a" strokeWidth="1.8" strokeLinecap="round"/>
      {index===0&&<path d="M21 39 Q48 18 75 39" fill="none" stroke="#f7f2e9" strokeWidth="5"/>}
      {index===1&&<path d="M23 58 Q48 72 73 58" fill="none" stroke="#fff0d5" strokeWidth="8" opacity=".85"/>}
      {index===2&&<><circle cx="25" cy="35" r="7" fill="#bd8a65"/><circle cx="71" cy="35" r="7" fill="#bd8a65"/></>}
      {index===3&&<path d="M31 30 Q48 22 65 30" fill="none" stroke="#fff4e6" strokeWidth="5"/>}
      {index===4&&<path d="M28 28 Q48 18 68 28" fill="none" stroke="#6c5148" strokeWidth="4"/>}
    </> : <>
      <path d="M15 96 Q17 69 48 67 Q79 69 81 96Z" fill={['#4e83a5','#7652a5','#67934d','#438d9a','#9b64a9'][index]}/>
      <path d="M27 40 Q22 13 48 12 Q74 13 69 40 L64 62 Q48 77 32 62Z" fill={alienColors[index]} stroke="#527f87" strokeWidth="1.4"/>
      <ellipse cx="38" cy="43" rx={index===2?8:6} ry={index===2?12:10} fill="#26344b"/><ellipse cx="58" cy="43" rx={index===2?8:6} ry={index===2?12:10} fill="#26344b"/>
      <circle cx="40" cy="40" r="2" fill="#fff"/><circle cx="60" cy="40" r="2" fill="#fff"/>
      <path d="M40 59 Q48 64 56 59" fill="none" stroke="#477c79" strokeWidth="2" strokeLinecap="round"/>
      <path d="M48 14 L48 7 M44 8 L52 8" stroke={alienColors[index]} strokeWidth="3" strokeLinecap="round"/>
      {index%2===1&&<><path d="M25 33 L13 25 M71 33 L83 25" stroke={alienColors[index]} strokeWidth="3" strokeLinecap="round"/><circle cx="13" cy="24" r="4" fill="#f3c86a"/><circle cx="83" cy="24" r="4" fill="#f3c86a"/></>}
      {index===4&&<path d="M31 23 Q48 12 65 23" fill="none" stroke="#f4c96b" strokeWidth="3" strokeLinecap="round"/>}
    </>}
    <rect x="2" y="2" width="92" height="92" rx="25" fill="none" stroke="var(--crm-accent)" strokeOpacity=".25" strokeWidth="1.5"/>
    <path d="M8 77 Q20 88 31 88" fill="none" stroke="#ffffff" strokeWidth="2" opacity=".5"/>
  </svg>;
};

const panel = { padding: 16, border: '1px solid var(--crm-border)', borderRadius: 12, background: 'var(--crm-card-bg)' } as const;
const muted = { color: 'var(--crm-text-muted)', fontSize: 12 } as const;

export default function ManagerHierarchy({ avatarByUserId = {}, profile, profiles, assignments, attendance, shifts, telegramMembers, telegramMetrics, isAdmin }: {
  avatarByUserId?: Record<string,string>;
  profile: Person | null;
  profiles: Person[];
  assignments: Assignment[];
  attendance: Attendance[];
  shifts: Shift[];
  telegramMembers: TelegramMember[];
  telegramMetrics: TelegramMetric[];
  isAdmin: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(profile ? [profile.id] : []));
  const people = useMemo(() => new Map(profiles.filter(p => p.active).map(p => [p.id, p])), [profiles]);
  const children = useMemo(() => {
    const result = new Map<string, string[]>();
    assignments.forEach(a => {
      const manager = people.get(a.manager_id);
      const employee = people.get(a.employee_id);
      if (!manager || !employee || roleRank(manager.role) <= roleRank(employee.role) || roleRank(manager.role) === 0 || roleRank(employee.role) === 0) return;
      const ids = result.get(a.manager_id) || [];
      if (!ids.includes(a.employee_id)) ids.push(a.employee_id);
      result.set(a.manager_id, ids);
    });
    return result;
  }, [assignments, people]);
  const managers = useMemo(() => new Set([...people.values()].filter(p => managerRoles.has(p.role.toLowerCase().replaceAll(' ', '_')) || managerRoles.has(p.role.toLowerCase())).map(p => p.id)), [people]);
  const visiblePeople = useMemo(() => {
    if (['admin','supervisor'].includes(profile?.role.toLowerCase() || '')) return new Set([...people.keys()]);
    const seen = new Set<string>(profile?.id ? [profile.id] : []);
    const frontier = profile?.id ? [profile.id] : [];
    while (frontier.length) {
      const parent = frontier.shift()!;
      for (const child of children.get(parent) || []) {
        if (!seen.has(child)) { seen.add(child); frontier.push(child); }
      }
    }
    return seen;
  }, [people, profile, children]);
  const visibleManagers = useMemo(() => new Set([...managers].filter(id => visiblePeople.has(id))), [managers, visiblePeople]);
  const roots = [...visibleManagers].filter(id => {
    if (id === profile?.id && profile?.role.toLowerCase() !== 'admin') return true;
    const parents = assignments.filter(a => a.employee_id === id && visibleManagers.has(a.manager_id) && (children.get(a.manager_id) || []).includes(id));
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
    const direct = (children.get(person.id) || []).filter(id => visiblePeople.has(id)).map(id => people.get(id)).filter((p): p is Person => Boolean(p)).sort((a,b)=>(a.full_name||a.email||'').localeCompare(b.full_name||b.email||''));
    const isOpen = expanded.has(person.id);
    const isSelected = selectedId === person.id;
    return <div key={person.id} style={{ marginLeft: depth ? 22 : 0, position: 'relative' }}>
      {depth > 0 && <div aria-hidden="true" style={{ position: 'absolute', left: -12, top: -12, height: 36, borderLeft: '1px solid var(--crm-border)' }}/>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '7px 0' }}>
        <button type="button" onClick={() => setSelectedId(person.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 1, minWidth: 0, padding: '12px 13px', textAlign: 'left', border: '1px solid '+(isSelected?'var(--crm-accent-strong)':'var(--crm-border)'), borderRadius: 10, background: isSelected?'var(--crm-accent-soft)':'var(--crm-card-bg)', color: 'var(--crm-text)', cursor: 'pointer' }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', flexShrink: 0, overflow:'hidden', background: 'var(--crm-card-raised)', color: 'var(--crm-accent)' }}>{avatarByUserId[person.id] ? renderProfileAvatar(avatarByUserId[person.id],36) : <UserRound size={18}/>}</span>
          <span style={{ minWidth: 0, flex: 1 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.full_name || 'Unnamed manager'}</strong><small style={muted}>{roleName(person.role)} · {direct.length} direct reports</small></span>
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
    const creditedSeconds = (a: Attendance) => {
      if (typeof a.credited_work_minutes === 'number') return a.credited_work_minutes * 60;
      const elapsed = Math.max(0, Math.floor((new Date(a.check_out || Date.now()).getTime() - new Date(a.check_in).getTime()) / 60000));
      if (a.auto_closed) return 8 * 3600;
      if (elapsed >= 540) return (480 + Math.min(120, elapsed - 540)) * 60;
      return Math.max(0, elapsed - (elapsed >= 300 ? 60 : 0)) * 60;
    };
    const workedSeconds = completed.reduce((sum,a) => sum + creditedSeconds(a),0);
    const avgShift = completed.length ? workedSeconds/completed.length : null;
    // Only registration-verified identities are authoritative. Group membership usernames are not account identity.
    const ownTelegramMembers = telegramMembers.filter(m => m.profile_id === selected.id && Boolean(m.verified_at));
    const ownTelegram = ownTelegramMembers[0] || null;
    const ownTelegramIds = new Set(ownTelegramMembers.map(m => Number(m.telegram_user_id)).filter(id => Number.isFinite(id) && id > 0));
    if (selected.telegram_user_id != null && selected.telegram_verified_at) ownTelegramIds.add(Number(selected.telegram_user_id));
    const hasVerifiedTelegram = Boolean(ownTelegram || (selected.telegram_user_id != null && selected.telegram_verified_at));
    const ownMetric = telegramMetrics.find(m => (m as any).profile_id === selected.id) as any;
    const sentReplies = telegramMetrics.filter(m => m.first_reply_user_id != null && ownTelegramIds.has(m.first_reply_user_id));
    const askedCount = ownMetric?.asked_count ?? telegramMetrics.filter(m => m.question_user_id != null && ownTelegramIds.has(m.question_user_id)).length;
    const replyCount = ownMetric?.reply_count ?? sentReplies.length;
    const replyAvg = ownMetric ? ownMetric.average_response_seconds : sentReplies.length ? sentReplies.reduce((sum,m) => sum + (m.response_seconds || 0),0)/sentReplies.length : null;
    const telegramUsername = (ownTelegram?.username || selected.telegram_username || '').replace(/^@/, '') || null;
    const telegramId = isAdmin && ownTelegramIds.size ? [...ownTelegramIds][0] : null;
    const today = new Date(); const since = new Date(today.getTime()-29*86400000);
    const daysActive = new Set(own.filter(a => new Date(a.check_in) >= since).map(a => a.work_date || a.check_in.slice(0,10))).size;
    const activity = Math.round(daysActive/30*100);
    const teamSize = Math.max(0,scope.size-1);
    const stat = (label: string, value: string | number, note: string, icon: ReactElement) => <article style={{...panel,minWidth:0}}><div style={{display:'flex',alignItems:'center',gap:8,...muted}}>{icon}{label}</div><strong style={{display:'block',fontSize:25,marginTop:12,color:'var(--crm-text)'}}>{value}</strong><p style={{...muted,margin:'6px 0 0'}}>{note}</p></article>;
    return <div style={{display:'grid',gap:16,marginTop:18}}>
      <button type="button" onClick={()=>setSelectedId(null)} style={{display:'inline-flex',alignItems:'center',gap:8,width:'fit-content',padding:'9px 12px',border:'1px solid var(--crm-border)',borderRadius:8,background:'var(--crm-card-raised)',color:'var(--crm-text)',cursor:'pointer'}}><ArrowLeft size={16}/> Back to manager hierarchy</button>
      <header style={{...panel,display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
        <div style={{width:54,height:54,borderRadius:14,display:'grid',placeItems:'center',overflow:'hidden',background:'var(--crm-accent-soft)',color:'var(--crm-accent)'}}>{avatarByUserId[selected.id] ? renderProfileAvatar(avatarByUserId[selected.id],54) : <UserRound size={26}/>}</div>
        <div style={{flex:1,minWidth:220}}><h1 style={{margin:0,fontSize:25}}>{selected.full_name || 'Unnamed manager'}</h1><div style={{...muted,marginTop:5}}>{roleName(selected.role)} · {selected.active?'Active account':'Inactive account'}</div></div>
        <div style={{display:'grid',gap:8,fontSize:13}}>
          <span style={{display:'flex',alignItems:'center',gap:7}}><Mail size={14}/>{selected.email || 'Corporate email unavailable'}</span>
          <span style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}><MessageCircle size={14}/>{hasVerifiedTelegram ? <>{isAdmin && telegramId != null && <>Telegram ID: <strong>{telegramId}</strong> · </>}{telegramUsername ? <a href={`https://t.me/${encodeURIComponent(telegramUsername)}`} target="_blank" rel="noreferrer" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 10px',borderRadius:8,background:'var(--crm-accent-strong)',color:'#fff',textDecoration:'none',fontWeight:700}}><MessageCircle size={14}/>Open manager's Telegram chat</a> : <span>{isAdmin && telegramId != null ? 'Verified Telegram ID · no public username available for a direct chat link' : 'Telegram account verified · direct chat link unavailable because no username is available'}</span>}</> : 'No verified Telegram account registered on this CRM profile'}</span>
        </div>
      </header>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(175px,1fr))',gap:12}}>
        {stat('Attendance sessions',own.length,String(completed.length)+' completed · '+(own.length-completed.length)+' open',<CalendarDays size={15}/> )}
        {stat('Active attendance days',daysActive+' / 30','Days with at least one recorded check-in',<Activity size={15}/> )}
        {stat('Average completed shift',duration(avgShift),'One-hour break deducted, matching CRM attendance rules',<Clock3 size={15}/> )}
        {stat('Telegram replies',replyCount,'Tracked first replies attributed to this manager',<MessageCircle size={15}/> )}
        {stat('Average reply delay',duration(replyAvg),'Across tracked group replies attributed to this account',<Clock3 size={15}/> )}
        {stat('Reporting team',teamSize,'All direct and indirect reports',<Users size={15}/> )}
      </div>
      <section style={panel}>
        <strong>Today's team attendance</strong>
        <p style={muted}>Live shift status for this manager and everyone in their reporting line. Exact GPS data is not included.</p>
        <div style={{display:'grid',gap:8,marginTop:12}}>
          {[...scope].map(id => {
            const person = people.get(id);
            if (!person) return null;
            const personAttendance = attendance.filter(a => a.employee_id === id);
            const timezone = personAttendance.find(a => a.work_timezone)?.work_timezone || undefined;
            const dayKey = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(value));
            const todayKey = dayKey(new Date().toISOString());
            const personShifts = shifts.filter(s => s.employee_id === id);
            const todayShift = personShifts.find(s => dayKey(s.starts_at) === todayKey);
            const todayAttendance = personAttendance.filter(a => (a.work_date || dayKey(a.check_in)) === todayKey);
            const open = todayAttendance.find(a => !a.check_out);
            const latest = todayAttendance[0];
            const now = Date.now();
            const status = open ? 'Checked in' : latest?.check_out ? 'Checked out' : todayShift && now >= new Date(todayShift.starts_at).getTime() ? 'Not checked in' : todayShift ? 'Upcoming' : 'No shift scheduled';
            const tone = status === 'Checked in' ? '#22c55e' : status === 'Not checked in' ? '#ef4444' : status === 'Checked out' ? '#60a5fa' : 'var(--crm-text-muted)';
            return <div key={id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,padding:'9px 0',borderBottom:'1px solid var(--crm-border)'}}>
              <span style={{minWidth:0}}><strong>{person.full_name || person.email || 'Team member'}</strong><small style={{display:'block',...muted}}>{roleName(person.role)}{todayShift ? ' · Shift '+new Date(todayShift.starts_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''}</small></span>
              <strong style={{fontSize:12,color:tone,whiteSpace:'nowrap'}}>{status}</strong>
            </div>;
          })}
        </div>
      </section>
      <section style={panel}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}><strong>Overall activity · last 30 days</strong><strong style={{fontSize:22,color:activity>=70?'#22c55e':activity>=35?'#f59e0b':'#ef4444'}}>{activity}%</strong></div>
        <div style={{height:9,background:'var(--crm-border)',borderRadius:99,overflow:'hidden',marginTop:12}}><div style={{height:'100%',width:activity+'%',background:'var(--crm-accent-strong)',borderRadius:99}}/></div>
        <KnowMore>Attendance activity counts recorded check-ins. Telegram metrics cover tracked group activity only, not private chats.</KnowMore>
      </section>
      <section style={panel}><strong>Attendance overview · manager and reporting line</strong><p style={muted}>{ownAndTeam.length} total attendance sessions across {scope.size} people.</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10}}><div><strong style={{fontSize:21}}>{ownAndTeam.filter(a=>a.check_out).length}</strong><div style={muted}>Completed team sessions</div></div><div><strong style={{fontSize:21}}>{ownAndTeam.filter(a=>!a.check_out).length}</strong><div style={muted}>Open team sessions</div></div><div><strong style={{fontSize:21}}>{new Set(ownAndTeam.map(a=>a.employee_id)).size}</strong><div style={muted}>People with attendance</div></div></div></section>
      <section style={panel}><strong>Telegram response performance</strong><p style={muted}>Response delay uses tracked group questions and first replies linked to this manager's Telegram identity.</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:12,marginTop:12}}><div><strong style={{fontSize:22}}>{sentReplies.length}</strong><div style={muted}>Attributed replies</div></div><div><strong style={{fontSize:22}}>{duration(replyAvg)}</strong><div style={muted}>Average first reply delay</div></div><div><strong style={{fontSize:22}}>{askedCount}</strong><div style={muted}>Tracked messages by manager</div></div></div></section>
      <section style={panel}><strong>Direct reports</strong><div style={{display:'grid',gap:8,marginTop:12}}>{(children.get(selected.id)||[]).map(id=>people.get(id)).filter((p):p is Person=>Boolean(p)).map(p=><button key={p.id} type="button" onClick={()=>setSelectedId(p.id)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:11,border:'1px solid var(--crm-border)',borderRadius:8,background:'var(--crm-card-raised)',color:'var(--crm-text)',textAlign:'left',cursor:'pointer'}}><span><strong>{p.full_name||p.email}</strong><small style={{display:'block',...muted}}>{roleName(p.role)}</small></span><ChevronRight size={16}/></button>)}{(children.get(selected.id)||[]).length===0&&<p style={muted}>No direct reports assigned.</p>}</div></section>
    </div>;
  }

  return <section style={{display:'grid',gap:14,marginTop:18}}>
    <header><h1 style={{margin:0,fontSize:25}}>Manager hierarchy</h1><KnowMore>Select a manager to view their reporting line and activity.</KnowMore></header>
    {profile && profile.role.toLowerCase() !== 'admin' && <section style={panel}>
      <strong>Today's reporting-line attendance</strong>
      <p style={muted}>Current shift status for you and everyone assigned below you. Exact GPS data is not displayed.</p>
      <div style={{display:'grid',gap:8,marginTop:12}}>
        {[...visiblePeople].map(id => {
          const person = people.get(id);
          if (!person) return null;
          const ownAttendance = attendance.filter(a => a.employee_id === id);
          const timezone = ownAttendance.find(a => a.work_timezone)?.work_timezone || undefined;
          const dayKey = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(value));
          const todayKey = dayKey(new Date().toISOString());
          const shift = shifts.find(item => item.employee_id === id && dayKey(item.starts_at) === todayKey);
          const todayRecords = ownAttendance.filter(item => (item.work_date || dayKey(item.check_in)) === todayKey);
          const open = todayRecords.find(item => !item.check_out);
          const latest = todayRecords[0];
          const status = open ? 'Checked in' : latest?.check_out ? 'Checked out' : shift && Date.now() >= new Date(shift.starts_at).getTime() ? 'Not checked in' : shift ? 'Upcoming' : 'No shift scheduled';
          const tone = status === 'Checked in' ? '#22c55e' : status === 'Not checked in' ? '#ef4444' : status === 'Checked out' ? '#60a5fa' : 'var(--crm-text-muted)';
          return <div key={id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,padding:'8px 0',borderBottom:'1px solid var(--crm-border)'}}>
            <span style={{minWidth:0}}><strong>{person.full_name || person.email || 'Team member'}</strong><small style={{display:'block',...muted}}>{roleName(person.role)}{shift ? ' · Starts '+new Date(shift.starts_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',timeZone:timezone}) : ''}</small></span>
            <strong style={{fontSize:12,color:tone,whiteSpace:'nowrap'}}>{status}</strong>
          </div>;
        })}
      </div>
    </section>}
    {roots.length ? <div style={{...panel,display:'grid',gap:5}}>{roots.map(root=>renderNode(root,0,new Set()))}</div> : <div style={{...panel,textAlign:'center',padding:30}}><GitBranch size={28} color="var(--crm-accent)"/><strong style={{display:'block',marginTop:10}}>No manager hierarchy available</strong><p style={muted}>No active manager reporting lines are visible to this account yet.</p></div>}
    {isAdmin && <KnowMore>Manager profiles show attendance and coarse activity only. Exact GPS coordinates and map pins remain restricted to Admin.</KnowMore>}
  </section>;
}
