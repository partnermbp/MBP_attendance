// Returns manager-visible attendance with coarse city/country labels only.
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

async function rest(path: string, method = "GET") {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Server configuration missing");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Database request failed: ${response.status}`);
  return text ? JSON.parse(text) : null;
}

function coordinateKey(lat: number | null, lng: number | null) {
  return lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)
    ? null
    : `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

async function cityCountry(lat: number, lng: number): Promise<string> {
  const roundedLat = Number(lat.toFixed(2));
  const roundedLng = Number(lng.toFixed(2));
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(roundedLat));
  url.searchParams.set("lon", String(roundedLng));
  url.searchParams.set("zoom", "11");
  url.searchParams.set("addressdetails", "1");
  const response = await fetch(url, { headers: { "User-Agent": "AttendanceCRM/1.0 (coarse city-country labels)" } });
  if (!response.ok) return "Location unavailable";
  const data = await response.json();
  const address = data?.address || {};
  const city = address.city || address.town || address.village || address.municipality || "";
  const district = address.city_district || address.district || address.county || address.suburb || address.borough || "";
  const country = address.country || "";
  const localityParts = [city, district && district.toLowerCase() !== city.toLowerCase() ? district : ""].filter(Boolean);
  const locality = localityParts.join(", ");
  // Keep a useful coarse label even when the reverse geocoder only identifies the country.
  return [locality, country].filter(Boolean).join(", ") || "Location unavailable";
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

    const teamIds = new Set<string>();
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
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await rest(
      `attendance?employee_id=in.(${ids})&check_in=gte.${encodeURIComponent(since)}&select=id,employee_id,check_in,check_out,work_date,work_timezone,check_in_lat,check_in_lng,check_out_lat,check_out_lng&order=check_in.desc&limit=500`
    );

    const labels = new Map<string, string>();
    const keys = new Set<string>();
    for (const row of rows || []) {
      const inKey = coordinateKey(row.check_in_lat, row.check_in_lng);
      const outKey = coordinateKey(row.check_out_lat, row.check_out_lng);
      if (inKey) keys.add(inKey);
      if (outKey) keys.add(outKey);
    }

    // Public Nominatim usage is limited to one request per second. Round before
    // geocoding and cache duplicate rounded points for this response.
    for (const key of keys) {
      const [lat, lng] = key.split(",").map(Number);
      try { labels.set(key, await cityCountry(lat, lng)); }
      catch { labels.set(key, "Location unavailable"); }
      await new Promise(resolve => setTimeout(resolve, 1100));
    }

    const records = (rows || []).map((row: any) => ({
      id: row.id,
      employee_id: row.employee_id,
      check_in: row.check_in,
      check_out: row.check_out,
      work_date: row.work_date,
      work_timezone: row.work_timezone,
      check_in_city: coordinateKey(row.check_in_lat, row.check_in_lng) ? labels.get(coordinateKey(row.check_in_lat, row.check_in_lng)!) || "Location unavailable" : null,
      check_out_city: coordinateKey(row.check_out_lat, row.check_out_lng) ? labels.get(coordinateKey(row.check_out_lat, row.check_out_lng)!) || "Location unavailable" : null,
    }));
    return json({ records });
  } catch (error) {
    console.error("Manager attendance lookup failed:", error);
    return json({ error: "Could not load team attendance. Check the manager-team-attendance Edge Function logs." }, 500);
  }
});
