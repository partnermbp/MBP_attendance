// Returns manager-visible attendance with persisted coarse region/country labels only.
// Exact GPS coordinates remain server-side and are never included in this response.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store, max-age=0" },
  });
}

async function rest(path: string, method = "GET", body?: unknown) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Server configuration missing");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...(method === "PATCH" ? { Prefer: "return=minimal" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Database request failed: ${response.status}`);
  return text ? JSON.parse(text) : null;
}

function coordinateKey(lat: number | null, lng: number | null) {
  return lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)
    ? null
    : `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

async function regionCountry(lat: number, lng: number): Promise<{ region: string | null; country: string | null }> {
  const roundedLat = Number(lat.toFixed(1));
  const roundedLng = Number(lng.toFixed(1));
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(roundedLat));
  url.searchParams.set("lon", String(roundedLng));
  url.searchParams.set("zoom", "5");
  url.searchParams.set("addressdetails", "1");

  // Retry transient rate-limit/network/server errors once. A single failed lookup
  // should not permanently turn an otherwise valid GPS point into "Location unavailable".
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": "AttendanceCRM/1.0 (coarse region-country labels)" } });
      if (!response.ok) {
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          continue;
        }
        return { region: null, country: null };
      }
      const data = await response.json();
      const address = data?.address || {};
      const region = address.state || address.province || address.region || address.state_district || null;
      const country = address.country || null;
      return { region: region ? String(region) : null, country: country ? String(country) : null };
    } catch {
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        continue;
      }
      return { region: null, country: null };
    }
  }
  return { region: null, country: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "Attendance service is not configured" }, 503);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in required" }, 401);
  const accessToken = auth.slice(7);
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!userResponse.ok) return json({ error: "Session is invalid or expired" }, 401);
  const user = await userResponse.json();

  try {
    const profiles = await rest(`profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,active&limit=1`);
    const profile = profiles?.[0];
    const role = String(profile?.role || "").toLowerCase().replaceAll("_", " ");
    if (!profile?.active || !["junior", "middle", "senior", "team leader"].includes(role)) {
      return json({ error: "Active manager account required" }, 403);
    }

    const teamIds = new Set<string>([String(user.id)]);
    let frontier = [String(user.id)];
    for (let depth = 0; depth < 12 && frontier.length; depth++) {
      const managerFilter = frontier.map(id => encodeURIComponent(id)).join(",");
      const assignments = await rest(`manager_employee_assignments?manager_id=in.(${managerFilter})&select=manager_id,employee_id&limit=2000`);
      const next: string[] = [];
      for (const assignment of assignments || []) {
        const employeeId = String(assignment.employee_id);
        if (employeeId !== String(user.id) && !teamIds.has(employeeId)) {
          teamIds.add(employeeId);
          next.push(employeeId);
        }
      }
      frontier = next;
    }

    if (!teamIds.size) return json({ records: [] });
    const ids = [...teamIds].map(encodeURIComponent).join(",");
    const since = new Date(Date.now() - 93 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await rest(
      `attendance?employee_id=in.(${ids})&check_in=gte.${encodeURIComponent(since)}&select=id,employee_id,check_in,check_out,work_date,work_timezone,check_in_lat,check_in_lng,check_out_lat,check_out_lng,check_in_region,check_in_country,check_out_region,check_out_country&order=check_in.desc&limit=1000`
    );

    // Use persisted coarse labels first. Only retry unresolved locations, and never
    // include coordinates in the response sent to a manager.
    const labels = new Map<string, { region: string | null; country: string | null }>();
    const pending = new Map<string, { rowId: string; event: "check_in" | "check_out"; lat: number; lng: number }>();
    for (const row of rows || []) {
      if (row.check_in_region || row.check_in_country) {
        const key = coordinateKey(row.check_in_lat, row.check_in_lng);
        if (key) labels.set("in:" + row.id, { region: row.check_in_region || null, country: row.check_in_country || null });
      } else if (row.check_in_lat != null && row.check_in_lng != null) {
        const key = coordinateKey(row.check_in_lat, row.check_in_lng);
        if (key && !pending.has("in:" + row.id)) pending.set("in:" + row.id, { rowId: row.id, event: "check_in", lat: row.check_in_lat, lng: row.check_in_lng });
      }
      if (row.check_out_region || row.check_out_country) {
        const key = coordinateKey(row.check_out_lat, row.check_out_lng);
        if (key) labels.set("out:" + row.id, { region: row.check_out_region || null, country: row.check_out_country || null });
      } else if (row.check_out_lat != null && row.check_out_lng != null) {
        const key = coordinateKey(row.check_out_lat, row.check_out_lng);
        if (key && !pending.has("out:" + row.id)) pending.set("out:" + row.id, { rowId: row.id, event: "check_out", lat: row.check_out_lat, lng: row.check_out_lng });
      }
    }

    // Bound each request to avoid long waits and respect Nominatim's public rate limit.
    let lookupCount = 0;
    for (const item of pending.values()) {
      if (lookupCount >= 8) break;
      const result = await regionCountry(item.lat, item.lng);
      labels.set((item.event === "check_in" ? "in:" : "out:") + item.rowId, result);
      if (result.region || result.country) {
        const patch = item.event === "check_in"
          ? { check_in_region: result.region, check_in_country: result.country }
          : { check_out_region: result.region, check_out_country: result.country };
        await rest(`attendance?id=eq.${encodeURIComponent(item.rowId)}`, "PATCH", patch);
      }
      lookupCount++;
      if (lookupCount < 8) await new Promise(resolve => setTimeout(resolve, 1100));
    }

    // Profile-verified IDs are used server-side only. Admin-only ID exposure is not part of this API. Return usernames only when
    // the group membership row matches both the profile and verified Telegram ID.
    const linkedProfiles = await rest(
      `profiles?id=in.(${ids})&select=id,telegram_user_id,telegram_verified_at&limit=5000`
    ) || [];
    const verifiedLinks = linkedProfiles
      .filter((linked: any) => linked.telegram_user_id != null && linked.telegram_verified_at != null)
      .map((linked: any) => ({
        profile_id: String(linked.id),
        telegram_user_id: Number(linked.telegram_user_id),
        verified_at: linked.telegram_verified_at,
      }));
    const groupMembers = verifiedLinks.length
      ? await rest(`telegram_group_members?profile_id=in.(${verifiedLinks.map((link: any) => encodeURIComponent(link.profile_id)).join(",")})&select=profile_id,telegram_user_id,username,display_name&limit=5000`) || []
      : [];
    const telegramMembers = verifiedLinks.map((link: any) => {
      const matched = groupMembers.find((member: any) =>
        String(member.profile_id) === link.profile_id &&
        Number(member.telegram_user_id) === link.telegram_user_id
      );
      return {
        profile_id: link.profile_id,
        verified_at: link.verified_at,
        username: matched?.username || null,
        display_name: matched?.display_name || null,
      };
    });
    const telegramIds = [...new Set(verifiedLinks
      .map((member: any) => Number(member.telegram_user_id))
      .filter((id: number) => Number.isFinite(id) && id > 0))];
    let rawTelegramMetrics: any[] = [];
    if (telegramIds.length) {
      const telegramIdFilter = telegramIds.join(",");
      rawTelegramMetrics = await rest(
        `telegram_response_metrics?or=(question_user_id.in.(${telegramIdFilter}),first_reply_user_id.in.(${telegramIdFilter}))&select=question_user_id,first_reply_user_id,response_seconds&order=calculated_at.desc&limit=10000`
      ) || [];
    }
    const telegramMetrics = verifiedLinks.map((link: any) => {
      const replies = rawTelegramMetrics.filter((metric: any) => Number(metric.first_reply_user_id) === link.telegram_user_id && metric.response_seconds != null);
      const asked = rawTelegramMetrics.filter((metric: any) => Number(metric.question_user_id) === link.telegram_user_id);
      return {
        profile_id: link.profile_id,
        reply_count: replies.length,
        asked_count: asked.length,
        average_response_seconds: replies.length
          ? replies.reduce((sum: number, metric: any) => sum + Number(metric.response_seconds || 0), 0) / replies.length
          : null,
      };
    });

    const records = (rows || []).map((row: any) => {
      const inLabel = labels.get("in:" + row.id) || { region: row.check_in_region || null, country: row.check_in_country || null };
      const outLabel = labels.get("out:" + row.id) || { region: row.check_out_region || null, country: row.check_out_country || null };
      return {
        id: row.id,
        employee_id: row.employee_id,
        check_in: row.check_in,
        check_out: row.check_out,
        work_date: row.work_date,
        work_timezone: row.work_timezone,
        check_in_region: inLabel.region,
        check_in_country: inLabel.country,
        check_out_region: outLabel.region,
        check_out_country: outLabel.country,
        check_in_gps_recorded: row.check_in_lat != null && row.check_in_lng != null,
        check_out_gps_recorded: row.check_out_lat != null && row.check_out_lng != null,
      };
    });
    return json({ records, telegram_members: telegramMembers || [], telegram_metrics: telegramMetrics || [] });
  } catch (error) {
    console.error("Manager attendance lookup failed:", error);
    return json({ error: "Could not load team attendance. Check the manager-team-attendance Edge Function logs." }, 500);
  }
});
