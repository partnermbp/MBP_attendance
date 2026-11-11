import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Device } from '@capacitor/device';
import type { SupabaseClient } from '@supabase/supabase-js';

type RiskAlert = {alert_key:string;severity:string;category:string;title:string;description:string;evidence:Record<string,unknown>;first_seen:string;last_seen:string;affected_accounts:number};
type SecurityReview = {alert_key:string;status:string;review_note:string;reviewed_by:string;updated_at:string};
function appInstanceId() {
  const key = 'mbp_crm_app_instance_id';
  try {
    let value = window.localStorage.getItem(key);
    if (!value) { value = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'mbp-' + Math.random().toString(36).slice(2) + Date.now().toString(36); window.localStorage.setItem(key,value); }
    return value;
  } catch { return null; }
}


type DesktopDeviceBridge = { getInfo: () => Promise<{platform:string;osVersion:string;architecture:string;appVersion:string}>; };
declare global { interface Window { mbpDesktopDevice?: DesktopDeviceBridge; } }

async function deviceMetadata() {
  const ua = navigator.userAgent || '';
  const native = Capacitor.isNativePlatform();
  const capPlatform = Capacitor.getPlatform();
  const electron = Boolean(window.mbpDesktopDevice) || /Electron\//i.test(ua);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || Boolean((navigator as Navigator & {standalone?:boolean}).standalone);
  let nativeInfo: Awaited<ReturnType<typeof Device.getInfo>> | null = null;
  if (native) { try { nativeInfo = await Device.getInfo(); } catch { nativeInfo = null; } }
  const desktop = window.mbpDesktopDevice ? await window.mbpDesktopDevice.getInfo().catch(() => null) : null;
  let appPlatform = 'web';
  let runtime = 'browser';
  if (native && capPlatform === 'android') { appPlatform = 'android'; runtime = 'capacitor'; }
  else if (native && capPlatform === 'ios') { appPlatform = 'ios'; runtime = 'capacitor'; }
  else if (electron) {
    appPlatform = desktop?.platform === 'darwin' || /Macintosh|Mac OS/i.test(ua) ? 'macos' : 'windows';
    runtime = 'electron';
  }
  const osName = nativeInfo?.operatingSystem === 'android' ? 'Android'
    : nativeInfo?.operatingSystem === 'ios' ? 'iOS'
    : desktop?.platform === 'win32' ? 'Windows'
    : desktop?.platform === 'darwin' ? 'macOS'
    : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Windows NT/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
    : /Linux/i.test(ua) ? 'Linux' : 'Unknown';
  if (!native && !electron && standalone && osName === 'Android') appPlatform = 'android';
  if (!native && !electron && standalone && osName === 'iOS') appPlatform = 'ios';
  const osVersion = nativeInfo?.osVersion || desktop?.osVersion
    || ua.match(/Android ([\d.]+)/i)?.[1]
    || ua.match(/OS ([\d_]+)/i)?.[1]?.replaceAll('_','.')
    || ua.match(/Windows NT ([\d.]+)/i)?.[1]
    || ua.match(/Mac OS X ([\d_]+)/i)?.[1]?.replaceAll('_','.') || null;
  const browserName = electron ? 'Electron' : /Edg\//i.test(ua) ? 'Edge' : /Firefox\//i.test(ua) ? 'Firefox'
    : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : 'Unknown';
  return {
    app_platform: appPlatform, app_runtime: runtime, app_version: desktop?.appVersion || '0.1.1',
    os_name: osName, os_version: osVersion,
    device_model: nativeInfo?.model || (desktop ? desktop.architecture + ' desktop' : null),
    browser_name: browserName, user_agent: ua.slice(0, 1000),
    app_instance_id: appInstanceId(), language: navigator.language || null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    screen_width: window.screen?.width || null, screen_height: window.screen?.height || null,
  };
}

