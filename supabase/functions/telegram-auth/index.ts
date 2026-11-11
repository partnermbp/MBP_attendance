// Deployment source remains owned by the serialized auth Edge Function workflow.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Login OTP delivery is handled by auth-mfa-login; this function only handles Telegram linking and invitation verification.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // Supabase JS and browser preflight headers used by the public invitation flow.
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function randomOtp(): string {
  const values = crypto.getRandomValues(new Uint32Array(1));
  return String(values[0] % 1_000_000).padStart(6, "0");
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}
async function sendTelegramMessage(chatId: number, messageText: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: messageText }),
  });
  if (!response.ok) {
    console.error("Telegram sendMessage failed:", response.status);
    throw new Error("Telegram message delivery failed");
  }
}

const SMTP2GO_API_KEY = Deno.env.get("SMTP2GO_API_KEY") || "";
const SMTP2GO_FROM_EMAIL = Deno.env.get("SMTP2GO_FROM_EMAIL") || "";
async function sendInvitationEmailOtp(email: string, code: string): Promise<void> {
  if (!SMTP2GO_API_KEY || !SMTP2GO_FROM_EMAIL) throw new Error("Corporate email delivery is not configured.");
  const response = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Smtp2go-Api-Key": SMTP2GO_API_KEY, "Accept": "application/json" },
    body: JSON.stringify({
      sender: `Attendance CRM <${SMTP2GO_FROM_EMAIL}>`,
      to: [email],
      subject: "Verify your email — Attendance CRM registration",
      text_body: "Your Attendance CRM registration code is: " + code + "\\n\\nThis code expires in 10 minutes. Never share it with anyone.",
      html_body: `<!doctype html><html><body style="margin:0;padding:32px 12px;background:#f3f4f6;font-family:Arial,sans-serif;color:#172033"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden"><tr><td style="padding:24px 28px;background:#171d2b;color:#fff"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#ffb36b;font-weight:bold">Attendance CRM</div><div style="font-size:22px;font-weight:bold;margin-top:10px">Verify your corporate email</div></td></tr><tr><td style="padding:28px"><p style="font-size:15px;line-height:1.6">Use this one-time code to complete your invitation registration:</p><div style="padding:18px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;text-align:center;color:#9a3412;font-size:32px;letter-spacing:8px;font-weight:bold">${code}</div><p style="font-size:13px;color:#667085;margin-top:20px">This code expires in <strong>10 minutes</strong>.</p><p style="font-size:12px;color:#98a2b3">If you did not request this code, ignore this email. Never share your code.</p></td></tr></table><p style="font-size:11px;color:#98a2b3;margin:16px 0 0">Automated security message · Attendance CRM</p></td></tr></table></body></html>`,
    }),
  });
  const payload = await response.json().catch(() => null);
  const succeeded = Number(payload?.data?.succeeded ?? payload?.email_response?.succeeded ?? 0);
  if (!response.ok || succeeded < 1) {
    console.error("Invitation SMTP2GO delivery failed:", response.status, payload?.data?.error_code || "no successful recipient");
    throw new Error("Corporate email code delivery failed.");
  }
}
async function getActiveLinkedProfile(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  let page = 1;
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Unable to check the account");
    const user = data.users.find((item) => item.email?.trim().toLowerCase() === normalizedEmail);
    if (user) {
      const { data: profile, error: profileError } = await supabase.from("profiles")
        .select("id, active, telegram_user_id, telegram_verified_at").eq("id", user.id).maybeSingle();
      if (profileError) throw new Error("Unable to check the account");
      if (!profile || profile.active !== true || profile.telegram_user_id == null || profile.telegram_verified_at == null) return null;
      return { userId: user.id, email: normalizedEmail, telegramUserId: Number(profile.telegram_user_id) };
    }
    if (data.users.length < 1000) break;
    page++;
  }
  return null;
}
async function createLinkToken(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return jsonResponse({ error: "Sign in first." }, 401);
  const { data: authData, error: authError } = await supabase.auth.getUser(match[1]);
  if (authError || !authData.user) return jsonResponse({ error: "Your session is invalid or expired." }, 401);
  const user = authData.user;
  if (!user.email) return jsonResponse({ error: "Your account has no email address." }, 400);
  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("id, active, telegram_user_id, telegram_verified_at").eq("id", user.id).maybeSingle();
  if (profileError) return jsonResponse({ error: "Unable to check your profile." }, 500);
  if (!profile || profile.active !== true) return jsonResponse({ error: "Your account is not active." }, 403);
  if (profile.telegram_user_id != null || profile.telegram_verified_at != null) {
    return jsonResponse({ error: "A Telegram account is already linked. Contact your administrator if it needs to be changed." }, 409);
  }
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error: cleanupError } = await supabase.from("telegram_link_tokens").delete().eq("user_id", user.id).is("used_at", null);
  if (cleanupError) return jsonResponse({ error: "Unable to prepare account linking." }, 500);
  const { error: insertError } = await supabase.from("telegram_link_tokens").insert({ user_id: user.id, token_hash: tokenHash, expires_at: expiresAt });
  if (insertError) return jsonResponse({ error: "Unable to create a linking token." }, 500);
  return jsonResponse({ ok: true, expires_at: expiresAt, bot_url: `https://t.me/mbpauthbot?start=${token}`, message: "Open the Telegram link within 10 minutes." });
}
async function getLinkStatus(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return jsonResponse({ ok: false, error: "Sign in first." }, 401);
  const { data: authData, error: authError } = await supabase.auth.getUser(match[1]);
  if (authError || !authData.user) return jsonResponse({ ok: false, error: "Your session is invalid or expired." }, 401);
  const { data: profile, error } = await supabase.from("profiles")
    .select("active, telegram_user_id, telegram_verified_at")
    .eq("id", authData.user.id).maybeSingle();
  if (error) return jsonResponse({ ok: false, error: "Unable to check your Telegram status." }, 500);
  if (!profile || profile.active !== true) return jsonResponse({ ok: false, error: "Your account is not active." }, 403);
  const linked = profile.telegram_user_id != null || profile.telegram_verified_at != null;
  return jsonResponse({ ok: true, linked });
}


