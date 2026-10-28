// Authenticated, on-demand proxy for Telegram attachments.
// The bot token stays on the server. Media is streamed and never persisted.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function rest(path: string, token: string, method = "GET", body?: unknown) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Server configuration missing");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(token ? { "X-User-Authorization": token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Database request failed: ${response.status}`);
  return text ? JSON.parse(text) : null;
}

function getMessage(update: any) {
  return update?.message ?? update?.edited_message ?? update?.channel_post ?? update?.edited_channel_post ?? null;
}

function getMedia(message: any) {
  if (!message) return null;
  const photo = Array.isArray(message.photo) && message.photo.length
    ? message.photo[message.photo.length - 1] : null;
  const candidates = [
    photo && { item: photo, type: "photo", mime: "image/jpeg", name: "telegram-photo.jpg" },
    message.video && { item: message.video, type: "video", mime: message.video.mime_type || "video/mp4", name: message.video.file_name || "telegram-video.mp4" },
    message.animation && { item: message.animation, type: "animation", mime: message.animation.mime_type || "video/mp4", name: message.animation.file_name || "telegram-animation.mp4" },
    message.document && { item: message.document, type: "document", mime: message.document.mime_type || "application/octet-stream", name: message.document.file_name || "telegram-document" },
    message.audio && { item: message.audio, type: "audio", mime: message.audio.mime_type || "audio/mpeg", name: message.audio.file_name || "telegram-audio" },
    message.voice && { item: message.voice, type: "voice", mime: message.voice.mime_type || "audio/ogg", name: "telegram-voice.ogg" },
    message.video_note && { item: message.video_note, type: "video_note", mime: "video/mp4", name: "telegram-video-note.mp4" },
    message.sticker && { item: message.sticker, type: "sticker", mime: message.sticker.is_animated ? "application/x-tgsticker" : "image/webp", name: "telegram-sticker.webp" },
  ].filter(Boolean);
  return (candidates[0] as any) || null;
}

function safeFilename(value: string) {
  return value.replace(/[\\r\\n"\\/\\\\]/g, "_").slice(0, 160) || "telegram-attachment";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !TELEGRAM_BOT_TOKEN) {
    return json({ error: "Media preview service is not configured. Deploy telegram-media-proxy and set the analytics bot token in Supabase Edge Function secrets.", code: "MEDIA_PROXY_NOT_CONFIGURED" }, 503);
  }

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in required" }, 401);
  const accessToken = auth.slice(7);
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!userResponse.ok) return json({ error: "Session is invalid or expired" }, 401);
  const user = await userResponse.json();

  let input: any;
  try { input = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const chatId = Number(input?.chat_id);
  const messageId = Number(input?.message_id);
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId)) {
    return json({ error: "A valid chat_id and message_id are required" }, 400);
  }

  try {
    const people = await rest(`profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,active&limit=1`, accessToken);
    const profile = people?.[0];
    if (!profile?.active || !["admin", "manager", "middle", "senior", "team leader", "team_leader", "telemarketing"].includes(String(profile.role || "").toLowerCase())) {
      return json({ error: "Not authorized" }, 403);
    }

    const groups = await rest(`telegram_groups?telegram_chat_id=eq.${chatId}&enabled=eq.true&select=telegram_chat_id&limit=1`, accessToken);
    if (!groups?.length) return json({ error: "This Telegram group is not registered or is disabled. Check telegram_groups in Supabase.", code: "GROUP_NOT_FOUND" }, 404);

    if (String(profile.role).toLowerCase() !== "admin") {
      // A manager may access a group's attachments only when a linked CRM
      // member in that group is one of their assigned employees.
      const members = await rest(`telegram_group_members?telegram_chat_id=eq.${chatId}&select=profile_id&profile_id=not.is.null`, accessToken);
      const employeeIds = [...new Set((members || []).map((m: any) => m.profile_id).filter(Boolean))];
      if (!employeeIds.length) return json({ error: "This group has no linked employees" }, 403);
      const assignments = await rest(
        `manager_employee_assignments?manager_id=eq.${encodeURIComponent(profile.id)}&employee_id=in.(${employeeIds.map((id: string) => encodeURIComponent(id)).join(",")})&select=employee_id&limit=1`,
        accessToken,
      );
      if (!assignments?.length) return json({ error: "You do not have access to this group's attachments" }, 403);
    }

    const rows = await rest(
      `telegram_messages?telegram_chat_id=eq.${chatId}&telegram_message_id=eq.${messageId}&select=raw_update&limit=1`,
      accessToken,
    );
    if (!rows?.length) return json({ error: "Message was not found in Supabase. New messages can be previewed after the analytics webhook records them.", code: "MESSAGE_NOT_FOUND" }, 404);
    const message = getMessage(rows[0].raw_update);
    if (!message || Number(message.chat?.id) !== chatId || Number(message.message_id) !== messageId) {
      return json({ error: "The saved Telegram row does not contain the original message update. This older message cannot be previewed.", code: "RAW_UPDATE_MISSING" }, 404);
    }
    const media = getMedia(message);
    if (!media?.item?.file_id) return json({ error: "No supported Telegram file_id was found in this message.", code: "FILE_ID_MISSING" }, 404);

    const infoResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(media.item.file_id)}`);
    const info = await infoResponse.json();
    if (!infoResponse.ok || !info?.ok || !info?.result?.file_path) {
      console.error("Telegram getFile failed:", info?.description || infoResponse.status);
      return json({ error: "Telegram could not retrieve this file. Check the analytics bot token, bot access to the group, and the file_id in raw_update.", code: "TELEGRAM_GETFILE_FAILED" }, 502);
    }
    const telegramResponse = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${info.result.file_path}`);
    if (!telegramResponse.ok || !telegramResponse.body) {
      console.error("Telegram file download failed:", telegramResponse.status);
      return json({ error: "Telegram returned the file path but the download failed. Check the bot token and Telegram file availability.", code: "TELEGRAM_DOWNLOAD_FAILED" }, 502);
    }

    const mime = String(media.mime || "application/octet-stream").split(";")[0].slice(0, 120);
    const disposition = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "audio/mpeg", "audio/ogg", "audio/mp4"].includes(mime)
      ? "inline" : "attachment";
    return new Response(telegramResponse.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": mime,
        "Content-Disposition": `${disposition}; filename="${safeFilename(media.name)}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
        ...(info.result.file_size ? { "Content-Length": String(info.result.file_size) } : {}),
      },
    });
  } catch (error) {
    console.error("Telegram media proxy failed:", error);
    return json({ error: "The media proxy encountered a server/database error. Check the Supabase Edge Function logs for telegram-media-proxy.", code: "MEDIA_PROXY_INTERNAL_ERROR" }, 500);
  }
});
