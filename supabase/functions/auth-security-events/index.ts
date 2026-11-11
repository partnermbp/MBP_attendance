import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}
async function sha(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  try {
    const body = await req.json();
    if (body?.action !== "failed_password") return reply({ error: "Unknown action." }, 400);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ ok: true });
    const headers = req.headers;
    const forwarded = (headers.get("x-forwarded-for") || headers.get("x-real-ip") || "").split(",")[0].trim();
    const ip = /^[0-9a-fA-F:.]+$/.test(forwarded) ? forwarded : "";
    const emailHash = await sha(email);
    const bucketHash = await sha(emailHash + ":" + (ip || "unknown-network"));
    const { data, error } = await db.rpc("record_crm_failed_password", {
      p_bucket_hash: bucketHash,
      p_email_hash: emailHash,
      p_ip_address: ip || null,
    });
    if (error) {
      console.error("Failed-password audit write failed:", error.message);
      return reply({ ok: false }, 503);
    }
    // The client-reported event is a security signal, not proof of a valid
    // authentication attempt. No Telegram message is sent from this public endpoint.
    return reply({ ok: true, recorded: true, threshold_reached: Boolean(data?.[0]?.should_notify) });
  } catch {
    return reply({ ok: false }, 400);
  }
});