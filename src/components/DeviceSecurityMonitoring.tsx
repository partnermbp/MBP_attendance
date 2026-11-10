import { useCallback, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import type { SupabaseClient } from '@supabase/supabase-js';

type DeviceRow = {
  session_id: string; user_id: string; full_name: string | null; email: string | null; role: string;
  app_platform: string; app_runtime: string; app_version: string | null; os_name: string | null;
  os_version: string | null; device_model: string | null; browser_name: string | null;
  ip_address: string | null; ip_source: string | null; timezone: string | null;
  started_at: string; last_seen_at: string; ended_at: string | null;
  location_tracking_enabled: boolean; location_consent_at: string | null; location_points: number;
};
type LocationRow = { id:number; latitude:number; longitude:number; accuracy_m:number|null; altitude_m:number|null; heading_deg:number|null; speed_mps:number|null; recorded_at:string; source:string };

function deviceMetadata() {
  const ua = navigator.userAgent || '';
  const native = Capacitor.isNativePlatform();
  const capPlatform = Capacitor.getPlatform();
  const electron = /Electron\//i.test(ua);
  let appPlatform = 'web';
  let runtime = 'browser';
  if (native && capPlatform === 'android') { appPlatform = 'android'; runtime = 'capacitor'; }
  else if (native && capPlatform === 'ios') { appPlatform = 'ios'; runtime = 'capacitor'; }
  else if (electron) { appPlatform = /Macintosh|Mac OS/i.test(ua) ? 'macos' : 'windows'; runtime = 'electron'; }
  const osName = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows NT/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown';
  const osVersion = (ua.match(/Android ([\d.]+)/i)?.[1] || ua.match(/OS ([\d_]+)/i)?.[1]?.replaceAll('_','.') || ua.match(/Windows NT ([\d.]+)/i)?.[1] || ua.match(/Mac OS X ([\d_]+)/i)?.[1]?.replaceAll('_','.') || null);
  const browserName = /Edg\//i.test(ua) ? 'Edge' : /Firefox\//i.test(ua) ? 'Firefox' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : electron ? 'Electron' : 'Unknown';
  return {
    app_platform: appPlatform, app_runtime: runtime, app_version: '0.1.0',
    os_name: osName, os_version: osVersion, device_model: null, browser_name: browserName,
    user_agent: ua.slice(0, 1000), language: navigator.language || null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    screen_width: window.screen?.width || null, screen_height: window.screen?.height || null,
  };
}

export function DeviceTelemetryController({ supabase, userId, hasActiveShift }: { supabase: SupabaseClient; userId: string; hasActiveShift: boolean }) {
  const [sessionId, setSessionId] = useState<string|null>(null);
  const [tracking, setTracking] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      const { data, error } = await supabase.rpc('start_device_security_session', { p_metadata: deviceMetadata() });
      if (!alive) return;
      if (error || !data) { setNotice('Device registration is currently unavailable.'); return; }
      const id = String(data); setSessionId(id);
      heartbeat = setInterval(() => { void supabase.rpc('heartbeat_device_security_session', { p_session_id: id }); }, 60000);
    })();
    return () => {
      alive = false;
      if (heartbeat) clearInterval(heartbeat);
    };
  }, [supabase, userId]);
  useEffect(() => {
    if (!sessionId || !tracking || !hasActiveShift) return;
    let watchId: string | number | null = null;
    let cancelled = false;
    const save = async (coords: {latitude:number;longitude:number;accuracy?:number;altitude?:number|null;heading?:number|null;speed?:number|null}, source: string) => {
      if (cancelled) return;
      const { error } = await supabase.rpc('record_device_location', {
        p_session_id: sessionId, p_latitude: coords.latitude, p_longitude: coords.longitude,
        p_accuracy_m: coords.accuracy ?? null, p_altitude_m: coords.altitude ?? null,
        p_heading_deg: coords.heading ?? null, p_speed_mps: coords.speed ?? null, p_source: source,
      });
      if (error && !cancelled) setNotice('Location updates are temporarily unavailable: ' + error.message);
    };
    const fail = (error: unknown) => { if (!cancelled) setNotice('Location permission or positioning is unavailable. Attendance continues normally.'); };
    if (Capacitor.isNativePlatform()) {
      void Geolocation.watchPosition({ enableHighAccuracy:true, timeout:20000, maximumAge:15000 }, (position, error) => {
        if (error) { fail(error); return; }
        if (position) void save({latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,altitude:position.coords.altitude,heading:position.coords.heading,speed:position.coords.speed}, 'capacitor');
      }).then(id => { if (cancelled) void Geolocation.clearWatch({id}); else watchId = id; }).catch(fail);
    } else if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(position => void save({latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,altitude:position.coords.altitude,heading:position.coords.heading,speed:position.coords.speed}, 'browser'), fail, {enableHighAccuracy:true,maximumAge:15000,timeout:20000});
    } else fail(new Error('Geolocation unavailable'));
    return () => {
      cancelled = true;
      if (typeof watchId === 'string') void Geolocation.clearWatch({id:watchId});
      else if (typeof watchId === 'number') navigator.geolocation?.clearWatch(watchId);
    };
  }, [sessionId, tracking, hasActiveShift, supabase]);
  const enable = useCallback(async () => {
    if (!sessionId || !hasActiveShift) return;
    setBusy(true); setNotice('');
    try {
      if (Capacitor.isNativePlatform()) {
        const permission = await Geolocation.requestPermissions({ permissions:['location'] });
        if (permission.location !== 'granted' && permission.location !== 'granted') throw new Error('Location permission was not granted.');
      } else {
        if (!navigator.geolocation) throw new Error('This browser does not support location.');
        await new Promise<void>((resolve,reject)=>navigator.geolocation.getCurrentPosition(()=>resolve(),reject,{enableHighAccuracy:true,timeout:15000}));
      }
      const { error } = await supabase.rpc('set_device_location_consent',{p_session_id:sessionId,p_enabled:true});
      if (error) throw error;
      setTracking(true);
      setNotice('Location sharing is enabled for this active shift. You can stop it at any time.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Location permission was not granted.');
    } finally { setBusy(false); }
  }, [sessionId,hasActiveShift,supabase]);
  const disable = useCallback(async () => {
    if (!sessionId) return;
    setTracking(false);
    const { error } = await supabase.rpc('set_device_location_consent',{p_session_id:sessionId,p_enabled:false});
    setNotice(error ? 'Could not update tracking preference: '+error.message : 'Location sharing is paused.');
  },[sessionId,supabase]);
  if (!hasActiveShift || !sessionId) return notice ? <p role="status" style={{fontSize:12,opacity:.7}}>{notice}</p> : null;
  return <section aria-label="Shift location sharing" style={{margin:'12px 0',padding:12,border:'1px solid var(--crm-border,#394150)',borderRadius:10,background:'var(--crm-surface,rgba(255,255,255,.03))'}}>
    <strong style={{fontSize:13}}>Device location sharing</strong>
    <p style={{fontSize:12,opacity:.75,margin:'6px 0 10px'}}>Optional. When enabled, your location is recorded during this active shift and is visible only to Admin. You can pause it at any time.</p>
    <button type="button" disabled={busy} onClick={()=>void (tracking?disable():enable())} style={{padding:'8px 12px',borderRadius:7,border:'1px solid var(--crm-border,#596273)',background:tracking?'transparent':'var(--crm-accent,#2563eb)',color:tracking?'inherit':'white',cursor:'pointer'}}>{busy?'Requesting permission…':tracking?'Pause location sharing':'Allow location sharing'}</button>
    {notice&&<p role="status" style={{fontSize:12,marginBottom:0}}>{notice}</p>}
  </section>;
}