async function createInviteTelegramChallenge(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }
  const token = typeof body?.invitation_token === "string" ? body.invitation_token : "";
  if (!/^[a-f0-9]{64}$/i.test(token)) return jsonResponse({ error: "Invalid invitation link." }, 400);
  const tokenHash = await sha256Hex(token);
  const { data: invite, error } = await supabase.from("manager_invitations")
    .select("id, corporate_email, redeemed_at, expires_at")
    .eq("token_hash", tokenHash).maybeSingle();
  if (error) return jsonResponse({ error: "Unable to check invitation." }, 500);
  if (!invite || invite.redeemed_at || new Date(invite.expires_at).getTime() <= Date.now()) return jsonResponse({ error: "Invitation is invalid, expired, or already used." }, 400);
  const cutoff = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: recent, error: recentError } = await supabase.from("manager_invitation_telegram_verifications")
    .select("id").eq("invitation_id", invite.id).gte("created_at", cutoff).limit(1);
  if (recentError) return jsonResponse({ error: "Unable to prepare Telegram verification." }, 500);
  if (recent?.length) return jsonResponse({ error: "A Telegram verification was just requested. Wait one minute and try again." }, 429);
  const { data: existing } = await supabase.from("manager_invitation_telegram_verifications")
    .select("id").eq("invitation_id", invite.id).is("ticket_used_at", null).limit(1);
  if (existing?.length) {
    await supabase.from("manager_invitation_telegram_verifications").delete().eq("invitation_id", invite.id).is("ticket_used_at", null);
  }
  const challenge = randomToken();
  const { error: insertError } = await supabase.from("manager_invitation_telegram_verifications").insert({
    invitation_id: invite.id, challenge_hash: await sha256Hex(challenge),
  });
  if (insertError) return jsonResponse({ error: "Unable to prepare Telegram verification." }, 500);
  return jsonResponse({ ok: true, bot_url: `https://t.me/mbpauthbot?start=${challenge}`, message: "Open the bot and press Start. The bot will send a verification code to that Telegram account." });
}


