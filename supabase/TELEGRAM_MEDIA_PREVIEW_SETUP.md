# Telegram media preview proxy

The CRM can preview Telegram attachments on demand without exposing the Telegram bot token to the browser or storing media in the CRM database.

## Deploy

From the repository root, deploy the Edge Function to the same Supabase project as the CRM:

```sh
supabase functions deploy telegram-media-proxy
```

Set/verify these Edge Function secrets in Supabase (Dashboard → Edge Functions → Secrets, or with the CLI):

- `TELEGRAM_BOT_TOKEN`: token for the dedicated CRM analytics bot that received the original group messages. Never use the authentication bot token and never put this token in Vite/frontend environment variables.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: normally injected by Supabase for Edge Functions. Verify they are present; never expose the service-role key to the browser.

The existing analytics webhook must already be deployed and storing each Telegram update in `telegram_messages.raw_update`. The original Telegram message must contain its file metadata. Telegram's `getFile` API is used at preview time; media bytes are streamed through the function and not persisted.

## Access controls

Every request requires a valid signed-in Supabase session and an active CRM profile with role `admin` or `manager`. The requested chat must be enabled, and the message must belong to that chat. Managers additionally need an assignment to a CRM employee linked to a Telegram member in that group. Admins can access enabled groups.

Keep the Supabase RLS policies on `profiles`, `telegram_groups`, `telegram_group_members`, `manager_employee_assignments`, and `telegram_messages` consistent with the CRM's existing access model. The function performs authorization checks server-side; UI visibility is not an authorization boundary.

## Browser behavior

The CRM calls the proxy only after the user clicks **Open**. Images and supported audio/video types render in a modal; other files can be downloaded/opened. Media is held in an in-memory object URL and revoked when the preview closes, the selected group changes, or the component unmounts. Responses use private/no-store cache headers.

## Test checklist

1. Sign in as an active admin, select a group with a recently captured photo, and open it. Confirm the image appears.
2. Test a video, voice/audio message, and a document. Confirm unsupported browser-preview types offer a download.
3. Sign in as a manager assigned to an employee linked to that group and confirm access works.
4. Sign in as a manager without a linked assigned employee in that group; the proxy must return 403.
5. Sign out and try the function directly; it must return 401.
6. Confirm the bot token is not present in frontend build files, browser requests, or browser-visible response headers.
7. Change groups and close the modal; confirm the preview URL is revoked.

## Limits

Telegram's file size/download limits apply. A message without a supported file ID (for example, older rows that lack `raw_update`) cannot be previewed. Bots cannot retrieve messages sent before they were added or before the webhook began recording updates.