export default function DeviceSecurityMonitoring({supabase}:{supabase:SupabaseClient}) {
  const [rows,setRows]=useState<DeviceRow[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [points,setPoints]=useState<LocationRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [pointsLoading,setPointsLoading]=useState(false);
  const reload=useCallback(async()=>{
    setLoading(true);setError('');
    const {data,error}=await supabase.rpc('admin_device_security_overview');
    if(error)setError(error.message);else setRows((data||[]) as DeviceRow[]);
    setLoading(false);
  },[supabase]);
  useEffect(()=>{void reload();},[reload]);
  useEffect(()=>{
    if(!selected){setPoints([]);return;}
    let alive=true;setPointsLoading(true);
    void supabase.rpc('admin_device_location_points',{p_session_id:selected}).then(({data,error})=>{
      if(!alive)return;
      if(error)setError(error.message);else setPoints((data||[]) as LocationRow[]);
      setPointsLoading(false);
    });
    return()=>{alive=false;};
  },[selected,supabase]);
  const selectedRow=useMemo(()=>rows.find(r=>r.session_id===selected),[rows,selected]);
  const cell:React.CSSProperties={padding:9,borderBottom:'1px solid var(--crm-border,#394150)',textAlign:'left',verticalAlign:'top',fontSize:12};
  return <section style={{marginTop:18}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
      <div><h2 style={{marginBottom:4}}>Device & workforce monitoring</h2><p style={{fontSize:12,opacity:.7,marginTop:0}}>Admin-only device sessions, network metadata and consent-based shift location history.</p></div>
      <button type="button" onClick={()=>void reload()} style={{padding:'8px 12px',borderRadius:7}}>Refresh</button>
    </div>
    {loading&&<p>Loading device sessions…</p>}
    {error&&<p role="alert" style={{color:'#fda29b'}}>{error}</p>}
    {!loading&&!rows.length&&!error&&<p>No device sessions have been registered yet.</p>}
    {!loading&&rows.length>0&&<div style={{overflowX:'auto'}}><table style={{width:'100%',minWidth:1000,borderCollapse:'collapse'}}>
      <thead><tr>{['User','App','Version','Device / OS','IP','Last activity','Location tracking','Route'].map(x=><th key={x} style={cell}>{x}</th>)}</tr></thead>
      <tbody>{rows.map(r=><tr key={r.session_id}>
        <td style={cell}>{r.full_name||'Unknown'}<br/><span style={{opacity:.7}}>{r.email||''}</span><br/><span style={{opacity:.65}}>{r.role}</span></td>
        <td style={cell}>{r.app_platform}<br/><span style={{opacity:.7}}>{r.app_runtime}</span></td>
        <td style={cell}>{r.app_version||'—'}</td>
        <td style={cell}>{[r.device_model,r.os_name,r.os_version,r.browser_name].filter(Boolean).join(' · ')||'Limited by platform'}</td>
        <td style={cell}>{r.ip_address||'Not yet captured'}<br/><span style={{opacity:.7}}>{r.ip_source||''}</span></td>
        <td style={cell}>{new Date(r.last_seen_at).toLocaleString()}</td>
        <td style={cell}>{r.location_tracking_enabled?'Enabled':'Off'}<br/><span style={{opacity:.7}}>{r.location_points} points</span></td>
        <td style={cell}><button type="button" onClick={()=>setSelected(r.session_id)} disabled={!r.location_points} style={{padding:'6px 9px'}}>{selected===r.session_id?'Selected':'View route'}</button></td>
      </tr>)}</tbody></table></div>}
    {selectedRow&&<section style={{marginTop:16,padding:12,border:'1px solid var(--crm-border,#394150)',borderRadius:10}}>
      <h3 style={{marginTop:0}}>Shift route · {selectedRow.full_name||selectedRow.email||'User'}</h3>
      {pointsLoading&&<p>Loading location points…</p>}
      {!pointsLoading&&!points.length&&<p>No location points were recorded for this session.</p>}
      {points.length>0&&<>
        <p style={{fontSize:12,opacity:.7}}>Recorded points are timestamped and include reported GPS accuracy. Select a point to open its map position.</p>
        <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Time','Coordinates','Accuracy','Speed','Map'].map(x=><th key={x} style={cell}>{x}</th>)}</tr></thead>
        <tbody>{points.map(p=><tr key={p.id}><td style={cell}>{new Date(p.recorded_at).toLocaleString()}</td><td style={cell}>{p.latitude.toFixed(6)}, {p.longitude.toFixed(6)}</td><td style={cell}>{p.accuracy_m==null?'—':Math.round(p.accuracy_m)+' m'}</td><td style={cell}>{p.speed_mps==null?'—':(p.speed_mps*3.6).toFixed(1)+' km/h'}</td><td style={cell}><a href={'https://www.openstreetmap.org/?mlat='+p.latitude+'&mlon='+p.longitude+'#map=17/'+p.latitude+'/'+p.longitude} target="_blank" rel="noreferrer">Open map</a></td></tr>)}</tbody></table></div>
      </>}
    </section>}
  </section>;
}
