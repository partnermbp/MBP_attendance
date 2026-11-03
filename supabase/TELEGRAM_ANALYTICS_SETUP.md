# Telegram group analytics integration

This is a separate bot from `@mbpauthbot`. Do not reuse the authentication bot token.

## 1. Secrets

In the Supabase Dashboard for the CRM project, open **Edge Functions → Secrets** and set:

- `TELEGRAM_BOT_TOKEN`: token for the new analytics bot from BotFather.
- `MBP_ANALYTICS_TELEGRAM_WEBHOOK_SECRET`: a new random secret of 1–256 characters using only letters, digits, underscores, or hyphens.

The function also uses the existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment values. Never put the bot token or service-role key in frontend environment variables, source code, or a public issue.

## 2. Apply database migration

Review and apply `supabase/migrations/202610270001_manager_assignments_telegram_analytics.sql` in the Supabase SQL Editor. First inspect existing RLS policies on `profiles` and `attendance`: PostgreSQL permissive policies combine with OR, so an existing broad SELECT policy can defeat a restrictive manager policy. Do not use this migration as a substitute for auditing the current policy set.

For the participant analytics and reaction features, also apply `supabase/migrations/202611030002_telegram_daily_and_reaction_analytics.sql`. It adds daily participant activity, reply/reaction timing summaries, per-user reaction state, anonymous reaction totals, and reaction event records. The earlier `202611030001_telegram_group_user_activity.sql` migration provides the existing overall activity query.

## 3. Deploy the Edge Function

Deploy `supabase/functions/telegram-group-webhook/index.ts` to the same Supabase project as the CRM. Configure the function so Telegram can call it without a Supabase user JWT; the handler itself validates Telegram's `X-Telegram-Bot-Api-Secret-Token` header. Confirm this function's deployment URL from Supabase.

## 4. Register the webhook

Use Telegram's Bot API `setWebhook` endpoint from a secure terminal (not the browser and not a public repository). Substitute the bot token, exact function URL, and webhook secret:

```bash
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${SUPABASE_FUNCTION_URL}" \
  -d "secret_token=${MBP_ANALYTICS_TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message","edited_message","channel_post","edited_channel_post","message_reaction","message_reaction_count"]'
```

Keep these values in local shell environment variables; do not paste the token into chat. Check Telegram's response says `"ok": true`. Then call `getWebhookInfo` securely to verify the URL and inspect any pending webhook errors.

## 5. Add the bot to a test group

1. Add the dedicated analytics bot to an authorized work group.
2. For message/reply collection, disable group privacy in BotFather if required so the bot can receive ordinary group messages.
3. To collect individual reactions and anonymous reaction totals, make the bot an administrator in the group. Telegram requires administrator status for both reaction update types; do not grant unrelated administrator rights beyond what your group policy permits.
4. Re-register the webhook with both `message_reaction` and `message_reaction_count` in `allowed_updates` (the command above includes both). Existing webhook configurations do not automatically start receiving these update types.
5. Send new messages, replies, and reactions after setup. Bots cannot backfill group history or old reaction events.
6. Check `telegram_groups`, `telegram_group_members`, `telegram_messages`, `telegram_response_metrics`, `telegram_message_reactions`, and `telegram_message_reaction_counts` in Supabase.

## 6. Link Telegram users to CRM profiles

A Telegram user is not automatically identifiable as a CRM employee. Link identities only after an admin verifies each Telegram user ID against the correct employee. Manager-scoped analytics depend on those links and on employee assignments.

## Limitations and privacy

The Bot API does not expose general group read receipts, online/last-seen status, or arbitrary historic messages. Reactions require the corresponding update types, an administrator bot in the group, and webhook registration for both `message_reaction` and `message_reaction_count`. Individual reaction attribution is available only when Telegram sends a user identity. Anonymous reaction counts have no participant identity. Inform group participants what data is logged and follow company policy and applicable privacy rules. Avoid collecting unrelated/private group conversations.

## Rollback

To stop ingestion, call Telegram `deleteWebhook` securely or remove the bot from the group. Existing analytics rows are not automatically deleted by removing the webhook; review retention requirements separately.