async function sendInviteEmailOtp(req: Request) {
  let body: any; try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid request." }, 400); }
  const token = typeof body?.invitation_token === "string" ? body.invitation_token : "";
  const telegramTicket = typeof body?.registration_ticket === "string" ? body.registration_ticket : "";
  if (!/^[a-f0-9]{64}$/i.test(token) || !/^[A-Za-z0-9_-]{40,50}$/.test(telegramTicket)) return jsonResponse({ error: "Complete Telegram verification first." }, 400);
  const { data: invite, error } = await supabase.from("manager_invitations")
    .select("id, corporate_email, redeemed_at, expires_at")
    .eq("token_hash", await sha256Hex(token)).maybeSingle();
  if (error || !invite || invite.redeemed_at || new Date(invite.expires_at).getTime() <= Date.now()) return jsonResponse({ error: "Invitation is invalid, expired, or already used." }, 400);
  const { data: tg, error: tgError } = await supabase.from("manager_invitation_telegram_verifications")
    .select("id, verified_at, ticket_used_at, ticket_expires_at, telegram_user_id, telegram_username")
    .eq("invitation_id", invite.id).eq("ticket_hash", await sha256Hex(telegramTicket)).maybeSingle();
  if (tgError || !tg || !tg.verified_at || tg.ticket_used_at || !tg.ticket_expires_at || new Date(tg.ticket_expires_at).getTime() <= Date.now()) return jsonResponse({ error: "Telegram verification is missing or expired. Verify Telegram again." }, 400);
  const { data: old, error: oldError } = await supabase.from("manager_invitation_email_verifications")
    .select("id, otp_sent_at, email_ticket_expires_at, ticket_used_at")
    .eq("invitation_id", invite.id).maybeSingle();
  if (oldError) return jsonResponse({ error: "Unable to prepare email verification." }, 500);
  if (old?.otp_sent_at && Date.now() - new Date(old.otp_sent_at).getTime() < 60_000) return jsonResponse({ error: "An email code was sent recently. Wait one minute before requesting another." }, 429);
  const code = randomOtp();
  const row = {
    invitation_id: invite.id, email: invite.corporate_email,
    otp_hash: await sha256Hex(code), otp_expires_at: new Date(Date.now()+10*60*1000).toISOString(),
    otp_sent_at: new Date().toISOString(), attempts: 0, verified_at: null,
    email_ticket_hash: null, email_ticket_expires_at: null, ticket_used_at: null,
  };
  const { error: saveError } = old
    ? await supabase.from("manager_invitation_email_verifications").update(row).eq("id", old.id)
    : await supabase.from("manager_invitation_email_verifications").insert(row);
  if (saveError) return jsonResponse({ error: "Unable to prepare email verification." }, 500);
  try { await sendInvitationEmailOtp(invite.corporate_email, code); }
  catch {
    await supabase.from("manager_invitation_email_verifications").update({ otp_hash: null, otp_expires_at: null, otp_sent_at: null }).eq("invitation_id", invite.id);
    return jsonResponse({ error: "Could not send the corporate email code. Check email delivery configuration and try again." }, 502);
  }
  return jsonResponse({ ok: true, email: invite.corporate_email, message: "A verification code was sent to the invited email address." });
}

