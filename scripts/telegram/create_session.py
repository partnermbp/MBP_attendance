"""Create a Telethon StringSession locally for GitHub Actions.

Run this on your own computer, never in a public/shared runner:
  python -m venv .venv
  source .venv/bin/activate        # Windows: .venv\\Scripts\\activate
  pip install -r scripts/telegram/requirements.txt
  export TELEGRAM_API_ID=...
  export TELEGRAM_API_HASH=...
  python scripts/telegram/create_session.py

Copy the printed session string directly into a private GitHub Actions secret named
TELEGRAM_SESSION_STRING. Do not commit it, paste it into chat, or save it in a file.
"""
import asyncio
import os
from telethon import TelegramClient
from telethon.sessions import StringSession


async def main() -> None:
    api_id = os.environ.get("TELEGRAM_API_ID", "").strip()
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    if not api_id.isdigit() or not api_hash:
        raise SystemExit("Set TELEGRAM_API_ID and TELEGRAM_API_HASH first.")

    client = TelegramClient(StringSession(), int(api_id), api_hash)
    await client.start()
    try:
        me = await client.get_me()
        if me is None:
            raise SystemExit("Telegram did not return an authenticated account.")
        print("\\nAuthenticated account:", me.first_name or "", me.username or "")
        print("\\nCopy the following value into the private GitHub Actions secret TELEGRAM_SESSION_STRING.")
        print("Do not share it or commit it. Anyone with this value may be able to access the account.")
        print("\\n" + client.session.save())
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
