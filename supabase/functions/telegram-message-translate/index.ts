const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DEEPL_AUTH_KEY = Deno.env.get("DEEPL_AUTH_KEY");

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

async function isMfaApproved(accessToken: string): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_auth_mfa_current`, {
      method: "POST",
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: "{}",
    });
    return response.ok && await response.json() === true;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DEEPL_AUTH_KEY) {
    return json({ error: "Translation service is not configured. Ask the CRM Admin to check the DeepL secret." }, 503);
  }

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in required" }, 401);
  const accessToken = auth.slice(7);

  try {
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!userResponse.ok) return json({ error: "Session is invalid or expired" }, 401);
    const user = await userResponse.json();

    const profileResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,active&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!profileResponse.ok) return json({ error: "Could not verify CRM permissions" }, 503);
    const profiles = await profileResponse.json();
    const profile = profiles?.[0];
    const role = String(profile?.role || "").toLowerCase().replaceAll("_", " ");
    const isAdmin = role === "admin";
    const isManager = ["junior", "middle", "senior", "team leader"].includes(role);
    if (!profile?.active || (!isAdmin && !isManager)) return json({ error: "Active Admin or manager account required" }, 403);
    if (isManager && !(await isMfaApproved(accessToken))) {
      return json({ error: "Complete secure login verification first." }, 403);
    }

    const body = await req.json();
    const target = String(body?.target_lang || "").toUpperCase();
    const allowedTargets = new Set(["EN", "BN", "RU"]);
    if (!allowedTargets.has(target)) return json({ error: "Choose English, Bengali or Russian." }, 400);
    if (!Array.isArray(body?.messages) || body.messages.length < 1 || body.messages.length > 150) {
      return json({ error: "Send between 1 and 150 loaded messages per request." }, 400);
    }

    const messages = body.messages.map((item: any) => ({
      id: String(item?.id ?? ""),
      text: String(item?.text ?? "").trim(),
    }));
    if (messages.some((item: any) => !item.id || !item.text || item.text.length > 5000)) {
      return json({ error: "Each message must have an ID and contain no more than 5,000 characters." }, 400);
    }
    const totalCharacters = messages.reduce((sum: number, item: any) => sum + item.text.length, 0);
    if (totalCharacters > 60000) return json({ error: "The loaded messages exceed the 60,000-character batch limit. Translate fewer messages at a time." }, 413);

    const translations: Array<{ id: string; text: string; detected_source_language: string | null }> = [];
    for (let offset = 0; offset < messages.length; offset += 50) {
      const batch = messages.slice(offset, offset + 50);
      const response = await fetch("https://api-free.deepl.com/v2/translate", {
        method: "POST",
        headers: {
          "Authorization": `DeepL-Auth-Key ${DEEPL_AUTH_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: batch.map((item: any) => item.text),
          target_lang: target,
          preserve_formatting: true,
        }),
      });
      if (!response.ok) {
        if (response.status === 456) return json({ error: "DeepL free translation quota has been reached. Try again after your quota resets." }, 429);
        if (response.status === 429) return json({ error: "DeepL is temporarily rate-limiting requests. Wait a moment and try again." }, 429);
        if (response.status === 403) return json({ error: "DeepL rejected the API key or this language is unavailable for the current plan. Check the DeepL key and plan." }, 502);
        console.error("DeepL request failed:", response.status, await response.text());
        return json({ error: "DeepL could not translate this batch. Please try again later." }, 502);
      }
      const result = await response.json();
      const translated = Array.isArray(result?.translations) ? result.translations : [];
      if (translated.length !== batch.length) return json({ error: "DeepL returned an incomplete translation batch." }, 502);
      translated.forEach((item: any, index: number) => {
        translations.push({
          id: batch[index].id,
          text: String(item?.text || ""),
          detected_source_language: item?.detected_source_language || null,
        });
      });
    }

    return json({ translations, target_lang: target, translated_characters: totalCharacters });
  } catch (error) {
    console.error("Telegram message translation failed:", error);
    return json({ error: "Could not translate these messages. Please try again." }, 500);
  }
});