export function DeviceTelemetryController({ supabase, userId, hasActiveShift, showDeviceSecurityInfo = true }: { supabase: SupabaseClient; userId: string; hasActiveShift: boolean; showDeviceSecurityInfo?: boolean }) {
  const [sessionId, setSessionId] = useState<string|null>(null);
  const [tracking, setTracking] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let activeId: string | null = null;
    void (async () => {
      const { data, error } = await supabase.rpc('start_device_security_session', { p_metadata: await deviceMetadata() });
      if (!alive) {
        if (data) void supabase.rpc('end_device_security_session', { p_session_id: String(data) });
        return;
      }
      if (error || !data) { setNotice('Device registration is currently unavailable.'); return; }
      const id = String(data); activeId = id; setSessionId(id);
      void supabase.functions.invoke('auth-mfa-login', { body: { action: 'device_registered', session_id: id } })
        .then(({ error: notificationError }) => {
          if (notificationError) console.warn('Device security notification could not be delivered:', notificationError.message);
        });
      heartbeat = setInterval(() => {
        void supabase.rpc('heartbeat_device_security_session', { p_session_id: id }).then(({ data: ipChanged, error: heartbeatError }) => {
          if (heartbeatError) return;
          if (ipChanged === true) {
            void supabase.functions.invoke('auth-mfa-login', { body: { action: 'device_ip_changed', session_id: id } })
              .then(({ error: notificationError }) => {
                if (notificationError) console.warn('Network-change notice could not be delivered:', notificationError.message);
              });
          }
        });
      }, 60000);
    })();
    return () => {
      alive = false;
      if (heartbeat) clearInterval(heartbeat);
      if (activeId) void supabase.rpc('end_device_security_session', { p_session_id: activeId });
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
    const fail = () => {
      if (cancelled) return;
      setTracking(false);
      void supabase.rpc('set_device_location_consent',{p_session_id:sessionId,p_enabled:false});
      setNotice('Location permission or positioning is unavailable. Tracking was paused; attendance continues normally.');
    };
    if (Capacitor.isNativePlatform()) {
      void Geolocation.watchPosition({ enableHighAccuracy:true, timeout:20000, maximumAge:15000 }, (position, error) => {
        if (error) { fail(); return; }
        if (position) void save({latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,altitude:position.coords.altitude,heading:position.coords.heading,speed:position.coords.speed}, 'capacitor');
      }).then(id => { if (cancelled) void Geolocation.clearWatch({id}); else watchId = id; }).catch(() => fail());
    } else if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(position => void save({latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,altitude:position.coords.altitude,heading:position.coords.heading,speed:position.coords.speed}, 'browser'), () => fail(), {enableHighAccuracy:true,maximumAge:15000,timeout:20000});
    } else fail();
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
        const permission = await Geolocation.requestPermissions();
        if (permission.location !== 'granted') throw new Error('Location permission was not granted.');
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
  useEffect(() => {
    if (hasActiveShift || !sessionId || !tracking) return;
    setTracking(false);
    void supabase.rpc('set_device_location_consent',{p_session_id:sessionId,p_enabled:false});
    setNotice('Location sharing stopped because the attendance shift ended.');
  }, [hasActiveShift,sessionId,tracking,supabase]);
  const disable = useCallback(async () => {
    if (!sessionId) return;
    setTracking(false);
    const { error } = await supabase.rpc('set_device_location_consent',{p_session_id:sessionId,p_enabled:false});
    setNotice(error ? 'Could not update tracking preference: '+error.message : 'Location sharing is paused.');
  },[sessionId,supabase]);
  return <section aria-label="Device security and shift location" style={{margin:'12px 0',padding:12,border:'1px solid var(--crm-border,#394150)',borderRadius:10,background:'var(--crm-surface,rgba(255,255,255,.03))'}}>
    {showDeviceSecurityInfo&&<><strong style={{fontSize:13}}>Device & security information</strong>
    <p style={{fontSize:12,opacity:.75,margin:'6px 0 10px'}}>This app records its platform, version, operating system/browser, timezone and server-observed network IP for account security. Detailed device and location records are visible only to Admin.</p></>}
    {hasActiveShift&&sessionId&&<>
      <strong style={{fontSize:13}}>Optional shift location sharing</strong>
      <p style={{fontSize:12,opacity:.75,margin:'6px 0 10px'}}>When enabled, your location is recorded during this active shift and is visible only to Admin. You can pause it at any time. Location sharing stops automatically at checkout.</p>
      <button type="button" disabled={busy} onClick={()=>void (tracking?disable():enable())} style={{padding:'8px 12px',borderRadius:7,border:'1px solid var(--crm-border,#596273)',background:tracking?'transparent':'var(--crm-accent,#2563eb)',color:tracking?'inherit':'white',cursor:'pointer'}}>{busy?'Requesting permission…':tracking?'Pause location sharing':'Allow location sharing'}</button>
    </>}
    {notice&&<p role="status" style={{fontSize:12,marginBottom:0}}>{notice}</p>}
  </section>;
}

