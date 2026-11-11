import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SMTP2GO_API_KEY = Deno.env.get("SMTP2GO_API_KEY") || "";
const SMTP2GO_FROM_EMAIL = Deno.env.get("SMTP2GO_FROM_EMAIL") || "";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
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
function hasRecentAuthMethod(token: string, method: string): boolean {
  try {
    const part = token.split(".")[1];
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    const entries = Array.isArray(payload.amr) ? payload.amr : [];
    const nowSeconds = Math.floor(Date.now() / 1000);
    return entries.some((entry: any) =>
      entry?.method === method &&
      Number.isFinite(Number(entry.timestamp)) &&
      nowSeconds - Number(entry.timestamp) >= 0 &&
      nowSeconds - Number(entry.timestamp) <= 15 * 60
    );
  } catch { return false; }
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

async function notifyUserTelegram(userId: string, message: string) {
  try {
    const { data: profile } = await db.from("profiles")
      .select("role,telegram_user_id,telegram_verified_at")
      .eq("id", userId).maybeSingle();
    if (!profile || String(profile.role || "").toLowerCase() === "supervisor" ||
        !profile.telegram_user_id || !profile.telegram_verified_at) return;
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: Number(profile.telegram_user_id), text: message, disable_web_page_preview: true }),
    });
    if (!response.ok) console.error("CRM security Telegram notification delivery failed");
  } catch (error) {
    console.error("CRM security Telegram notification failed:", error instanceof Error ? error.message : "unknown");
  }
}
async function recordOtpFailure(userId: string, eventType: "failed_email_otp" | "failed_telegram_otp", attemptCount: number) {
  await db.from("crm_security_events").insert({
    profile_id: userId, event_type: eventType, outcome: "failure",
    details: { attempt_count: attemptCount, threshold: 5 },
  });
  if (attemptCount >= 5) {
    await db.from("crm_security_events").insert({
      profile_id: userId, event_type: "security_alert_triggered", outcome: "info",
      details: { category: eventType, attempt_count: attemptCount },
    });
    await notifyUserTelegram(userId,
      "Attendance CRM security alert: five incorrect " +
      (eventType === "failed_email_otp" ? "corporate email" : "Telegram") +
      " verification codes were entered for your account. If this was not you, change your password and contact an administrator.");
  }
}
async function sendCorporateEmailOtp(email: string, code: string) {
  if (!SMTP2GO_API_KEY || !SMTP2GO_FROM_EMAIL) throw new Error("Corporate email delivery is not configured");
  const response = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Smtp2go-Api-Key": SMTP2GO_API_KEY, "Accept": "application/json" },
    body: JSON.stringify({
      sender: `Attendance CRM <${SMTP2GO_FROM_EMAIL}>`,
      to: [email],
      subject: "Your Attendance CRM verification code",
      text_body: "Your Attendance CRM verification code is: " + code +
        "\n\nThis code expires in 10 minutes and can only be used for this login. Never share it with anyone.",
      html_body: `<!doctype html><html><body style="margin:0;padding:32px 12px;background:#f3f4f6;font-family:Arial,sans-serif;color:#172033"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden"><tr><td style="padding:24px 28px;background:#171d2b;color:#fff"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#ffb36b;font-weight:bold">Attendance CRM</div><div style="font-size:22px;font-weight:bold;margin-top:10px">Verify your sign-in</div></td></tr><tr><td style="padding:28px"><p style="font-size:15px;line-height:1.6;margin:0 0 18px">Use this one-time code to verify your corporate email address:</p><div style="padding:18px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;text-align:center;color:#9a3412;font-size:32px;letter-spacing:8px;font-weight:bold">${code}</div><p style="font-size:13px;line-height:1.6;color:#667085;margin:20px 0 0">This code expires in <strong>10 minutes</strong> and can only be used for this login.</p><p style="font-size:12px;line-height:1.6;color:#98a2b3;margin:18px 0 0">If you did not request this code, ignore this message. Never share your code with anyone.</p></td></tr></table><p style="font-size:11px;color:#98a2b3;margin:16px 0 0">Automated security message · Attendance CRM</p></td></tr></table></body></html>`,
    }),
  });
  const payload = await response.json().catch(() => null);
  const succeeded = Number(payload?.data?.succeeded ?? payload?.email_response?.succeeded ?? 0);
  if (!response.ok || succeeded < 1) {
    console.error("SMTP2GO delivery failed", response.status, payload?.data?.error_code || "no successful recipient");
    throw new Error("Corporate email code delivery failed");
  }
}
async function currentWeek(userId: string) {
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error || !data.user?.created_at) throw new Error("Unable to verify account registration date");
  const created = new Date(data.user.created_at).getTime();
  return Math.max(0, Math.floor((Date.now() - created) / 604800000));
}
async function issueEmailCode(challengeId: string, email: string) {
  const code = randomOtp();
  const { error } = await db.from("crm_login_challenges").update({
    stage: "email",
    email_otp_hash: await sha(code),
    email_otp_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    email_otp_sent_at: new Date().toISOString(),
    telegram_otp_hash: null,
    telegram_otp_expires_at: null,
    attempts: 0,
  }).eq("id", challengeId);
  if (error) throw new Error("Unable to create corporate email challenge");
  try {
    await sendCorporateEmailOtp(email, code);
  } catch (error) {
    await db.from("crm_login_challenges").update({
      email_otp_hash: null, email_otp_expires_at: null, email_otp_sent_at: null,
    }).eq("id", challengeId);
    throw error;
  }
}
async function issueTelegramCode(challengeId: string, telegramUserId: number) {
  const code = randomOtp();
  const { error } = await db.from("crm_login_challenges").update({
    stage: "telegram",
    telegram_otp_hash: await sha(code),
    telegram_otp_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    email_otp_hash: null,
    email_otp_expires_at: null,
    attempts: 0,
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
  if (!auth || !hasRecentAuthMethod(auth.token, "password")) return reply({ error: "Verify your password again to start login." }, 401);
  const email = auth.user.email!.trim().toLowerCase();

  // Invitation registration already verified both factors before the auth user
  // was created. Consume its short-lived, DB-issued grant once to approve this
  // first password session without sending duplicate OTPs.
  const { data: registrationGrant, error: grantError } = await db
    .from("invitation_registration_access_grants")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", auth.user.id)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("user_id")
    .maybeSingle();
  if (grantError) return reply({ error: "Unable to validate the completed registration." }, 500);
  if (registrationGrant) {
    try {
      const weekIndex = await currentWeek(auth.user.id);
      await completeSession(auth.user.id, auth.sessionId, weekIndex);
      await notifyUserTelegram(auth.user.id, "Attendance CRM: a successful sign-in to your account was completed using your verified invitation. If this was not you, contact an administrator.");
      return reply({ ok: true, stage: "complete", verification: "invitation_verified" });
    } catch {
      return reply({ error: "Your registration is complete, but the first session could not be approved. Sign in again." }, 500);
    }
  }

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
  let weekIndex: number;
  try { weekIndex = await currentWeek(auth.user.id); }
  catch { return reply({ error: "Unable to verify the account registration date." }, 500); }

  // Admin accounts intentionally use password-only authentication.
  // Do not create an email/Telegram challenge or update the user's weekly
  // corporate-email verification status for an admin login.
  if (admin) {
    try {
      await completeSession(auth.user.id, auth.sessionId, weekIndex);
      await notifyUserTelegram(auth.user.id, "Attendance CRM: a successful administrator sign-in was completed. If this was not you, contact an administrator immediately.");
      return reply({ ok: true, stage: "complete", verification: "password_only" });
    } catch {
      return reply({ error: "Unable to approve this admin login." }, 500);
    }
  }

  if (!profile.telegram_user_id || !profile.telegram_verified_at) {
    return reply({ error: "This account has no verified Telegram identity. Contact your administrator." }, 403);
  }
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
    session_id: auth.sessionId,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  }).select("id").single();
  if (insertError || !challenge) return reply({ error: "Unable to start secure login verification." }, 500);

  if (emailRequired) {
    try {
      await issueEmailCode(challenge.id, email);
      return reply({ ok: true, stage: "email", challenge_ticket: ticket, email });
    } catch {
      await db.from("crm_login_challenges").delete().eq("id", challenge.id);
      return reply({ error: "Could not send the corporate email verification code. Check the email delivery configuration or try again later." }, 502);
    }
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
async function resendEmail(req: Request, body: any) {
  const auth = await caller(req);
  const ticket = typeof body?.challenge_ticket === "string" ? body.challenge_ticket : "";
  if (!auth || !ticket) return reply({ error: "The email verification session is invalid. Start login again." }, 401);
  const { data: challenge, error } = await db.from("crm_login_challenges").select("*")
    .eq("ticket_hash", await sha(ticket)).eq("user_id", auth.user.id).eq("stage", "email").maybeSingle();
  if (error || !challenge || challenge.expires_at <= new Date().toISOString()) return reply({ error: "This login challenge expired. Start again." }, 400);
  if (challenge.session_id !== auth.sessionId) return reply({ error: "This verification belongs to a different login session." }, 403);
  if (challenge.email_otp_sent_at && Date.now() - new Date(challenge.email_otp_sent_at).getTime() < 60_000) {
    return reply({ error: "Please wait one minute before requesting another email code." }, 429);
  }
  try {
    await issueEmailCode(challenge.id, String(challenge.email));
    return reply({ ok: true, stage: "email" });
  } catch {
    return reply({ error: "Could not resend the corporate email code. Please try again later." }, 502);
  }
}
async function emailVerified(req: Request, body: any) {
  const auth = await caller(req);
  const ticket = typeof body?.challenge_ticket === "string" ? body.challenge_ticket : "";
  const code = typeof body?.email_otp === "string" ? body.email_otp.trim() : "";
  if (!auth || !ticket || !/^\d{6}$/.test(code)) return reply({ error: "Enter the six-digit code sent to your corporate email." }, 400);
  const { data: challenge, error } = await db.from("crm_login_challenges").select("*")
    .eq("ticket_hash", await sha(ticket)).eq("user_id", auth.user.id).eq("stage", "email").maybeSingle();
  if (error || !challenge || challenge.expires_at <= new Date().toISOString()) return reply({ error: "This login challenge expired. Start again." }, 400);
  if (challenge.session_id !== auth.sessionId) return reply({ error: "This verification belongs to a different login session." }, 403);
  if (!challenge.email_otp_hash || !challenge.email_otp_expires_at || challenge.email_otp_expires_at <= new Date().toISOString()) {
    return reply({ error: "The corporate email code expired. Request a new code or start login again." }, 400);
  }
  if (Number(challenge.attempts) >= 5) return reply({ error: "Too many incorrect attempts. Start login again." }, 429);
  if (await sha(code) !== challenge.email_otp_hash) {
    const nextAttempts = Number(challenge.attempts) + 1;
    await db.from("crm_login_challenges").update({ attempts: nextAttempts }).eq("id", challenge.id);
    await recordOtpFailure(auth.user.id, "failed_email_otp", nextAttempts);
    return reply({ error: "Incorrect corporate email code." }, 400);
  }
  if (auth.user.email!.trim().toLowerCase() !== String(challenge.email).toLowerCase()) {
    return reply({ error: "The verified email does not match this account." }, 403);
  }
  const weekIndex = await currentWeek(auth.user.id);
  if (weekIndex !== Number(challenge.week_index)) return reply({ error: "The verification period changed. Start login again." }, 400);
  const { data: claimed, error: claimError } = await db.from("crm_login_challenges").update({
    stage: "telegram", email_otp_hash: null, email_otp_expires_at: null, attempts: 0,
  }).eq("id", challenge.id).eq("stage", "email").eq("email_otp_hash", challenge.email_otp_hash)
    .select("id").maybeSingle();
  if (claimError || !claimed) return reply({ error: "This email code has already been used. Start login again." }, 409);
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("active, role, telegram_user_id, telegram_verified_at")
    .eq("id", auth.user.id).maybeSingle();
  if (profileError || !profile || profile.active !== true) {
    await db.from("crm_login_challenges").delete().eq("id", challenge.id);
    return reply({ error: "This CRM account is inactive." }, 403);
  }
  if (!profile.telegram_user_id || !profile.telegram_verified_at) {
    await db.from("crm_login_challenges").delete().eq("id", challenge.id);
    return reply({ error: "This account has no verified Telegram identity." }, 403);
  }
  try {
    await issueTelegramCode(challenge.id, Number(profile.telegram_user_id));
    return reply({ ok: true, stage: "telegram" });
  } catch {
    await db.from("crm_login_challenges").delete().eq("id", challenge.id);
    return reply({ error: "Corporate email verified, but Telegram code delivery failed. Start login again." }, 502);
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
    const nextAttempts = Number(challenge.attempts) + 1;
    await db.from("crm_login_challenges").update({ attempts: nextAttempts }).eq("id", challenge.id);
    await recordOtpFailure(auth.user.id, "failed_telegram_otp", nextAttempts);
    return reply({ error: "Incorrect Telegram code." }, 400);
  }
  const weekIndex = await currentWeek(auth.user.id);
  if (weekIndex !== Number(challenge.week_index)) return reply({ error: "The weekly verification period changed. Start login again." }, 400);
  try {
    // Record the weekly email factor only after the full required login
    // sequence succeeds. An email-only attempt must not satisfy next week's gate.
    const { error: statusError } = await db.from("crm_email_mfa_status").upsert({
      user_id: auth.user.id, verified_week: weekIndex, verified_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (statusError) throw new Error("Unable to save weekly email verification");
    await completeSession(auth.user.id, auth.sessionId, weekIndex);
    await db.from("crm_login_challenges").update({ stage: "complete", completed_at: new Date().toISOString() }).eq("id", challenge.id);
    await notifyUserTelegram(auth.user.id, "Attendance CRM: a successful sign-in to your account was completed after Telegram verification. If this was not you, contact an administrator.");
    return reply({ ok: true, stage: "complete" });
  } catch { return reply({ error: "Unable to approve this login session." }, 500); }
}
async function deviceRegistered(req: Request, body: any) {
  const auth = await caller(req);
  const sessionId = typeof body?.session_id === "string" ? body.session_id : "";
  if (!auth || !/^[0-9a-f-]{36}$/i.test(sessionId)) return reply({ error: "Authenticated device session required." }, 401);
  const { data: device, error } = await db.from("device_security_sessions")
    .select("id,app_platform,app_version,os_name,device_model,app_instance_id,ip_address")
    .eq("id", sessionId).eq("user_id", auth.user.id).is("ended_at", null).maybeSingle();
  if (error || !device) return reply({ error: "Device session not found." }, 404);
  let isNewInstallation = true;
  if (device.app_instance_id) {
    const { data: previous } = await db.from("device_security_sessions").select("id")
      .eq("user_id", auth.user.id).eq("app_instance_id", device.app_instance_id)
      .neq("id", sessionId).limit(1);
    isNewInstallation = !previous?.length;
  }
  if (isNewInstallation) {
    await notifyUserTelegram(auth.user.id,
      "Attendance CRM security notice: a new app installation signed in to your account.\nPlatform: " +
      String(device.app_platform || "unknown") + "\nVersion: " + String(device.app_version || "unknown") +
      "\nDevice: " + String(device.device_model || device.os_name || "not reported") +
      "\nIf this was not you, change your password and contact an administrator.");
  }
  return reply({ ok: true, notified: isNewInstallation });
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
    if (body?.action === "resend_email") return await resendEmail(req, body);
    if (body?.action === "email_verified") return await emailVerified(req, body);
    if (body?.action === "finish") return await finish(req, body);
    if (body?.action === "device_registered") return await deviceRegistered(req, body);
    if (body?.action === "validate") return await validate(req);
    return reply({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("MFA login handler:", error instanceof Error ? error.message : "Unknown error");
    return reply({ error: "Login verification could not be completed. Please try again." }, 500);
  }
});
