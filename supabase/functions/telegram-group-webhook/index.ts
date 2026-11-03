// Supabase Edge Function: Telegram group analytics webhook.
// Uses a dedicated analytics bot, not the CRM authentication bot.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const WEBHOOK_SECRET = Deno.env.get("MBP_ANALYTICS_TELEGRAM_WEBHOOK_SECRET");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function db(path: string, method: string, body?: unknown, prefer?: string) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Missing Supabase server configuration");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase REST ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function personName(user: any): string | null {
  if (!user) return null;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || user.username || null;
}

function reactionKey(reaction: any): string {
  if (reaction?.type === "emoji") return "emoji:" + String(reaction.emoji ?? "");
  if (reaction?.type === "custom_emoji") return "custom_emoji:" + String(reaction.custom_emoji_id ?? "");
  if (reaction?.type === "paid") return "paid";
  return String(reaction?.type ?? "unknown");
}

function reactionLabel(reaction: any): string {
  if (reaction?.type === "emoji") return String(reaction.emoji ?? "Reaction");
  if (reaction?.type === "custom_emoji") return "Custom emoji";
  if (reaction?.type === "paid") return "⭐";
  return "Reaction";
}

async function ensureGroup(chat: any) {
  if (!chat?.id) return;
  const title = chat.title || chat.username || String(chat.id);
  await db("telegram_groups?on_conflict=telegram_chat_id", "POST", [{
    telegram_chat_id: chat.id,
    title,
    enabled: true,
  }], "resolution=merge-duplicates,return=minimal");
}

async function upsertMember(chatId: number, user: any) {
  if (!user?.id || user.is_bot) return;
  await db("telegram_group_members?on_conflict=telegram_chat_id,telegram_user_id", "POST", [{
    telegram_chat_id: chatId,
    telegram_user_id: user.id,
    username: user.username ?? null,
    display_name: personName(user),
    is_active: true,
    last_seen_at: new Date().toISOString(),
  }], "resolution=merge-duplicates,return=minimal");
}

