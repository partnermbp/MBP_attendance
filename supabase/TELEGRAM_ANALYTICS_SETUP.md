# Telegram group analytics integration

This is a separate bot from `@mbpauthbot`. Do not reuse the authentication bot token.

## 1. Secrets

In the Supabase Dashboard for the CRM project, open **Edge Functions → Secrets** and set:

- `TELEGRAM_BOT_TOKEN`: token for the new analytics bot from BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: a new random secret of 1–256 characters using only letters, digits, underscores, or hyphens.

The function also uses the existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment values. Never put the bot token or service-role key in frontend environment variables, source code, or a public issue.

## 2. Apply database migration

Review and apply `supabase/migrations/202610270001_manager_assignments_telegram_analytics.sql` in the Supabase SQL Editor. First inspect existing RLS policies on `profiles` and `attendance`: PostgreSQL permissive policies combine with OR, so an existing broad SELECT policy can defeat a restrictive manager policy. Do not use this migration as a substitute for auditing the current policy set.

## 3. Deploy the Edge Function

Deploy `supabase/functions/telegram-group-webhook/index.ts` to the same Supabase project as the CRM. Configure the function so Telegram can call it without a Supabase user JWT; the handler itself validates Telegram's `X-Telegram-Bot-Api-Secret-Token` header. Confirm this function's deployment URL from Supabase.

## 4. Register the webhook

Use Telegram's Bot API `setWebhook` endpoint from a secure terminal (not the browser and not a public repository). Substitute the bot token, exact function URL, and webhook secret:

```bash
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${SUPABASE_FUNCTION_URL}" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message","edited_message","channel_post","edited_channel_post","message_reaction"]'
```

Keep these values in local shell environment variables; do not paste the token into chat. Check Telegram's response says `"ok": true`. Then call `getWebhookInfo` securely to verify the URL and inspect any pending webhook errors.

## 5. Add the bot to a test group

1. Add the dedicated analytics bot to an authorized work group.
2. In BotFather, disable group privacy if the bot must receive ordinary group messages. Grant admin rights only if needed for your selected updates.
3. Send a new message and a reply after the bot joins. Bots cannot backfill group history from before joining.
4. Check `telegram_groups`, `telegram_group_members`, `telegram_messages`, and `telegram_response_metrics` in Supabase.

## 6. Link Telegram users to CRM profiles

A Telegram user is not automatically identifiable as a CRM employee. Link identities only after an admin verifies each Telegram user ID against the correct employee. Manager-scoped analytics depend on those links and on employee assignments.

## Limitations and privacy

The Bot API does not expose general group read receipts, online/last-seen status, or arbitrary historic messages. Reactions require the corresponding update type and Telegram permissions. Inform group participants what data is logged and follow company policy and applicable privacy rules. Avoid collecting unrelated/private group conversations.

## Rollback

To stop ingestion, call Telegram `deleteWebhook` securely or remove the bot from the group. Existing analytics rows are not automatically deleted by removing the webhook; review retention requirements separately.
