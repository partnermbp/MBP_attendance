# Fix and validate Telegram media previews

The CRM calls `/functions/v1/telegram-media-proxy` only when a user clicks Preview. A button that returns from Loading without opening a modal means the request failed; this version shows the specific error inline.

## Required Supabase deployment

The proxy is source code in this repository; GitHub Pages does not deploy Supabase Edge Functions. In the Supabase project used by this CRM:

1. Open **Edge Functions** and deploy a function named exactly `telegram-media-proxy` from `supabase/functions/telegram-media-proxy/index.ts`.
2. Configure the function's JWT verification to remain enabled. The CRM sends the current Supabase access token.
3. Under **Edge Function Secrets**, set `TELEGRAM_BOT_TOKEN` to the token for the dedicated analytics bot that receives the group messages. Do not use `@mbpauthbot`'s token, and never put the token in GitHub Pages or frontend environment variables.
4. Verify the platform-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets are available to Edge Functions. Never expose the service-role key in the browser.
5. Redeploy the function after changing secrets or code.

The proxy looks up the requested row in `telegram_messages`, reads the original Telegram update from `raw_update`, extracts a `file_id`, calls Telegram `getFile`, and streams the file with no-store headers. The bot must have received the message through the analytics webhook; Telegram history cannot be backfilled for messages from before the bot was recording them.

## Validate

- In the CRM, open Telegram, select a group, and click Preview on a newly posted photo.
- If it fails, copy the inline error shown under the attachment. It distinguishes missing function configuration, expired session, access denial, missing group/message metadata, and Telegram download errors.
- In Supabase → Edge Functions → `telegram-media-proxy` → Logs, inspect the matching timestamp for server/database/Telegram errors.
- Test video and voice/audio after a photo succeeds.
- Verify the bot token is never visible in browser requests or built frontend files.

## Common errors

- **404 / endpoint not found:** function is not deployed to this Supabase project, or the function name/URL is wrong.
- **503 / not configured:** set `TELEGRAM_BOT_TOKEN` and redeploy.
- **401:** sign in again; confirm JWT verification and project URL/key match the frontend.
- **403:** the profile must be active and have an allowed role, and a manager must be assigned to a CRM employee linked to that Telegram group.
- **Message/raw update/file ID missing:** the webhook did not save the original update or the message has no supported media.
- **Telegram getFile/download failure:** confirm the analytics bot token is valid and the message was received by that bot.

This function deliberately does not store media in Supabase Storage. It streams on demand and uses private no-store caching.
