Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const setupSecret = Deno.env.get("MBP_WEBHOOK_SETUP_SECRET");
  const suppliedSecret = req.headers.get("x-setup-secret");

  if (!setupSecret || suppliedSecret !== setupSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const botToken = Deno.env.get("MBP_ANALYTICS_TELEGRAM_BOT_TOKEN");
    const webhookSecret = Deno.env.get("MBP_ANALYTICS_TELEGRAM_WEBHOOK_SECRET");

    if (!botToken || !webhookSecret) {
      return new Response("Required secrets are missing", { status: 500 });
    }

    const body = await req.json();
    const webhookUrl = body.webhook_url;

    if (
      typeof webhookUrl !== "string" ||
      !webhookUrl.startsWith("https://") ||
      !webhookUrl.includes("/functions/v1/telegram-group-webhook")
    ) {
      return new Response("Invalid webhook URL", { status: 400 });
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: webhookSecret,
          allowed_updates: [
            "message",
            "edited_message",
            "channel_post",
            "edited_channel_post",
            "message_reaction",
            "message_reaction_count",
            "my_chat_member"
          ]
        })
      }
    );

    const result = await telegramResponse.json();
    return Response.json({
      ok: result.ok,
      description: result.description ?? "Webhook registration completed"
    }, { status: result.ok ? 200 : 502 });
  } catch {
    return new Response("Request failed; check the function configuration", {
      status: 500
    });
  }
});