export default function DeviceSecurityMonitoring({supabase}:{supabase:SupabaseClient}) {
  const [riskAlerts,setRiskAlerts]=useState<RiskAlert[]>([]);
  const [locationAlerts,setLocationAlerts]=useState<RiskAlert[]>([]);
  const [concurrentAlerts,setConcurrentAlerts]=useState<RiskAlert[]>([]);
  const [authFailureAlerts,setAuthFailureAlerts]=useState<RiskAlert[]>([]);
  const [reviews,setReviews]=useState<SecurityReview[]>([]);
  const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({});
  const [reviewStatuses,setReviewStatuses]=useState<Record<string,string>>({});
  const [reviewBusy,setReviewBusy]=useState<string|null>(null);
  const [alertsLoading,setAlertsLoading]=useState(true);
  const [error,setError]=useState('');
  const reload=useCallback(async()=>{
    setLoading(true);setError('');
    const [{data:alerts,error:alertsError},{data:locations,error:locationError},{data:concurrent,error:concurrentError},{data:authFailures,error:authFailureError},{data:reviewRows,error:reviewError}]=await Promise.all([
      supabase.rpc('admin_security_risk_alerts'),
      supabase.rpc('admin_location_risk_alerts'),
      supabase.rpc('admin_concurrent_session_alerts'),
      supabase.rpc('admin_auth_failure_alerts'),
      supabase.from('security_alert_reviews').select('alert_key,status,review_note,reviewed_by,updated_at'),
    ]);
    if(alertsError)setError(prev=>prev ? prev+' · '+alertsError.message : alertsError.message);else setRiskAlerts((alerts||[]) as RiskAlert[]);
    if(locationError)setError(prev=>prev ? prev+' · '+locationError.message : locationError.message);else setLocationAlerts((locations||[]) as RiskAlert[]);
    if(concurrentError)setError(prev=>prev ? prev+' · '+concurrentError.message : concurrentError.message);else setConcurrentAlerts((concurrent||[]) as RiskAlert[]);
    if(authFailureError)setError(prev=>prev ? prev+' · '+authFailureError.message : authFailureError.message);else setAuthFailureAlerts((authFailures||[]) as RiskAlert[]);
    if(reviewError)setError(prev=>prev ? prev+' · '+reviewError.message : reviewError.message);else setReviews((reviewRows||[]) as SecurityReview[]);
    setAlertsLoading(false);
  },[supabase]);
  useEffect(()=>{void reload();},[reload]);
  useEffect(()=>{const timer=window.setInterval(()=>{void reload();},60000);return()=>window.clearInterval(timer);},[reload]);
  const allRiskAlerts=[...riskAlerts,...locationAlerts,...concurrentAlerts,...authFailureAlerts];
  const saveReview=async(alert:RiskAlert)=>{
    const status=reviewStatuses[alert.alert_key]||reviews.find(r=>r.alert_key===alert.alert_key)?.status||'in_review';
    setReviewBusy(alert.alert_key);
    const {error}=await supabase.rpc('admin_review_security_alert',{p_alert_key:alert.alert_key,p_status:status,p_review_note:reviewNotes[alert.alert_key]??reviews.find(r=>r.alert_key===alert.alert_key)?.review_note??''});
    if(error)setError('Could not save alert review: '+error.message);
    else await reload();
    setReviewBusy(null);
  };
  const cell:CSSProperties={padding:9,borderBottom:'1px solid var(--crm-border,#394150)',textAlign:'left',verticalAlign:'top',fontSize:12};
  return <section style={{marginTop:18}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
      <div><h2 style={{marginBottom:4}}>Security risk alerts</h2><p style={{fontSize:12,opacity:.7,marginTop:0}}>Only suspicious account, device, network, location and authentication patterns are shown here.</p></div>
      <button type="button" onClick={()=>void reload()} style={{padding:'8px 12px',borderRadius:7}}>Refresh</button>
    </div>
    <section style={{margin:'14px 0',padding:12,border:'1px solid var(--crm-border,#394150)',borderRadius:10}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div><h3 style={{margin:'0 0 4px'}}>Fraud & account-sharing alerts</h3><p style={{fontSize:12,opacity:.7,margin:0}}>Only threshold-level or cross-account risk signals from the last 30 days. Routine logins, heartbeats and normal device registrations are excluded. Alerts require manual review; no account is automatically restricted.</p></div>
        <span style={{fontSize:12,opacity:.75}}>{allRiskAlerts.length} active signals</span>
      </div>
      {alertsLoading&&<p>Checking risk signals…</p>}
      {!alertsLoading&&!allRiskAlerts.length&&<p style={{fontSize:12,opacity:.7}}>No matching device/IP/location patterns detected in the current 30-day window.</p>}
      {allRiskAlerts.map(alert=><article key={alert.alert_key} style={{marginTop:10,padding:10,borderRadius:8,border:'1px solid var(--crm-border,#394150)',background:'var(--crm-surface,rgba(255,255,255,.025))'}}>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <strong>{alert.title}</strong>
          <span style={{fontSize:11,fontWeight:700,textTransform:'uppercase',padding:'3px 7px',borderRadius:5,background:alert.severity==='high'?'rgba(220,38,38,.16)':alert.severity==='medium'?'rgba(217,119,6,.16)':'rgba(100,116,139,.16)',color:alert.severity==='high'?'#f87171':alert.severity==='medium'?'#fbbf24':'#94a3b8'}}>{alert.severity} severity</span>
          <span style={{fontSize:11,opacity:.7}}>{alert.affected_accounts} account(s)</span>
        </div>
        <p style={{fontSize:12,margin:'6px 0'}}>{alert.description}</p>
        <div style={{fontSize:11,opacity:.75,overflowWrap:'anywhere'}}>First seen: {new Date(alert.first_seen).toLocaleString()} · Last seen: {new Date(alert.last_seen).toLocaleString()}</div>
        <details style={{fontSize:12,marginTop:7}}><summary style={{cursor:'pointer'}}>Review evidence</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:11}}>{JSON.stringify(alert.evidence,null,2)}</pre></details>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:9}}>
          <select aria-label="Alert review status" value={reviewStatuses[alert.alert_key]||reviews.find(r=>r.alert_key===alert.alert_key)?.status||'in_review'} onChange={e=>setReviewStatuses(prev=>({...prev,[alert.alert_key]:e.target.value}))} style={{padding:7,borderRadius:6}}>
            <option value="in_review">In review</option><option value="false_positive">False positive</option><option value="confirmed">Confirmed</option><option value="resolved">Resolved</option>
          </select>
          <input aria-label="Administrator review note" placeholder="Admin review note (optional)" value={reviewNotes[alert.alert_key]??reviews.find(r=>r.alert_key===alert.alert_key)?.review_note??''} onChange={e=>setReviewNotes(prev=>({...prev,[alert.alert_key]:e.target.value}))} style={{flex:'1 1 220px',minWidth:160,padding:7,borderRadius:6}} />
          <button type="button" disabled={reviewBusy===alert.alert_key} onClick={()=>void saveReview(alert)} style={{padding:'7px 10px',borderRadius:6}}>{reviewBusy===alert.alert_key?'Saving…':'Save review'}</button>
        </div>
        {reviews.find(r=>r.alert_key===alert.alert_key)&&<p style={{fontSize:11,opacity:.65,marginBottom:0}}>Last reviewed: {new Date(reviews.find(r=>r.alert_key===alert.alert_key)!.updated_at).toLocaleString()}</p>}
      </article>)}
    </section>

  </section>;
}