async function verifyInviteEmailOtp(req: Request) {
  let body: any; try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid request." }, 400); }
  const token = typeof body?.invitation_token === "string" ? body.invitation_token : "";
  const otp = typeof body?.otp === "string" ? body.otp.trim() : "";
  if (!/^[a-f0-9]{64}$/i.test(token) || !/^\d{6}$/.test(otp)) return jsonResponse({ error: "Enter the six-digit code sent to your corporate email." }, 400);
  const { data: invite, error: inviteError } = await supabase.from("manager_invitations")
    .select("id, invited_by, corporate_email, redeemed_at, expires_at").eq("token_hash", await sha256Hex(token)).maybeSingle();
  if (inviteError || !invite || invite.redeemed_at || new Date(invite.expires_at).getTime() <= Date.now()) return jsonResponse({ error: "Invitation is invalid, expired, or already used." }, 400);
  const { data: verification, error } = await supabase.from("manager_invitation_email_verifications")
    .select("id, email, otp_hash, otp_expires_at, attempts, verified_at")
    .eq("invitation_id", invite.id).maybeSingle();
  if (error || !verification || verification.email.toLowerCase() !== invite.corporate_email.toLowerCase()) return jsonResponse({ error: "Request an email verification code first." }, 400);
  if (verification.verified_at) return jsonResponse({ error: "This email code has already been verified. Continue registration." }, 409);
  if (!verification.otp_hash || !verification.otp_expires_at || new Date(verification.otp_expires_at).getTime() <= Date.now()) return jsonResponse({ error: "The email code expired. Request a new one." }, 400);
  if (verification.attempts >= 5) return jsonResponse({ error: "Too many incorrect attempts. Request a new code." }, 429);
  if (await sha256Hex(otp) !== verification.otp_hash) {
    const nextAttempts = verification.attempts + 1;
    await supabase.from("manager_invitation_email_verifications").update({ attempts: nextAttempts }).eq("id", verification.id);
    if (invite.invited_by) {
      await supabase.from("crm_security_events").insert({
        profile_id: invite.invited_by, event_type: "failed_email_otp", outcome: "failure",
        details: { category: "invitation_email_otp", invitation_id: invite.id, attempt_count: nextAttempts },
      });
      if (nextAttempts === 5) await supabase.from("crm_security_events").insert({
        profile_id: invite.invited_by, event_type: "security_alert_triggered", outcome: "info",
        details: { category: "invitation_email_otp", invitation_id: invite.id, attempt_count: nextAttempts },
      });
    }
    return jsonResponse({ error: "Incorrect corporate email code." }, 400);
  }
  const ticket = randomToken();
  const { error: updateError } = await supabase.from("manager_invitation_email_verifications").update({
    verified_at: new Date().toISOString(), email_ticket_hash: await sha256Hex(ticket),
    email_ticket_expires_at: new Date(Date.now()+24*60*60*1000).toISOString(), otp_hash: null, otp_expires_at: null,
  }).eq("id", verification.id).is("verified_at", null);
  if (updateError) return jsonResponse({ error: "Unable to save email verification." }, 500);
  return jsonResponse({ ok: true, email_registration_ticket: ticket, message: "Corporate email verified." });
}

async function createInvitedAccount(req: Request) {
  let body: any; try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid request." }, 400); }
  const token = typeof body?.invitation_token === "string" ? body.invitation_token : "";
  const telegramTicket = typeof body?.registration_ticket === "string" ? body.registration_ticket : "";
  const emailTicket = typeof body?.email_registration_ticket === "string" ? body.email_registration_ticket : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^[a-f0-9]{64}$/i.test(token) || !/^[A-Za-z0-9_-]{40,50}$/.test(telegramTicket) || !/^[A-Za-z0-9_-]{40,50}$/.test(emailTicket) || password.length < 8 || password.length > 128) return jsonResponse({ error: "Complete both verifications and enter a password of at least eight characters." }, 400);
  const tokenHash = await sha256Hex(token);
  const { data: invite, error } = await supabase.from("manager_invitations")
    .select("id, admin_panel_name, corporate_email, redeemed_at, expires_at")
    .eq("token_hash", tokenHash).maybeSingle();
  if (error || !invite || invite.redeemed_at || new Date(invite.expires_at).getTime() <= Date.now()) return jsonResponse({ error: "Invitation is invalid, expired, or already used." }, 400);
  const { data: tg, error: tgError } = await supabase.from("manager_invitation_telegram_verifications")
    .select("id, verified_at, ticket_used_at, ticket_expires_at, telegram_username")
    .eq("invitation_id", invite.id).eq("ticket_hash", await sha256Hex(telegramTicket)).maybeSingle();
  const { data: em, error: emError } = await supabase.from("manager_invitation_email_verifications")
    .select("id, verified_at, ticket_used_at, email_ticket_expires_at, email")
    .eq("invitation_id", invite.id).eq("email_ticket_hash", await sha256Hex(emailTicket)).maybeSingle();
  if (tgError || !tg || !tg.verified_at || tg.ticket_used_at || !tg.ticket_expires_at || new Date(tg.ticket_expires_at).getTime() <= Date.now()) return jsonResponse({ error: "Telegram verification is missing or expired." }, 400);
  if (emError || !em || !em.verified_at || em.ticket_used_at || !em.email_ticket_expires_at || new Date(em.email_ticket_expires_at).getTime() <= Date.now() || em.email.toLowerCase() !== invite.corporate_email.toLowerCase()) return jsonResponse({ error: "Corporate email verification is missing or expired." }, 400);
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: invite.corporate_email, password, email_confirm: true,
    user_metadata: { full_name: invite.admin_panel_name, admin_panel_name: invite.admin_panel_name, invitation_token: token, registration_ticket: telegramTicket, email_registration_ticket: emailTicket },
  });
  if (createError || !created.user) {
    const failure = createError?.message || "No user returned";
    console.error("Invited account creation failed:", failure);
    const lowerFailure = failure.toLowerCase();
    const publicMessage = lowerFailure.includes("already been registered")
      ? "An account already exists for this email. Contact your administrator."
      : lowerFailure.includes("telegram account is already linked")
        ? "This Telegram account is already linked to another CRM account. Contact your administrator."
        : lowerFailure.includes("email address is not permitted")
          ? "This email address is not permitted by the CRM account policy. Contact your administrator."
          : lowerFailure.includes("invitation is invalid")
            ? "This invitation is invalid, expired, or already used. Ask your inviter for a new link."
            : lowerFailure.includes("verification is missing") || lowerFailure.includes("verification is required")
              ? "One of the verification checks has expired or is no longer valid. Restart the invitation registration."
              : "Account creation failed: " + failure;
    return jsonResponse({ error: publicMessage }, 409);
  }
  // The database trigger has already consumed both tickets. Remove raw bearer
  // tickets from Auth metadata immediately; only non-secret profile labels remain.
  const { error: metadataError } = await supabase.auth.admin.updateUserById(created.user.id, {
    user_metadata: { full_name: invite.admin_panel_name, admin_panel_name: invite.admin_panel_name },
  });
  if (metadataError) console.error("Could not clear consumed invitation metadata:", metadataError.message);
  const { error: usernameError } = await supabase.from("profiles")
    .update({ telegram_username: tg.telegram_username ?? null })
    .eq("id", created.user.id);
  if (usernameError) console.error("Could not save verified Telegram username:", usernameError.message);
  await supabase.from("crm_security_events").insert({
    profile_id: created.user.id, event_type: "invitation_accepted", outcome: "success",
    details: { invitation_id: invite.id, invited_role: invite.invited_role },
  });
  return jsonResponse({ ok: true, email: invite.corporate_email, message: "Both identity checks passed and your CRM account has been created." });
}