async function handleMessage(message: any, update: any) {
  const chat = message?.chat;
  if (!chat?.id) return;
  // Group/supergroup/channel only; ignore private chats.
  if (chat.type === "private") return;

  await ensureGroup(chat);
  const user = message.from;
  await upsertMember(chat.id, user);

  const messageDate = new Date((message.date || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const editedAt = message.edit_date ? new Date(message.edit_date * 1000).toISOString() : null;
  const textValue = typeof message.text === "string"
    ? message.text
    : typeof message.caption === "string" ? message.caption : null;
  const kind = message.text ? "text"
    : message.caption ? "caption"
    : message.photo ? "photo"
    : message.video ? "video"
    : message.document ? "document"
    : message.sticker ? "sticker"
    : message.voice ? "voice"
    : message.animation ? "animation"
    : message.location ? "location"
    : "other";

  await db("telegram_messages?on_conflict=telegram_chat_id,telegram_message_id", "POST", [{
    telegram_chat_id: chat.id,
    telegram_message_id: message.message_id,
    telegram_user_id: user?.id ?? null,
    username: user?.username ?? null,
    display_name: personName(user),
    message_text: textValue,
    message_date: messageDate,
    reply_to_message_id: message.reply_to_message?.message_id ?? null,
    edited_at: editedAt,
    is_deleted: false,
    message_kind: kind,
    raw_update: update,
  }], "resolution=merge-duplicates,return=minimal");

  // Record a response metric when the message replies to another message.
  // This stores the elapsed time from the original message to the reply.
  const replied = message.reply_to_message;
  if (replied?.message_id && replied.date && message.date >= replied.date) {
    const seconds = Math.max(0, message.date - replied.date);
    await db("telegram_response_metrics?on_conflict=telegram_chat_id,question_message_id", "POST", [{
      telegram_chat_id: chat.id,
      question_message_id: replied.message_id,
      question_user_id: replied.from?.id ?? null,
      first_reply_message_id: message.message_id,
      first_reply_user_id: user?.id ?? null,
      response_seconds: seconds,
    }], "resolution=ignore-duplicates,return=minimal");
  }
}

async function handleReaction(reactionUpdate: any, updateId: number) {
  const chat = reactionUpdate?.chat;
  if (!chat?.id || chat.type === "private") return;

  await ensureGroup(chat);
  const user = reactionUpdate.user;
  await upsertMember(chat.id, user);

  const messageId = Number(reactionUpdate.message_id);
  const oldReactions = Array.isArray(reactionUpdate.old_reaction) ? reactionUpdate.old_reaction : [];
  const newReactions = Array.isArray(reactionUpdate.new_reaction) ? reactionUpdate.new_reaction : [];
  const oldByKey = new Map(oldReactions.map((reaction: any) => [reactionKey(reaction), reaction]));
  const newByKey = new Map(newReactions.map((reaction: any) => [reactionKey(reaction), reaction]));
  const eventAt = new Date((reactionUpdate.date || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const actorChat = reactionUpdate.actor_chat ?? null;

  // Cache the current per-user reaction state for display under the message.
  if (user?.id) {
    if (newReactions.length) {
      await db("telegram_message_reactions?on_conflict=telegram_chat_id,telegram_message_id,telegram_user_id", "POST", [{
        telegram_chat_id: chat.id,
        telegram_message_id: messageId,
        telegram_user_id: user.id,
        username: user.username ?? null,
        display_name: personName(user),
        reactions: newReactions,
        reacted_at: eventAt,
        updated_at: new Date().toISOString(),
      }], "resolution=merge-duplicates,return=minimal");
    } else {
      await db(
        `telegram_message_reactions?telegram_chat_id=eq.${chat.id}&telegram_message_id=eq.${messageId}&telegram_user_id=eq.${user.id}`,
        "DELETE",
      );
    }
  }

  // Derive time-to-first-reaction from the original message timestamp.
  let responseSeconds: number | null = null;
  const original = await db(
    `telegram_messages?telegram_chat_id=eq.${chat.id}&telegram_message_id=eq.${messageId}&select=message_date&limit=1`,
    "GET",
  );
  if (Array.isArray(original) && original[0]?.message_date) {
    const elapsed = Math.floor((new Date(eventAt).getTime() - new Date(original[0].message_date).getTime()) / 1000);
    if (Number.isFinite(elapsed) && elapsed >= 0) responseSeconds = elapsed;
  }

  // Persist only additions/removals, with Telegram update_id for retry-safe writes.
  const changes = [
    ...[...newByKey.entries()].filter(([key]) => !oldByKey.has(key)).map(([key, reaction]) => ({ key, reaction, action: "added" })),
    ...[...oldByKey.entries()].filter(([key]) => !newByKey.has(key)).map(([key, reaction]) => ({ key, reaction, action: "removed" })),
  ];
  for (const change of changes) {
    await db("telegram_message_reaction_events?on_conflict=telegram_update_id,telegram_chat_id,telegram_message_id,reaction_key,action", "POST", [{
      telegram_update_id: updateId,
      telegram_chat_id: chat.id,
      telegram_message_id: messageId,
      telegram_user_id: user?.id ?? null,
      username: user?.username ?? null,
      display_name: personName(user),
      actor_chat_id: actorChat?.id ?? null,
      actor_chat_title: actorChat?.title ?? null,
      reaction_key: change.key,
      reaction_label: reactionLabel(change.reaction),
      action: change.action,
      reacted_at: eventAt,
      response_seconds: responseSeconds,
    }], "resolution=ignore-duplicates,return=minimal");
  }
}

async function handleReactionCount(reactionCountUpdate: any) {
  const chat = reactionCountUpdate?.chat;
  if (!chat?.id || chat.type === "private") return;
  await ensureGroup(chat);

  // Telegram sends aggregate snapshots for anonymous reactions.
  await db("telegram_message_reaction_counts?on_conflict=telegram_chat_id,telegram_message_id", "POST", [{
    telegram_chat_id: chat.id,
    telegram_message_id: reactionCountUpdate.message_id,
    reactions: Array.isArray(reactionCountUpdate.reactions) ? reactionCountUpdate.reactions : [],
    updated_at: new Date((reactionCountUpdate.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  }], "resolution=merge-duplicates,return=minimal");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: true, service: "telegram-group-webhook" });
  if (!WEBHOOK_SECRET) return json({ error: "Webhook secret is not configured" }, 500);

  const suppliedSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!suppliedSecret || suppliedSecret !== WEBHOOK_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  try {
    const message = update.message
      ?? update.edited_message
      ?? update.channel_post
      ?? update.edited_channel_post;
    if (message) await handleMessage(message, update);
    if (update.message_reaction) await handleReaction(update.message_reaction, Number(update.update_id ?? 0));
    if (update.message_reaction_count) await handleReactionCount(update.message_reaction_count);
    return json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook processing failed:", error);
    return json({ error: "Webhook processing failed" }, 500);
  }
});
