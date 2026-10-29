import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "Method not allowed." });
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { error: "Authentication required." });
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), token = Deno.env.get("GITHUB_TOKEN");
  if (!url || !anon || !service || !token) return json(503, { error: "Sync status is not configured on the server." });
  try {
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: authError } = await userClient.auth.getUser();
    if (authError || !userData.user) return json(401, { error: "Your session is invalid." });
    const adminClient = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error } = await adminClient.from("profiles").select("id,role,active").eq("id", userData.user.id).maybeSingle();
    const role = String(profile?.role ?? "").toLowerCase().replaceAll("_", " ");
    if (error) return json(500, { error: "Could not verify CRM permissions." });
    if (!profile || profile.active !== true || !["admin", "junior", "middle", "senior", "team leader"].includes(role)) return json(403, { error: "Not authorized." });

    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    const base = "https://api.github.com/repos/partnermbp/MBP_attendance/actions/workflows/telegram-inbox-poll.yml/runs?per_page=10";
    const [queuedRes, activeRes] = await Promise.all([
      fetch(base + "&status=queued", { headers }),
      fetch(base + "&status=in_progress", { headers }),
    ]);
    if (!queuedRes.ok || !activeRes.ok) {
      console.error("Unable to query Telegram workflow status.");
      return json(502, { error: "Could not check the Telegram worker status." });
    }
    const queued = await queuedRes.json(), active = await activeRes.json();
    const runs = [...(queued.workflow_runs ?? []), ...(active.workflow_runs ?? [])];
    const running = runs.length > 0;
    return json(200, { running, status: running ? (runs.some((r: any) => r.status === "in_progress") ? "in_progress" : "queued") : "idle" });
  } catch {
    console.error("Unexpected Telegram status check error.");
    return json(500, { error: "Could not check Telegram worker status." });
  }
});