async function verifyInviteTelegramOtp(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }
  const token = typeof body?.invitation_token === "string" ? body.invitation_token : "";
  const challenge = typeof body?.challenge === "string" ? body.challenge : "";
  const otp = typeof body?.otp === "string" ? body.otp.trim() : "";
  if (!/^[a-f0-9]{64}$/i.test(token) || !/^[A-Za-z0-9_-]{40,50}$/.test(challenge) || !/^\d{6}$/.test(otp)) return jsonResponse({ error: "Enter the six-digit code sent by @mbpauthbot." }, 400);
  const tokenHash = await sha256Hex(token);
  const challengeHash = await sha256Hex(challenge);
  const { data: invite, error: inviteError } = await supabase.from("manager_invitations").select("id, invited_by, admin_panel_name, corporate_email, redeemed_at, expires_at").eq("token_hash", tokenHash).maybeSingle();
  if (inviteError || !invite || invite.redeemed_at || new Date(invite.expires_at).getTime() <= Date.now()) return jsonResponse({ error: "Invitation is invalid, expired, or already used." }, 400);
  const { data: verification, error } = await supabase.from("manager_invitation_telegram_verifications")
    .select("id, otp_hash, otp_expires_at, attempts, telegram_user_id, telegram_username, verified_at")
    .eq("invitation_id", invite.id).eq("challenge_hash", challengeHash).maybeSingle();
  if (error || !verification) return jsonResponse({ error: "Start @mbpauthbot from this invitation first." }, 400);
  if (!verification.otp_hash || !verification.otp_expires_at || new Date(verification.otp_expires_at).getTime() <= Date.now()) return jsonResponse({ error: "The code has expired. Request a new Telegram verification." }, 400);
  if (verification.attempts >= 5) return jsonResponse({ error: "Too many incorrect attempts. Request a new verification." }, 429);
  if (await sha256Hex(otp) !== verification.otp_hash) {
    const nextAttempts = verification.attempts + 1;
    await supabase.from("manager_invitation_telegram_verifications").update({ attempts: nextAttempts }).eq("id", verification.id);
    if (invite.invited_by) {
      await supabase.from("crm_security_events").insert({
        profile_id: invite.invited_by, event_type: "failed_telegram_otp", outcome: "failure",
        details: { category: "invitation_telegram_otp", invitation_id: invite.id, attempt_count: nextAttempts },
      });
      if (nextAttempts === 5) await supabase.from("crm_security_events").insert({
        profile_id: invite.invited_by, event_type: "security_alert_triggered", outcome: "info",
        details: { category: "invitation_telegram_otp", invitation_id: invite.id, attempt_count: nextAttempts },
      });
    }
    return jsonResponse({ error: "Incorrect code. Check the Telegram message and try again." }, 400);
  }
  if (!verification.telegram_user_id) return jsonResponse({ error: "Telegram has not confirmed this account yet. Open the bot and press Start." }, 400);
  const { data: existingTelegramProfile, error: existingTelegramError } = await supabase
    .from("profiles").select("id").eq("telegram_user_id", verification.telegram_user_id).maybeSingle();
  if (existingTelegramError) return jsonResponse({ error: "Unable to check this Telegram account. Please try again." }, 500);
  if (existingTelegramProfile) {
    await logSuspiciousTelegramReuse(invite, verification.telegram_user_id, verification.telegram_username ?? null);
    return jsonResponse({ error: "This Telegram ID is already registered to an Attendance CRM account. Please use a different Telegram account." }, 409);
  }
  const ticket = randomToken();
  const ticketExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error: updateError } = await supabase.from("manager_invitation_telegram_verifications").update({
    verified_at: new Date().toISOString(), ticket_hash: await sha256Hex(ticket), ticket_expires_at: ticketExpiresAt,
  }).eq("id", verification.id);
  if (updateError) return jsonResponse({ error: "Unable to save Telegram verification." }, 500);
  return jsonResponse({ ok: true, registration_ticket: ticket, message: "Telegram verified. You can now create your account with the invited corporate email." });
}


