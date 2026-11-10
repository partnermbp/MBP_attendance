const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DEEPL_AUTH_KEY = Deno.env.get("DEEPL_AUTH_KEY");
const SARVAM_API_KEY = Deno.env.get("SARVAM_API_KEY");

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

function splitText(text: string, maxLength = 1000): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf(" ", maxLength);
    const newline = remaining.lastIndexOf("\n", maxLength);
    const sentence = Math.max(remaining.lastIndexOf(". ", maxLength), remaining.lastIndexOf("! ", maxLength), remaining.lastIndexOf("? ", maxLength));
    cut = Math.max(cut, newline, sentence > 0 ? sentence + 1 : -1);
    if (cut < Math.floor(maxLength * 0.55)) cut = maxLength;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

async function sarvamTranslate(input: string, source: string, target: string): Promise<{ text: string; detected: string[] }> {
  const chunks = splitText(input);
  const translated: string[] = [];
  const detected = new Set<string>();
  for (const chunk of chunks) {
    const response = await fetch("https://api.sarvam.ai/translate", {
      method: "POST",
      headers: { "api-subscription-key": SARVAM_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: chunk,
        source_language_code: source,
        target_language_code: target,
        model: "mayura:v1",
        mode: "modern-colloquial",
        output_script: "fully-native",
        numerals_format: "international",
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error("Sarvam request failed:", response.status, detail.slice(0, 500));
      if (response.status === 429) throw new Error("Sarvam is temporarily rate-limiting requests. Wait a moment and try again.");
      if (response.status === 403) throw new Error("Sarvam rejected the API key. Check the SARVAM_API_KEY secret.");
      if (response.status === 422) throw new Error("Sarvam could not process one of the messages. Try translating fewer messages or check the selected source language.");
      throw new Error("Sarvam could not translate this batch. Please try again later.");
    }
    const result = await response.json();
    if (typeof result?.translated_text !== "string") throw new Error("Sarvam returned an invalid translation result.");
    translated.push(result.translated_text);
    if (result.source_language_code) detected.add(String(result.source_language_code));
  }
  return { text: translated.join("\n"), detected: [...detected] };
}

async function deeplTranslateToRussian(input: string): Promise<string> {
  if (!DEEPL_AUTH_KEY) throw new Error("DeepL is not configured for Russian translation. Ask the CRM Admin to check the DEEPL_AUTH_KEY secret.");
  const response = await fetch("https://api-free.deepl.com/v2/translate", {
    method: "POST",
    headers: { "Authorization": `DeepL-Auth-Key ${DEEPL_AUTH_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: [input], source_lang: "EN", target_lang: "RU", preserve_formatting: true }),
  });
  if (!response.ok) {
    if (response.status === 456) throw new Error("DeepL free translation quota has been reached.");
    if (response.status === 429) throw new Error("DeepL is temporarily rate-limiting requests. Wait a moment and try again.");
    console.error("DeepL request failed:", response.status, (await response.text()).slice(0, 500));
    throw new Error("DeepL could not complete the Russian translation.");
  }
  const result = await response.json();
  const text = result?.translations?.[0]?.text;
  if (typeof text !== "string") throw new Error("DeepL returned an invalid Russian translation.");
  return text;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SARVAM_API_KEY) {
    return json({ error: "Translation service is not configured. Ask the CRM Admin to check the SARVAM_API_KEY secret." }, 503);
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
    const source = String(body?.source_lang || "auto").toLowerCase();
    if (!new Set(["EN-US", "BN", "RU"]).has(target)) return json({ error: "Choose English, Bengali or Russian." }, 400);
    if (!new Set(["auto", "hi-in", "bn-in", "en-in"]).has(source)) return json({ error: "Choose automatic detection, Hindi, Bengali or English as the source." }, 400);
    if (!Array.isArray(body?.messages) || body.messages.length < 1 || body.messages.length > 150) {
      return json({ error: "Send between 1 and 150 loaded messages per request." }, 400);
    }

    const messages = body.messages.map((item: any) => ({ id: String(item?.id ?? ""), text: String(item?.text ?? "").trim() }));
    if (messages.some((item: any) => !item.id || !item.text || item.text.length > 5000)) {
      return json({ error: "Each message must have an ID and contain no more than 5,000 characters." }, 400);
    }
    const totalCharacters = messages.reduce((sum: number, item: any) => sum + item.text.length, 0);
    if (totalCharacters > 60000) return json({ error: "The loaded messages exceed the 60,000-character batch limit. Translate fewer messages at a time." }, 413);

    const translations: Array<{ id: string; text: string; detected_source_language: string | null }> = [];
    for (let offset = 0; offset < messages.length; offset += 4) {
      const batch = messages.slice(offset, offset + 4);
      const results = await Promise.all(batch.map(async (message: any) => {
        const firstTarget = target === "RU" ? "en-IN" : target === "BN" ? "bn-IN" : "en-IN";
        const sarvam = await sarvamTranslate(message.text, source, firstTarget);
        const finalText = target === "RU" ? await deeplTranslateToRussian(sarvam.text) : sarvam.text;
        return { id: message.id, text: finalText, detected_source_language: sarvam.detected.join(", ") || null };
      }));
      translations.push(...results);
    }

    return json({ translations, target_lang: target, source_lang: source, translated_characters: totalCharacters, provider: target === "RU" ? "Sarvam + DeepL" : "Sarvam Mayura" });
  } catch (error) {
    console.error("Telegram message translation failed:", error);
    return json({ error: error instanceof Error ? error.message : "Could not translate these messages. Please try again." }, 500);
  }
});
