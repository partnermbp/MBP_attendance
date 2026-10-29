"""Scheduled Telegram human-account inbox synchronizer.

All credentials are read from environment variables. No secrets are written to disk.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import User


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


class SupabaseRest:
    def __init__(self, url: str, service_key: str) -> None:
        self.base = url.rstrip("/") + "/rest/v1/"
        self.key = service_key

    def request(self, method: str, table: str, *, params: dict[str, str] | None = None,
                body: Any = None, prefer: str | None = None) -> Any:
        query = "?" + urllib.parse.urlencode(params or {}) if params else ""
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {
            "apikey": self.key,
            "Content-Type": "application/json",
        }
        # New sb_secret_ keys are API keys, not JWTs; only legacy service-role
        # JWTs should also be sent as a Bearer token.
        if not self.key.startswith("sb_secret_"):
            headers["Authorization"] = f"Bearer {self.key}"
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(self.base + table + query, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                raw = response.read()
                if not raw:
                    return None
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")[:1000]
            raise RuntimeError(f"Supabase REST request failed ({exc.code}): {details}") from exc

    def select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        result = self.request("GET", table, params=params)
        return result if isinstance(result, list) else []

    def upsert(self, table: str, body: dict[str, Any], conflict: str) -> None:
        self.request("POST", table, params={"on_conflict": conflict}, body=body,
                     prefer="resolution=merge-duplicates,return=minimal")

    def patch(self, table: str, params: dict[str, str], body: dict[str, Any]) -> Any:
        # Return the changed rows so conditional outbox claims can be verified.
        return self.request("PATCH", table, params=params, body=body, prefer="return=representation")


def iso_datetime(value: datetime | None) -> str:
    if value is None:
        value = datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def safe_text(message: Any) -> str | None:
    text = getattr(message, "message", None)
    if text:
        return str(text)[:12000]
    media = getattr(message, "media", None)
    if media is not None:
        return "[Attachment]"
    return None


async def main() -> None:
    api_id = required_env("TELEGRAM_API_ID")
    api_hash = required_env("TELEGRAM_API_HASH")
    session_string = required_env("TELEGRAM_SESSION_STRING")
    supabase_key = (
        os.environ.get("SUPABASE_SECRET_KEY", "").strip()
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    )
    if not supabase_key:
        raise RuntimeError("Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY")
    supabase = SupabaseRest(required_env("SUPABASE_URL"), supabase_key)

    if not api_id.isdigit():
        raise RuntimeError("TELEGRAM_API_ID must be numeric.")

    client = TelegramClient(StringSession(session_string), int(api_id), api_hash,
                            connection_retries=2, request_retries=2, timeout=20)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise RuntimeError("Telegram session is not authorized. Recreate the session locally and update the GitHub secret.")

        me = await client.get_me()
        print(f"Authorized Telegram account: id={me.id if me else 'unknown'}")
        dialogs_seen = 0
        messages_saved = 0
        max_dialogs = int(os.environ.get("TELEGRAM_MAX_DIALOGS", "500"))
        per_dialog_limit = int(os.environ.get("TELEGRAM_MESSAGES_PER_DIALOG", "30"))

        async for dialog in client.iter_dialogs(limit=max_dialogs):
            entity = dialog.entity
            # Sync private human-to-human chats automatically, except Telegram's
            # official service account (777000), which delivers login codes.
            if not isinstance(entity, User) or entity.bot or entity.id == 777000 or (me and entity.id == me.id):
                continue
            chat_id = int(entity.id)
            title = " ".join(part for part in [entity.first_name, entity.last_name] if part) or entity.username or str(chat_id)
            username = entity.username
            current = supabase.select(
                "telegram_inbox_chats",
                {"select": "last_message_id", "chat_id": f"eq.{chat_id}", "limit": "1"},
            )
            last_id = int(current[0]["last_message_id"]) if current and current[0].get("last_message_id") is not None else 0

            # Upsert the chat first because message rows have a foreign key to it.
            supabase.upsert("telegram_inbox_chats", {
                "chat_id": chat_id,
                "title": title[:255],
                "username": username,
                "last_message_id": last_id,
                "read_outbox_max_id": int(getattr(dialog.dialog, "read_outbox_max_id", 0) or 0),
                "last_synced_at": iso_datetime(datetime.now(timezone.utc)),
                "updated_at": iso_datetime(datetime.now(timezone.utc)),
            }, "chat_id")

            # Read a bounded slice of the newest history on every poll, then
            # filter locally by the stored watermark. This is more robust than
            # relying on Telegram's min_id + reverse pagination combination.
            history_limit = max(per_dialog_limit, int(os.environ.get("TELEGRAM_RECENT_HISTORY_LIMIT", "100")))
            history = []
            async for message in client.iter_messages(entity, limit=history_limit):
                history.append(message)
            history.sort(key=lambda item: item.id)

            if last_id:
                recent = [message for message in history if int(message.id) > last_id]
            else:
                recent = history[-per_dialog_limit:]

            newest_id = last_id
            for message in recent:
                body_text = safe_text(message)
                if body_text is None:
                    newest_id = max(newest_id, int(message.id))
                    continue
                sender_id = int(message.sender_id) if message.sender_id is not None else None
                payload = {
                    "chat_id": chat_id,
                    "message_id": int(message.id),
                    "sender_id": sender_id,
                    "outgoing": bool(message.out),
                    "message_text": body_text,
                    "sent_at": iso_datetime(message.date),
                    "reply_to_message_id": int(message.reply_to_msg_id) if message.reply_to_msg_id else None,
                }
                supabase.upsert("telegram_inbox_messages", payload, "chat_id,message_id")
                messages_saved += 1
                newest_id = max(newest_id, int(message.id))

            if recent:
                latest_message = max(recent, key=lambda item: item.id)
                latest_date = iso_datetime(latest_message.date)
            else:
                latest_date = dialog.date.isoformat() if dialog.date else None
            print(
                f"Chat sync: chat_id={chat_id}, stored_last_id={last_id}, "
                f"history_latest_id={int(history[-1].id) if history else 0}, "
                f"new_messages_found={len(recent)}, watermark_after_sync={newest_id}"
            )
            chat_payload = {
                "chat_id": chat_id,
                "title": title[:255],
                "username": username,
                "last_message_id": newest_id,
                "read_outbox_max_id": int(getattr(dialog.dialog, "read_outbox_max_id", 0) or 0),
                "last_message_at": latest_date,
                "last_synced_at": iso_datetime(datetime.now(timezone.utc)),
                "updated_at": iso_datetime(datetime.now(timezone.utc)),
            }
            supabase.upsert("telegram_inbox_chats", chat_payload, "chat_id")
            dialogs_seen += 1

        # Process queued replies. A row is claimed as "sending" before the Telegram call;
        # stale "sending" rows are deliberately not retried automatically to avoid duplicate replies.
        queued = supabase.select(
            "telegram_inbox_outbox",
            {"select": "id,chat_id,message_text", "status": "eq.pending", "order": "created_at.asc", "limit": "20"},
        )
        sent_count = 0
        for item in queued:
            outbox_id = str(item["id"])
            chat_id = int(item["chat_id"])
            text_value = str(item.get("message_text") or "").strip()
            if not text_value:
                supabase.patch("telegram_inbox_outbox", {"id": f"eq.{outbox_id}", "status": "eq.pending"},
                               {"status": "failed", "error_message": "Message text is empty."})
                continue
            claimed = supabase.patch(
                "telegram_inbox_outbox",
                {"id": f"eq.{outbox_id}", "status": "eq.pending"},
                {"status": "sending", "error_message": None},
            )
            if not claimed:
                # Another scheduled/manual run already claimed this row.
                continue
            try:
                sent = await client.send_message(chat_id, text_value)
                supabase.patch("telegram_inbox_outbox", {"id": f"eq.{outbox_id}", "status": "eq.sending"},
                               {"status": "sent", "telegram_message_id": int(sent.id),
                                "sent_at": iso_datetime(sent.date), "error_message": None})
                # Save the outgoing message immediately; the next poll will also reconcile it.
                supabase.upsert("telegram_inbox_messages", {
                    "chat_id": chat_id, "message_id": int(sent.id), "sender_id": int(me.id),
                    "outgoing": True, "message_text": text_value, "sent_at": iso_datetime(sent.date),
                    "reply_to_message_id": None,
                }, "chat_id,message_id")
                sent_count += 1
            except Exception as exc:
                supabase.patch("telegram_inbox_outbox", {"id": f"eq.{outbox_id}", "status": "eq.sending"},
                               {"status": "failed", "error_message": str(exc)[:1000]})
                print(f"Failed to send outbox item {outbox_id}: {exc}", file=sys.stderr)

        print(f"Poll complete: dialogs={dialogs_seen}, messages_upserted={messages_saved}, replies_sent={sent_count}")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Telegram inbox poll failed: {error}", file=sys.stderr)
        raise
