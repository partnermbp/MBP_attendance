import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
async function requestLoginCode(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "Enter a valid work email address." }, 400);
  const genericResponse = () => jsonResponse({ ok: true, message: "If this is an active account with a linked Telegram, a login code will be sent shortly." });
  let profile: Awaited<ReturnType<typeof getActiveLinkedProfile>>;
  try { profile = await getActiveLinkedProfile(email); } catch { return jsonResponse({ error: "Unable to process the request." }, 500); }
  if (!profile) return genericResponse();
  const cutoff = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: recentRequests, error: rateLimitError } = await supabase.from("telegram_login_codes").select("id").eq("email", email).gte("created_at", cutoff).limit(1);
  if (rateLimitError) return jsonResponse({ error: "Unable to process the request." }, 500);
  if (recentRequests?.length) return genericResponse();
  const cooldownHash = await sha256Hex(randomToken());
  const { error: cooldownInsertError } = await supabase.from("telegram_login_codes").insert({ email, code_hash: cooldownHash, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  if (cooldownInsertError) return jsonResponse({ error: "Unable to process the request." }, 500);
  try {
    const { data, error } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data?.properties?.email_otp) return jsonResponse({ error: "Unable to generate a login code. Please try again later." }, 500);
    await sendTelegramMessage(profile.telegramUserId, "Your Mostbet Attendance login code is:\n\n" + data.properties.email_otp + "\n\nEnter this code on the attendance website to sign in. It can only be used once. Never share it with anyone.");
    return genericResponse();
  } catch {
    return jsonResponse({ error: "Unable to deliver a login code. Please wait before requesting another." }, 502);
  }
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

async function verifyInviteTelegramOtp(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }
  const token = typeof body?.invitation_token === "string" ? body.invitation_token : "";
  const challenge = typeof body?.challenge === "string" ? body.challenge : "";
  const otp = typeof body?.otp === "string" ? body.otp.trim() : "";
  if (!/^[a-f0-9]{64}$/i.test(token) || !/^[A-Za-z0-9_-]{40,50}$/.test(challenge) || !/^\d{6}$/.test(otp)) return jsonResponse({ error: "Enter the six-digit code sent by @mbpauthbot." }, 400);
  const tokenHash = await sha256Hex(token);
  const challengeHash = await sha256Hex(challenge);
  const { data: invite, error: inviteError } = await supabase.from("manager_invitations").select("id, corporate_email, redeemed_at, expires_at").eq("token_hash", tokenHash).maybeSingle();
  if (inviteError || !invite || invite.redeemed_at || new Date(invite.expires_at).getTime() <= Date.now()) return jsonResponse({ error: "Invitation is invalid, expired, or already used." }, 400);
  const { data: verification, error } = await supabase.from("manager_invitation_telegram_verifications")
    .select("id, otp_hash, otp_expires_at, attempts, telegram_user_id, verified_at")
    .eq("invitation_id", invite.id).eq("challenge_hash", challengeHash).maybeSingle();
  if (error || !verification) return jsonResponse({ error: "Start @mbpauthbot from this invitation first." }, 400);
  if (verification.verified_at && verification.telegram_user_id) return jsonResponse({ error: "This Telegram verification has already been completed. Continue registration." }, 409);
  if (!verification.otp_hash || !verification.otp_expires_at || new Date(verification.otp_expires_at).getTime() <= Date.now()) return jsonResponse({ error: "The code has expired. Request a new Telegram verification." }, 400);
  if (verification.attempts >= 5) return jsonResponse({ error: "Too many incorrect attempts. Request a new verification." }, 429);
  if (await sha256Hex(otp) !== verification.otp_hash) {
    await supabase.from("manager_invitation_telegram_verifications").update({ attempts: verification.attempts + 1 }).eq("id", verification.id);
    return jsonResponse({ error: "Incorrect code. Check the Telegram message and try again." }, 400);
  }
  if (!verification.telegram_user_id) return jsonResponse({ error: "Telegram has not confirmed this account yet. Open the bot and press Start." }, 400);
  const ticket = randomToken();
  const ticketExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error: updateError } = await supabase.from("manager_invitation_telegram_verifications").update({
    verified_at: new Date().toISOString(), ticket_hash: await sha256Hex(ticket), ticket_expires_at: ticketExpiresAt,
  }).eq("id", verification.id);
  if (updateError) return jsonResponse({ error: "Unable to save Telegram verification." }, 500);
  return jsonResponse({ ok: true, registration_ticket: ticket, message: "Telegram verified. You can now create your account with the invited corporate email." });
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
    const { data: invite } = await supabase.from("manager_invitations").select("corporate_email, redeemed_at, expires_at").eq("id", verification.invitation_id).maybeSingle();
    if (!invite || invite.redeemed_at || new Date(invite.expires_at).getTime() <= Date.now()) {
      await sendTelegramMessage(chatId, "This invitation has expired or has already been used. Contact your manager for a new invitation.");
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
    await sendTelegramMessage(chatId, "Your MBP Attendance registration verification code is:\n\n" + otp + "\n\nEnter this six-digit code on the invitation page. It expires in 10 minutes and can only be used for this invitation. Never share it with anyone.");
    return jsonResponse({ ok: true });
    }
  }

  if (text === "/start" || text === "/start@mbpauthbot") {
    await sendTelegramMessage(chatId, "Welcome to Mostbet Attendance.\n\nOpen the invitation link provided by your manager and click “Authenticate with @mbpauthbot” to verify Telegram before registering.\n\nNever share login codes or passwords with anyone.");
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
    await sendTelegramMessage(chatId, data === true ? "Your Telegram account has been linked successfully to Mostbet Attendance.\n\nNever share any login code you receive." : "This linking link is invalid, expired, or already used. Request a new link from the attendance website.");
    return jsonResponse({ ok: true });
  }
  if (text === "/help" || text === "/help@mbpauthbot") await sendTelegramMessage(chatId, "To link Telegram, sign in and request a linking link. For a new account, open the manager's invitation and click Authenticate with @mbpauthbot.");
  return jsonResponse({ ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !BOT_TOKEN || !WEBHOOK_SECRET) return jsonResponse({ error: "Server configuration error." }, 500);
  try {
    let body: any;
    try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }
    if (body?.action === "request_login_code") return await requestLoginCode(new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(body) }));
    if (body?.action === "create_link_token") return await createLinkToken(req);
    if (body?.action === "create_invite_telegram_challenge") return await createInviteTelegramChallenge(new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(body) }));
    if (body?.action === "verify_invite_telegram_otp") return await verifyInviteTelegramOtp(new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(body) }));
    if (req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) return jsonResponse({ error: "Unauthorized." }, 401);
    return await handleTelegramUpdate(body);
  } catch (error) {
    console.error("Telegram auth handler failed:", error instanceof Error ? error.message : "Unknown error");
    return jsonResponse({ error: "Request processing failed." }, 500);
  }
});
