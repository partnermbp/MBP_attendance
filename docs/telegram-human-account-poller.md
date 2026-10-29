# Telegram human-account inbox — temporary GitHub Actions prototype

This prototype uses a **normal Telegram user account** through Telegram's MTProto API
(Telethon), not a Telegram bot. It runs a short GitHub Actions job every 10 minutes,
syncs only explicitly allowlisted private human-to-human chats into Supabase, and sends replies queued in
`telegram_inbox_outbox`.

## Important limitations

- GitHub scheduled workflows are best-effort; start times can be delayed. This is not real-time.
- This first prototype only syncs private user chats. It skips groups, channels, and bots.
- It reads up to 100 dialogs and up to 30 recent messages per dialog per run.
- On the first run, it imports up to 30 recent messages per dialog, not the entire history.
- A reply can be delayed until a later workflow run.
- If a workflow stops after a reply is claimed as `sending`, that row is not retried automatically. Review such rows manually before changing status; this avoids accidental duplicate customer replies.
- Do not use this for sensitive or regulated conversations until security, retention, access, and failure recovery are reviewed.

## 1. Apply the Supabase migration

In Supabase Dashboard → SQL Editor, run
`supabase/migrations/202610290003_telegram_human_account_inbox.sql`.

The migration creates separate `telegram_inbox_*` tables; it does not modify existing
attendance tables or the existing Telegram group analytics tables.

**Access control note:** admins can see all chats. Employees can see chats assigned to
their profile. Managers can see chats assigned to their direct reports. This first
migration lets admins manage chat assignments; the inbox UI to assign chats is a
separate follow-up step. Until the UI exists, assignments can be added by an admin in
the Supabase dashboard after the matching chat row has been synced.

## 2. Get Telegram API credentials

1. Open https://my.telegram.org and sign in with the account you intend to connect.
2. Open **API development tools** and create an application if you do not already have one.
3. Keep the API ID and API hash private. These are not your Telegram password.

## 3. Create the user session on your own computer

Install Python 3.12 or later. In a terminal, from the repository folder:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r scripts/telegram/requirements.txt
export TELEGRAM_API_ID="your_api_id"
export TELEGRAM_API_HASH="your_api_hash"
python scripts/telegram/create_session.py
```

On Windows PowerShell, activate with `.venv\\Scripts\\Activate.ps1` and set the
environment variables with `$env:TELEGRAM_API_ID="..."` and
`$env:TELEGRAM_API_HASH="..."`.

Enter your phone number and Telegram's login code directly in your local terminal.
If Telegram requests the two-step verification password, enter it locally. **Never send
these values to ChatGPT, commit them, or paste them into an issue or pull request.**
The script prints a session string at the end. Treat it like a password.

## 4. Add repository Actions secrets

In GitHub → repository **Settings → Secrets and variables → Actions**, add these
repository secrets:

- `TELEGRAM_API_ID` — numeric API ID
- `TELEGRAM_API_HASH` — API hash
- `TELEGRAM_SESSION_STRING` — the full session string printed locally
- `SUPABASE_URL` — your project URL, such as `https://PROJECT.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — the service-role key from Supabase API settings
- `TELEGRAM_ALLOWED_USER_IDS` — comma-separated numeric Telegram user IDs for customer chats you explicitly approve for syncing (for example, `123456789,987654321`). The worker skips all other private conversations. Use verified numeric IDs, not usernames.

Use **Actions secrets**, not repository variables. Never use the service-role key in
any `VITE_*` variable or frontend code. If you suspect the session string was exposed,
revoke the session from Telegram's **Devices** settings and generate a new one.

## 5. Test the worker

After the workflow file is merged to `main` and all secrets are set:

1. Open GitHub → Actions → **Telegram human-account inbox poll**.
2. Choose **Run workflow**.
3. Inspect the run logs. They should show the connected Telegram account ID and counts,
   never credentials or message bodies.
4. Confirm that allowlisted private chat metadata and recent messages appear in the
   `telegram_inbox_chats` and `telegram_inbox_messages` tables.

The workflow is not enabled successfully until the migration and all six secrets exist.
The browser CRM inbox/reply interface is not part of this first infrastructure step.
