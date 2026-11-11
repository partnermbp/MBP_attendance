// Securely request the existing GitHub Actions Telegram inbox worker. MFA is checked before sync dispatch.
// Required Supabase Edge Function secrets:
// GITHUB_TOKEN (fine-grained token with Actions: write for partnermbp/MBP_attendance)
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { error: "Authentication required." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const githubToken = Deno.env.get("GITHUB_TOKEN");
  if (!supabaseUrl || !anonKey || !serviceKey || !githubToken) {
    console.error("Telegram refresh function is missing required server configuration.");
    return json(503, { error: "Manual sync is not configured on the server yet." });
  }

  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (userError || !user) return json(401, { error: "Your session is invalid. Please sign in again." });
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json().catch(() => ({}));
    const lookupOnly = body?.action === "lookup_only";
    if (lookupOnly) {
      const token = authorization.slice("Bearer ".length);
      let sessionId = "";
      try {
        const segment = token.split(".")[1] || "";
        const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)));
        sessionId = String(payload.session_id || "");
      } catch { /* Invalid JWT session claim. */ }
      if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return json(403, { error: "Your login challenge is invalid. Sign in again." });
      const { data: challenge, error: challengeError } = await adminClient
        .from("crm_login_challenges").select("id")
        .eq("user_id", user.id).eq("session_id", sessionId).eq("stage", "telegram")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (challengeError || !challenge) return json(403, { error: "The pending Telegram login challenge has expired. Sign in again." });
    } else {
      const { data: mfaApproved, error: mfaError } = await userClient.rpc("is_auth_mfa_current");
      if (mfaError || mfaApproved !== true) return json(403, { error: "Complete secure login verification first." });
    }
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id,role,active")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Unable to verify CRM profile for Telegram refresh.");
      return json(500, { error: "Could not verify your CRM permissions." });
    }
    const role = String(profile?.role ?? "").toLowerCase();
    if (!profile || profile.active !== true || !["admin", "junior", "middle", "senior", "team leader", "team_leader"].includes(role)) {
      return json(403, { error: "Your active CRM role is not permitted to start a Telegram sync." });
    }

    const headers = {
      Authorization: "Bearer " + githubToken,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const runsResponse = await fetch(
      "https://api.github.com/repos/partnermbp/MBP_attendance/actions/workflows/telegram-inbox-poll.yml/runs?per_page=10",
      { headers },
    );
    if (!runsResponse.ok) {
      console.error("GitHub workflow status query failed with status " + runsResponse.status + ".");
      return json(502, { error: "Could not check whether a Telegram sync is already running." });
    }
    const runsData = await runsResponse.json();
    const activeRun = (runsData.workflow_runs ?? []).find((run: any) => run.status === "queued" || run.status === "in_progress");
    if (activeRun && !lookupOnly) {
      return json(200, { ok: true, running: true, message: "A Telegram sync is already queued or running." });
    }

    const dispatch = await fetch(
      "https://api.github.com/repos/partnermbp/MBP_attendance/actions/workflows/telegram-inbox-poll.yml/dispatches",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main", inputs: { mode: lookupOnly ? "lookup_only" : "full" } }),
      },
    );

    if (dispatch.status !== 204) {
      // Do not return GitHub's response body or any credential-bearing details to the browser.
      console.error(`GitHub workflow dispatch failed with status ${dispatch.status}.`);
      return json(502, { error: "GitHub could not start the Telegram worker. Check the server token permissions and workflow configuration." });
    }

    return json(200, { ok: true, running: true, message: lookupOnly ? "Telegram handler lookup requested." : "Telegram sync requested." });
  } catch (_error) {
    console.error("Unexpected error while requesting Telegram sync.");
    return json(500, { error: "Could not start Telegram sync due to a server error." });
  }
});
