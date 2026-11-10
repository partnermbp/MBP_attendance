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


async function mfaSessionApproved(accessToken: string): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_auth_mfa_current`, {
      method: "POST",
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) return false;
    return await response.json() === true;
  } catch { return false; }
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
  if (!(await mfaSessionApproved(accessToken))) return json({ error: "Complete secure login verification first." }, 403);

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
      `attendance?employee_id=in.(${ids})&check_in=gte.${encodeURIComponent(since)}&select=id,employee_id,check_in,check_out,work_date,work_timezone&order=check_in.desc&limit=1000`
    );

    // Managers receive attendance times only. GPS coordinates and derived
    // location labels remain exclusively in the Admin attendance interface.

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

    const records = (rows || []).map((row: any) => ({
      id: row.id,
      employee_id: row.employee_id,
      check_in: row.check_in,
      check_out: row.check_out,
      work_date: row.work_date,
      work_timezone: row.work_timezone,
    }));
    return json({ records, telegram_members: telegramMembers || [], telegram_metrics: telegramMetrics || [] });
  } catch (error) {
    console.error("Manager attendance lookup failed:", error);
    return json({ error: "Could not load team attendance. Check the manager-team-attendance Edge Function logs." }, 500);
  }
});
