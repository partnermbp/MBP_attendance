import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type RequestRow = {
  id: number;
  requester_profile_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  old_telegram_user_id: number;
  new_telegram_user_id: number;
  old_telegram_username: string | null;
  new_telegram_username: string | null;
  comment: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  admin_note: string | null;
};

export default function TelegramIdRequests() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    if (!supabase) { setMessage('Database is not configured.'); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc('get_telegram_id_change_requests');
    if (error) setMessage('Could not load requests. Apply the Admin Telegram request visibility migration first. ' + error.message);
    else { setRows((data ?? []) as RequestRow[]); setMessage(''); }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function review(row: RequestRow, action: 'approve' | 'reject' | 'restrict') {
    if (!supabase) return;
    const labels = { approve: 'approve this Telegram ID change', reject: 'reject this request', restrict: 'restrict further requests from this Telegram handler' };
    if (!window.confirm('Are you sure you want to ' + labels[action] + '?')) return;
    setBusyId(row.id); setMessage('');
    const { data, error } = await supabase.rpc('review_telegram_id_change_request', {
      p_request_id: row.id, p_action: action, p_admin_note: note[row.id] || null,
    });
    if (error) setMessage(error.message);
    else if (data?.ok) { setMessage(data.message || 'Request updated.'); await load(); }
    else setMessage(data?.message || 'Unable to review this request.');
    setBusyId(null);
  }

  const cell: React.CSSProperties = { padding: 11, borderBottom: '1px solid var(--crm-border)', textAlign: 'left', verticalAlign: 'top', overflowWrap: 'anywhere' };
  const button: React.CSSProperties = { border: '1px solid var(--crm-border)', borderRadius: 6, padding: '7px 10px', cursor: 'pointer', fontWeight: 600, margin: '3px' };
  return <section style={{ marginTop: 18 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div><h1>Telegram ID change requests</h1><p style={{ color: 'var(--crm-muted, #98a2b3)' }}>Review employee requests to replace their registered Telegram identity. Only Admin can take action.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} style={button}>Refresh</button>
    </div>
    {message && <p role="status">{message}</p>}
    {loading ? <p>Loading requests…</p> : rows.length === 0 ? <p style={{ color: 'var(--crm-muted, #98a2b3)' }}>No Telegram ID change requests yet.</p> :
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
        <thead><tr>{['Request / time','Employee','Previous Telegram ID','Requested Telegram ID','Reason','Status','Admin review'].map(x=><th key={x} style={cell}>{x}</th>)}</tr></thead>
        <tbody>{rows.map(row=><tr key={row.id}>
          <td style={cell}>#{row.id}<br/>{new Date(row.created_at).toLocaleString()}</td>
          <td style={cell}>{row.requester_name || 'Unknown'}<br/><small>{row.requester_email || ''}</small></td>
          <td style={cell}>{row.old_telegram_username ? '@' + row.old_telegram_username : row.old_telegram_user_id}<br/><small>ID: {row.old_telegram_user_id}</small></td>
          <td style={cell}>{row.new_telegram_username ? '@' + row.new_telegram_username : row.new_telegram_user_id}<br/><small>ID: {row.new_telegram_user_id}</small></td>
          <td style={{...cell,minWidth:180}}>{row.comment}</td>
          <td style={cell}>{row.status}</td>
          <td style={{...cell,minWidth:260}}>
            {row.status === 'pending' ? <>
              <textarea aria-label={'Admin note for request '+row.id} placeholder="Optional admin note" value={note[row.id] || ''} onChange={e=>setNote(v=>({...v,[row.id]:e.target.value}))} style={{width:'100%',minHeight:58,boxSizing:'border-box',padding:8,borderRadius:6,border:'1px solid var(--crm-border)',background:'var(--crm-input-bg, transparent)',color:'var(--crm-text, inherit)'}}/>
              <div>
                <button type="button" disabled={busyId===row.id} onClick={()=>void review(row,'approve')} style={{...button,background:'#16794b',color:'#fff'}}>Approve</button>
                <button type="button" disabled={busyId===row.id} onClick={()=>void review(row,'reject')} style={{...button,background:'#9b3030',color:'#fff'}}>Reject</button>
                <button type="button" disabled={busyId===row.id} onClick={()=>void review(row,'restrict')} style={button}>Restrict handler</button>
              </div>
            </> : <>{row.reviewed_at ? new Date(row.reviewed_at).toLocaleString() : ''}{row.admin_note && <p>{row.admin_note}</p>}</>}
          </td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