async function logSuspiciousTelegramReuse(invite: any, telegramUserId: number, username: string | null) {
  let inviterName: string | null = null;
  if (invite?.invited_by) {
    const { data: inviter } = await supabase.from("profiles")
      .select("full_name, email").eq("id", invite.invited_by).maybeSingle();
    inviterName = inviter?.full_name || inviter?.email || null;
  }
  const { error } = await supabase.from("suspicious_activities").insert({
    event_type: "telegram_id_already_registered",
    inviter_id: invite?.invited_by ?? null,
    inviter_name: inviterName,
    invitee_admin_panel_name: invite?.admin_panel_name ?? null,
    invitee_email: invite?.corporate_email ?? null,
    telegram_user_id: telegramUserId,
    telegram_username: username,
    details: "An invitation attempt used a Telegram ID already linked to a registered CRM account. Verification was blocked."
  });
  if (error) console.error("Could not write suspicious activity audit event:", error.message);
}

async function handleTelegramUpdate(update: any) {
  const message = update?.message;
  const chatId = message?.chat?.id;
  const telegramUserId = message?.from?.id;
  const username = typeof message?.from?.username === "string" ? message.from.username : null;
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  if (typeof chatId !== "number" || typeof telegramUserId !== "number" || !text) return jsonResponse({ ok: true });

  const inviteChallengeMatch = text.match(/^\/start(?:@mbpauthbot)?\s+([A-Za-z0-9_-]{40,50})$/);
  if (inviteChallengeMatch) {
    const challengeHash = await sha256Hex(inviteChallengeMatch[1]);
    const { data: verification, error } = await supabase.from("manager_invitation_telegram_verifications")
      .select("id, invitation_id, otp_sent_at, ticket_used_at")
      .eq("challenge_hash", challengeHash).maybeSingle();
    if (error || !verification) {
      // A normal account-link token has the same shape; allow it to reach the legacy handler below.
    } else {
    if (verification.ticket_used_at) {
      await sendTelegramMessage(chatId, "This invitation verification link is invalid or expired. Return to the invitation page and start verification again.");
      return jsonResponse({ ok: true });
    }
    const { data: invite } = await supabase.from("manager_invitations").select("id, invited_by, admin_panel_name, corporate_email, redeemed_at, expires_at").eq("id", verification.invitation_id).maybeSingle();
    if (!invite || invite.redeemed_at || new Date(invite.expires_at).getTime() <= Date.now()) {
      await sendTelegramMessage(chatId, "This invitation has expired or has already been used. Contact your manager for a new invitation.");
      return jsonResponse({ ok: true });
    }
    const { data: existingTelegramProfile, error: existingTelegramError } = await supabase
      .from("profiles").select("id").eq("telegram_user_id", telegramUserId).maybeSingle();
    if (existingTelegramError) {
      await sendTelegramMessage(chatId, "We couldn't verify this Telegram account right now. Please try again later.");
      return jsonResponse({ ok: true });
    }
    if (existingTelegramProfile) {
      await logSuspiciousTelegramReuse(invite, telegramUserId, username);
      await sendTelegramMessage(chatId, "This Telegram ID is already registered to an Attendance CRM account. Please use a different Telegram account. Your invitation verification was blocked.");
      return jsonResponse({ ok: true });
    }
    if (verification.otp_sent_at && Date.now() - new Date(verification.otp_sent_at).getTime() < 60_000) {
      await sendTelegramMessage(chatId, "A verification code was sent recently. Check this chat, then enter it on the invitation page.");
      return jsonResponse({ ok: true });
    }
    const otp = randomOtp();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: updateError } = await supabase.from("manager_invitation_telegram_verifications").update({
      otp_hash: await sha256Hex(otp), otp_expires_at: otpExpiresAt, otp_sent_at: new Date().toISOString(),
      attempts: 0, telegram_user_id: telegramUserId, telegram_username: username,
    }).eq("id", verification.id);
    if (updateError) {
      await sendTelegramMessage(chatId, "We couldn't start verification. Return to the invitation page and try again.");
      return jsonResponse({ ok: true });
    }
    await sendTelegramMessage(chatId, "Your Attendance CRM registration verification code is:\n\n" + otp + "\n\nEnter this six-digit code on the invitation page. It expires in 10 minutes and can only be used for this invitation. Never share it with anyone.");
    return jsonResponse({ ok: true });
    }
  }

  if (text === "/start" || text === "/start@mbpauthbot") {
    await sendTelegramMessage(chatId, "Welcome to the Attendance CRM.\n\nOpen the invitation link provided by your manager and click “Authenticate with Telegram” to verify Telegram before registering.\n\nNever share login codes or passwords with anyone.");
    return jsonResponse({ ok: true });
  }
  const linkMatch = text.match(/^\/start(?:@mbpauthbot)?\s+([A-Za-z0-9_-]{20,64})$/);
  if (linkMatch) {
    const tokenHash = await sha256Hex(linkMatch[1]);
    const { data, error } = await supabase.rpc("claim_telegram_link_token", { p_token_hash: tokenHash, p_telegram_user_id: telegramUserId, p_telegram_username: username });
    if (error) {
      await sendTelegramMessage(chatId, "We couldn't complete account linking. Please request a new link from the attendance website or contact your administrator.");
      return jsonResponse({ ok: true });
    }
    await sendTelegramMessage(chatId, data === true ? "Your Telegram account has been linked successfully to the Attendance CRM.\n\nNever share any login code you receive." : "This linking link is invalid, expired, or already used. Request a new link from the attendance website.");
    return jsonResponse({ ok: true });
  }
  if (text === "/help" || text === "/help@mbpauthbot") await sendTelegramMessage(chatId, "To link Telegram, sign in and request a linking link. For a new account, open the manager's invitation and click Authenticate with Telegram.");
  return jsonResponse({ ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return jsonResponse({ error: "Server configuration error." }, 500);
  try {
    let body: any;
    try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }
    if (body?.action === "create_link_token") return await createLinkToken(req);
    if (body?.action === "link_status") return await getLinkStatus(req);
    if (body?.action === "create_invite_telegram_challenge") return await createInviteTelegramChallenge(new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(body) }));
    if (body?.action === "verify_invite_telegram_otp") return await verifyInviteTelegramOtp(new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(body) }));
    if (body?.action === "send_invite_email_otp") return await sendInviteEmailOtp(new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(body) }));
    if (body?.action === "verify_invite_email_otp") return await verifyInviteEmailOtp(new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(body) }));
    if (body?.action === "create_invited_account") return await createInvitedAccount(new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(body) }));
    if (!BOT_TOKEN || !WEBHOOK_SECRET) return jsonResponse({ error: "Telegram bot configuration is incomplete." }, 500);
    if (req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) return jsonResponse({ error: "Unauthorized." }, 401);
    return await handleTelegramUpdate(body);
  } catch (error) {
    console.error("Telegram auth handler failed:", error instanceof Error ? error.message : "Unknown error");
    return jsonResponse({ error: "Request processing failed." }, 500);
  }
});
