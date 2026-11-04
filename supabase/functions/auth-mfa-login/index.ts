import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// The service-role client keeps all challenge and session-approval records server-side.
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function randomOtp() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(value).padStart(6, "0");
}
async function sha(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function sessionIdFromJwt(token: string): string | null {
  try {
    const part = token.split(".")[1];
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch { return null; }
}
async function caller(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user?.id || !data.user.email) return null;
  const sessionId = sessionIdFromJwt(token);
  if (!sessionId) return null;
  return { user: data.user, token, sessionId };
}
async function sendTelegram(chatId: number, code: string) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "Your Attendance CRM login verification code is:\n\n" + code +
        "\n\nIt expires in 10 minutes and can only be used for this login. Never share it with anyone.",
    }),
  });
  if (!response.ok) throw new Error("Telegram code delivery failed");
}
async function currentWeek(userId: string) {
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error || !data.user?.created_at) throw new Error("Unable to verify account registration date");
  const created = new Date(data.user.created_at).getTime();
  return Math.max(0, Math.floor((Date.now() - created) / 604800000));
}
async function issueTelegramCode(challengeId: string, telegramUserId: number) {
  const code = randomOtp();
  const { error } = await db.from("crm_login_challenges").update({
    stage: "telegram",
    telegram_otp_hash: await sha(code),
    telegram_otp_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  }).eq("id", challengeId);
  if (error) throw new Error("Unable to create Telegram challenge");
  await sendTelegram(telegramUserId, code);
}
async function completeSession(userId: string, sessionId: string, weekIndex: number) {
  const { error } = await db.from("crm_login_sessions").upsert({
    session_id: sessionId,
    user_id: userId,
    verified_week: weekIndex,
    verified_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "session_id" });
  if (error) throw new Error("Unable to approve login session");
}
async function begin(req: Request, body: any) {
  const auth = await caller(req);
  if (!auth) return reply({ error: "Your password session is invalid. Sign in again." }, 401);
  const email = auth.user.email!.trim().toLowerCase();
  const recentCutoff = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: recentChallenges, error: rateError } = await db.from("crm_login_challenges")
    .select("id").eq("user_id", auth.user.id).gte("created_at", recentCutoff).limit(1);
  if (rateError) return reply({ error: "Unable to start secure login verification." }, 500);
  if (recentChallenges?.length) return reply({ error: "A login verification was started recently. Wait one minute before requesting another code." }, 429);
  const { data: profile, error } = await db.from("profiles")
    .select("active, role, telegram_user_id, telegram_verified_at")
    .eq("id", auth.user.id).maybeSingle();
  if (error || !profile || profile.active !== true) return reply({ error: "This CRM account is inactive or unavailable." }, 403);
  const admin = String(profile.role || "").toLowerCase() === "admin";
  if (!admin && (!profile.telegram_user_id || !profile.telegram_verified_at)) {
    return reply({ error: "This account has no verified Telegram identity. Contact your administrator." }, 403);
  }
  let weekIndex: number;
  try { weekIndex = await currentWeek(auth.user.id); }
  catch { return reply({ error: "Unable to verify the account registration date." }, 500); }
  const { data: status, error: statusError } = await db.from("crm_email_mfa_status")
    .select("verified_week").eq("user_id", auth.user.id).maybeSingle();
  if (statusError) return reply({ error: "Unable to check email verification status." }, 500);
  const emailRequired = Number(status?.verified_week) !== weekIndex;
  const ticket = randomToken();
  const { data: challenge, error: insertError } = await db.from("crm_login_challenges").insert({
    user_id: auth.user.id,
    email,
    ticket_hash: await sha(ticket),
    stage: emailRequired ? "email" : "telegram",
    week_index: weekIndex,
    session_id: emailRequired ? null : auth.sessionId,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  }).select("id").single();
  if (insertError || !challenge) return reply({ error: "Unable to start secure login verification." }, 500);

  if (emailRequired) {
    return reply({ ok: true, stage: "email", challenge_ticket: ticket, email });
  }
  if (admin) {
    try {
      await completeSession(auth.user.id, auth.sessionId, weekIndex);
      await db.from("crm_login_challenges").update({ stage: "complete", completed_at: new Date().toISOString() }).eq("id", challenge.id);
      return reply({ ok: true, stage: "complete" });
    } catch { return reply({ error: "Unable to approve this login." }, 500); }
  }
  try {
    await issueTelegramCode(challenge.id, Number(profile.telegram_user_id));
    return reply({ ok: true, stage: "telegram", challenge_ticket: ticket });
  } catch {
    await db.from("crm_login_challenges").delete().eq("id", challenge.id);
    return reply({ error: "Could not deliver a Telegram verification code. Please try again." }, 502);
  }
}
async function emailVerified(req: Request, body: any) {
  const auth = await caller(req);
  const ticket = typeof body?.challenge_ticket === "string" ? body.challenge_ticket : "";
  if (!auth || !ticket) return reply({ error: "The email verification session is invalid. Start login again." }, 401);
  const { data: challenge, error } = await db.from("crm_login_challenges").select("*")
    .eq("ticket_hash", await sha(ticket)).eq("user_id", auth.user.id).eq("stage", "email").maybeSingle();
  if (error || !challenge || challenge.expires_at <= new Date().toISOString()) return reply({ error: "This login challenge expired. Start again." }, 400);
  if (auth.user.email!.trim().toLowerCase() !== String(challenge.email).toLowerCase()) return reply({ error: "The verified email does not match this account." }, 403);
  const weekIndex = await currentWeek(auth.user.id);
  if (weekIndex !== Number(challenge.week_index)) return reply({ error: "The verification period changed. Start login again." }, 400);
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("active, role, telegram_user_id, telegram_verified_at")
    .eq("id", auth.user.id).maybeSingle();
  if (profileError || !profile || profile.active !== true) return reply({ error: "This CRM account is inactive." }, 403);
  const { error: statusError } = await db.from("crm_email_mfa_status").upsert({
    user_id: auth.user.id, verified_week: weekIndex, verified_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (statusError) return reply({ error: "Could not save email verification." }, 500);
  const admin = String(profile.role || "").toLowerCase() === "admin";
  if (admin) {
    try {
      await completeSession(auth.user.id, auth.sessionId, weekIndex);
      await db.from("crm_login_challenges").update({ stage: "complete", session_id: auth.sessionId, completed_at: new Date().toISOString() }).eq("id", challenge.id);
      return reply({ ok: true, stage: "complete" });
    } catch { return reply({ error: "Unable to approve this login." }, 500); }
  }
  if (!profile.telegram_user_id || !profile.telegram_verified_at) return reply({ error: "This account has no verified Telegram identity." }, 403);
  try {
    await db.from("crm_login_challenges").update({ session_id: auth.sessionId }).eq("id", challenge.id);
    await issueTelegramCode(challenge.id, Number(profile.telegram_user_id));
    return reply({ ok: true, stage: "telegram" });
  } catch {
    return reply({ error: "Email verified, but Telegram code delivery failed. Please retry login." }, 502);
  }
}
async function finish(req: Request, body: any) {
  const auth = await caller(req);
  const ticket = typeof body?.challenge_ticket === "string" ? body.challenge_ticket : "";
  const code = typeof body?.telegram_otp === "string" ? body.telegram_otp.trim() : "";
  if (!auth || !ticket || !/^\d{6}$/.test(code)) return reply({ error: "Enter the six-digit Telegram code for this login." }, 400);
  const { data: challenge, error } = await db.from("crm_login_challenges").select("*")
    .eq("ticket_hash", await sha(ticket)).eq("user_id", auth.user.id).eq("stage", "telegram").maybeSingle();
  if (error || !challenge || challenge.expires_at <= new Date().toISOString()) return reply({ error: "This login challenge expired. Start again." }, 400);
  if (challenge.session_id !== auth.sessionId) return reply({ error: "This verification belongs to a different login session." }, 403);
  if (!challenge.telegram_otp_hash || !challenge.telegram_otp_expires_at || challenge.telegram_otp_expires_at <= new Date().toISOString()) return reply({ error: "The Telegram code expired. Start login again." }, 400);
  if (Number(challenge.attempts) >= 5) return reply({ error: "Too many incorrect attempts. Start login again." }, 429);
  if (await sha(code) !== challenge.telegram_otp_hash) {
    await db.from("crm_login_challenges").update({ attempts: Number(challenge.attempts) + 1 }).eq("id", challenge.id);
    return reply({ error: "Incorrect Telegram code." }, 400);
  }
  const weekIndex = await currentWeek(auth.user.id);
  if (weekIndex !== Number(challenge.week_index)) return reply({ error: "The weekly verification period changed. Start login again." }, 400);
  try {
    await completeSession(auth.user.id, auth.sessionId, weekIndex);
    await db.from("crm_login_challenges").update({ stage: "complete", completed_at: new Date().toISOString() }).eq("id", challenge.id);
    return reply({ ok: true, stage: "complete" });
  } catch { return reply({ error: "Unable to approve this login session." }, 500); }
}
async function validate(req: Request) {
  const auth = await caller(req);
  if (!auth) return reply({ ok: false, valid: false }, 401);
  const { data: profile, error } = await db.from("profiles").select("active").eq("id", auth.user.id).maybeSingle();
  if (error || !profile || profile.active !== true) return reply({ ok: false, valid: false }, 403);
  const weekIndex = await currentWeek(auth.user.id);
  const { data: approved, error: approvalError } = await db.from("crm_login_sessions")
    .select("session_id").eq("session_id", auth.sessionId).eq("user_id", auth.user.id)
    .eq("verified_week", weekIndex).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (approvalError || !approved) return reply({ ok: true, valid: false, email_required: true });
  return reply({ ok: true, valid: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !BOT_TOKEN) return reply({ error: "Server configuration error." }, 500);
  try {
    const body = await req.json();
    if (body?.action === "begin") return await begin(req, body);
    if (body?.action === "email_verified") return await emailVerified(req, body);
    if (body?.action === "finish") return await finish(req, body);
    if (body?.action === "validate") return await validate(req);
    return reply({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("MFA login handler:", error instanceof Error ? error.message : "Unknown error");
    return reply({ error: "Login verification could not be completed. Please try again." }, 500);
  }
});
