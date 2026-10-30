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
from telethon.extensions import html as telethon_html
from telethon.helpers import add_surrogate, del_surrogate, strip_text
from telethon.tl.types import MessageEntitySpoiler, User, Chat, Channel
from telethon import utils
from telethon.tl import functions


class TelegramHTMLParser(telethon_html.HTMLToTelegramParser):
    """Telethon v1 HTML parser with explicit support for Telegram spoiler entities."""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tg-spoiler":
            self._open_tags.appendleft(tag)
            self._open_tags_meta.appendleft(None)
            if tag not in self._building_entities:
                self._building_entities[tag] = MessageEntitySpoiler(
                    offset=len(self.text), length=0
                )
            return
        super().handle_starttag(tag, attrs)


class TelegramHTML:
    """HTML parse mode that preserves spoilers as native Telegram entities."""

    @staticmethod
    def parse(value: str) -> tuple[str, list[Any]]:
        if not value:
            return value, []
        parser = TelegramHTMLParser()
        parser.feed(add_surrogate(value))
        clean_text = strip_text(parser.text, parser.entities)
        parser.entities.reverse()
        parser.entities.sort(key=lambda entity: entity.offset)
        return del_surrogate(clean_text), parser.entities

    @staticmethod
    def unparse(value: str, entities: Any) -> str:
        return telethon_html.unparse(value, entities)



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

    def storage_url(self, object_path: str) -> str:
        encoded_path = urllib.parse.quote(object_path, safe="/")
        return self.base.split("/rest/v1/")[0] + "/storage/v1/object/telegram-inbox-media/" + encoded_path

    def storage_headers(self, content_type: str | None = None) -> dict[str, str]:
        headers = {"apikey": self.key}
        if not self.key.startswith("sb_secret_"):
            headers["Authorization"] = f"Bearer {self.key}"
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def storage_upload(self, object_path: str, data: bytes, content_type: str) -> None:
        headers = self.storage_headers(content_type)
        headers["x-upsert"] = "true"
        req = urllib.request.Request(self.storage_url(object_path), data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=60) as response:
            response.read()

    def storage_download(self, object_path: str) -> bytes:
        req = urllib.request.Request(self.storage_url(object_path), headers=self.storage_headers(), method="GET")
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.read()

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
        history_limit = max(per_dialog_limit, int(os.environ.get("TELEGRAM_RECENT_HISTORY_LIMIT", "100")))

        # Load the current watermarks in one database request rather than one
        # request per Telegram dialog. The worker can then ask Telegram only
        # for messages newer than each chat's watermark.
        existing_rows = supabase.select(
            "telegram_inbox_chats",
            {"select": "chat_id,last_message_id", "limit": "10000"},
        )
        watermarks = {
            int(row["chat_id"]): int(row.get("last_message_id") or 0)
            for row in existing_rows
            if row.get("chat_id") is not None
        }
        # Keep the CRM employee attribution when the same Telegram messages
        # are fetched again during later history synchronization.
        sent_outbox_rows = supabase.select(
            "telegram_inbox_outbox",
            {"select": "chat_id,telegram_message_id,requested_by", "status": "eq.sent",
             "telegram_message_id": "not.is.null", "limit": "10000"},
        )
        crm_sender_by_message = {
            (int(row["chat_id"]), int(row["telegram_message_id"])): str(row["requested_by"])
            for row in sent_outbox_rows
            if row.get("chat_id") is not None and row.get("telegram_message_id") is not None
            and row.get("requested_by")
        }
        # Avoid one sequential Supabase REST write per quiet chat. Queue chat
        # metadata updates and persist them together after message inserts.
        # New chats still get an initial row immediately to satisfy the message FK.
        chat_updates: list[dict[str, Any]] = []
        # IDs seen in real Telegram dialogs during this run. Saved contacts
        # must never overwrite a real conversation row with is_contact_only=True.
        dialog_chat_ids: set[int] = set()

        async for dialog in client.iter_dialogs(limit=max_dialogs):
            entity = dialog.entity
            # Sync private human-to-human chats and groups from the linked account.
            # Broadcast channels and Telegram service/bot accounts are excluded.
            is_private = isinstance(entity, User)
            is_group = bool(getattr(dialog, "is_group", False)) and isinstance(entity, (Chat, Channel))
            if is_private:
                if entity.bot or entity.id == 777000 or (me and entity.id == me.id):
                    continue
                chat_id = int(entity.id)
                title = " ".join(part for part in [entity.first_name, entity.last_name] if part) or entity.username or str(chat_id)
                username = entity.username
                chat_type = "private"
            elif is_group:
                if isinstance(entity, Channel) and bool(getattr(entity, "broadcast", False)):
                    continue
                chat_id = int(utils.get_peer_id(entity))
                title = str(getattr(entity, "title", None) or dialog.name or chat_id)
                username = getattr(entity, "username", None)
                chat_type = "group"
            else:
                continue
            dialog_chat_ids.add(chat_id)
            last_id = watermarks.get(chat_id, 0)
            now = iso_datetime(datetime.now(timezone.utc))



            # A new chat row must exist before inserting messages because of
            # the foreign key. Existing chats are updated only once, at the end.
            if chat_id not in watermarks:
                supabase.upsert("telegram_inbox_chats", {
                    "chat_id": chat_id,
                    "title": title[:255],
                    "username": username,
                    "phone_number": getattr(entity, "phone", None),
                    "chat_type": chat_type,
                    "is_contact_only": False,
                    "last_message_id": 0,
                    "read_outbox_max_id": int(getattr(dialog.dialog, "read_outbox_max_id", 0) or 0),
                    "last_synced_at": now,
                    "updated_at": now,
                }, "chat_id")

            if is_group:
                try:
                    supabase.request("PATCH", "telegram_inbox_chat_members",
                        params={"chat_id": f"eq.{chat_id}"},
                        body={"is_active": False, "last_seen_at": now})
                    participant_rows = []
                    async for participant in client.iter_participants(entity, limit=1000):
                        display_name = " ".join(part for part in [
                            getattr(participant, "first_name", None),
                            getattr(participant, "last_name", None)
                        ] if part).strip() or getattr(participant, "title", None) or getattr(participant, "username", None) or str(participant.id)
                        participant_rows.append({
                            "chat_id": chat_id,
                            "telegram_user_id": int(participant.id),
                            "username": getattr(participant, "username", None),
                            "display_name": display_name[:255],
                            "is_bot": bool(getattr(participant, "bot", False)),
                            "is_self": bool(me and int(participant.id) == int(me.id)),
                            "is_active": True,
                            "last_seen_at": now
                        })
                    if participant_rows:
                        supabase.upsert("telegram_inbox_chat_members", participant_rows,
                                        "chat_id,telegram_user_id")
                    print(f"Group participants synced: chat_id={chat_id}, members={len(participant_rows)}")
                except Exception as exc:
                    print(f"Could not sync participants chat={chat_id}: {exc}", file=sys.stderr)

            # Most dialogs have no new messages between syncs. Telegram's
            # dialog summary already includes the newest message, so skip the
            # per-chat history request entirely when its ID has not advanced.
            dialog_latest = getattr(dialog, "message", None)
            dialog_latest_id = int(dialog_latest.id) if dialog_latest is not None else 0
            if last_id and dialog_latest_id <= last_id:
                chat_updates.append({
                    "chat_id": chat_id, "title": title[:255], "username": username,
                    "phone_number": getattr(entity, "phone", None), "chat_type": chat_type,
                    "is_contact_only": False, "last_message_id": last_id,
                    "read_outbox_max_id": int(getattr(dialog.dialog, "read_outbox_max_id", 0) or 0),
                    "last_message_at": iso_datetime(dialog_latest.date) if dialog_latest else (dialog.date.isoformat() if dialog.date else None),
                    "last_synced_at": now, "updated_at": now,
                })
                dialogs_seen += 1
                continue

            # Incremental fetch for established chats avoids downloading the
            # same history on every sync. Keep initial backfill bounded.
            if last_id:
                history = []
                async for message in client.iter_messages(entity, limit=history_limit, min_id=last_id):
                    if int(message.id) > last_id:
                        history.append(message)
            else:
                history = []
                async for message in client.iter_messages(entity, limit=per_dialog_limit):
                    history.append(message)
            history.sort(key=lambda item: item.id)
            recent = history if last_id else history[-per_dialog_limit:]

            newest_id = last_id
            message_payloads = []
            for message in recent:
                body_text = safe_text(message)
                if body_text is None:
                    newest_id = max(newest_id, int(message.id))
                    continue
                sender_id = int(message.sender_id) if message.sender_id is not None else None
                media_path = None
                media_name = None
                media_mime_type = None
                media_size = None
                if getattr(message, "media", None) is not None:
                    media_name = getattr(getattr(message, "file", None), "name", None) or f"telegram-{message.id}"
                    media_mime_type = getattr(getattr(message, "file", None), "mime_type", None) or "application/octet-stream"
                    media_size = getattr(getattr(message, "file", None), "size", None)
                    if media_size is None or int(media_size) <= 20 * 1024 * 1024:
                        try:
                            downloaded = await client.download_media(message, file=bytes)
                            if isinstance(downloaded, bytes) and downloaded:
                                safe_name = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in media_name)[-120:]
                                media_path = f"{chat_id}/inbox/{message.id}-{safe_name or 'attachment'}"
                                supabase.storage_upload(media_path, downloaded, media_mime_type)
                                media_size = len(downloaded)
                        except Exception as exc:
                            print(f"Could not store media chat={chat_id} message={message.id}: {exc}", file=sys.stderr)
                message_payloads.append({
                    "chat_id": chat_id,
                    "message_id": int(message.id),
                    "sender_id": sender_id,
                    "sent_by_profile_id": crm_sender_by_message.get((chat_id, int(message.id))) if message.out else None,
                    "outgoing": bool(message.out),
                    "message_text": body_text,
                    "sent_at": iso_datetime(message.date),
                    "reply_to_message_id": int(message.reply_to_msg_id) if message.reply_to_msg_id else None,
                    "media_path": media_path,
                    "media_name": media_name,
                    "media_mime_type": media_mime_type,
                    "media_size": media_size,
                })
                newest_id = max(newest_id, int(message.id))

            # One bulk REST upsert per chat instead of one network request per
            # message. Only advance the watermark after the bulk write succeeds.
            if message_payloads:
                supabase.upsert("telegram_inbox_messages", message_payloads, "chat_id,message_id")
                messages_saved += len(message_payloads)

            latest_message = max(recent, key=lambda item: item.id) if recent else None
            latest_date = iso_datetime(latest_message.date) if latest_message else (dialog.date.isoformat() if dialog.date else None)
            print(
                f"Chat sync: chat_id={chat_id}, stored_last_id={last_id}, "
                f"new_messages_found={len(recent)}, watermark_after_sync={newest_id}"
            )
            synced_at = iso_datetime(datetime.now(timezone.utc))
            chat_updates.append({
                "chat_id": chat_id, "title": title[:255], "username": username,
                "phone_number": getattr(entity, "phone", None), "chat_type": chat_type,
                "is_contact_only": False, "last_message_id": newest_id,
                "read_outbox_max_id": int(getattr(dialog.dialog, "read_outbox_max_id", 0) or 0),
                "last_message_at": latest_date, "last_synced_at": synced_at,
                "updated_at": synced_at,
            })
            watermarks[chat_id] = newest_id
            dialogs_seen += 1


        # Resolve explicitly requested public Telegram usernames through Telegram itself.
        # Results are indexed as contact-only rows: searchable and usable for a new
        # conversation, but never displayed in the ordinary inbox list.
        search_requests = supabase.select(
            "telegram_inbox_search_requests",
            {"select": "id,requested_by,query", "status": "eq.pending", "order": "created_at.asc", "limit": "10"},
        )
        for search_request in search_requests:
            request_id = str(search_request["id"])
            requested_username = str(search_request.get("query") or "").strip().lstrip("@")
            try:
                if not requested_username or len(requested_username) > 32:
                    raise ValueError("Enter a valid Telegram username.")
                search_result = await client(functions.contacts.SearchRequest(q=requested_username, limit=10))
                found_users = []
                for found_user in getattr(search_result, "users", []):
                    if not isinstance(found_user, User) or found_user.bot or (me and int(found_user.id) == int(me.id)):
                        continue
                    found_users.append(found_user)
                if not found_users:
                    supabase.patch("telegram_inbox_search_requests",
                        {"id": f"eq.{request_id}", "status": "eq.pending"},
                        {"status": "completed", "result_count": 0, "error_message": None, "completed_at": iso_datetime(datetime.now(timezone.utc))})
                    continue
                found_users.sort(key=lambda item: (str(getattr(item, "username", "") or "").lower() != requested_username.lower(),
                                                   str(getattr(item, "username", "") or "").lower()))
                resolved_rows = []
                for found_user in found_users:
                    display_name = " ".join(part for part in [
                        getattr(found_user, "first_name", None), getattr(found_user, "last_name", None)
                    ] if part).strip() or getattr(found_user, "username", None) or str(found_user.id)
                    resolved_rows.append({
                        "chat_id": int(found_user.id), "title": display_name[:255],
                        "username": getattr(found_user, "username", None),
                        "phone_number": getattr(found_user, "phone", None),
                        "chat_type": "private", "is_contact_only": int(found_user.id) not in dialog_chat_ids,
                        "last_message_id": watermarks.get(int(found_user.id), 0),
                        "read_outbox_max_id": 0, "last_synced_at": iso_datetime(datetime.now(timezone.utc)),
                        "updated_at": iso_datetime(datetime.now(timezone.utc)),
                    })
                supabase.upsert("telegram_inbox_chats", resolved_rows, "chat_id")
                supabase.patch("telegram_inbox_search_requests",
                    {"id": f"eq.{request_id}", "status": "eq.pending"},
                    {"status": "completed", "result_count": len(resolved_rows), "error_message": None, "completed_at": iso_datetime(datetime.now(timezone.utc))})
                print(f"Telegram username search resolved: query={requested_username}, matches={len(resolved_rows)}")
            except Exception as exc:
                supabase.patch("telegram_inbox_search_requests",
                    {"id": f"eq.{request_id}", "status": "eq.pending"},
                    {"status": "failed", "result_count": 0, "error_message": str(exc)[:500], "completed_at": iso_datetime(datetime.now(timezone.utc))})
                print(f"Telegram username search failed for {requested_username}: {exc}", file=sys.stderr)

        # Index Telegram contacts for search/new-chat. Keep these rows hidden from
        # the normal inbox list until a real dialog exists.
        contact_rows = []
        contacts_result = await client(functions.contacts.GetContactsRequest(hash=0))
        for contact in contacts_result.users:
            contact_id = int(contact.id)
            # Never index a saved contact as a contact-only row if that person
            # already has a real dialog. This prevents overwriting conversation
            # metadata/history and keeps the inbox strictly dialog-based.
            if contact_id in dialog_chat_ids:
                continue
            if getattr(contact, "bot", False) or contact_id == 777000 or (me and contact_id == int(me.id)):
                continue
            contact_name = " ".join(part for part in [getattr(contact, "first_name", None), getattr(contact, "last_name", None)] if part).strip() or getattr(contact, "username", None) or str(contact.id)
            contact_rows.append({
                "chat_id": int(contact.id), "title": contact_name[:255],
                "username": getattr(contact, "username", None),
                "phone_number": getattr(contact, "phone", None),
                "chat_type": "private", "is_contact_only": True,
                "last_message_id": 0, "read_outbox_max_id": 0,
                "last_message_at": None, "last_synced_at": iso_datetime(datetime.now(timezone.utc)),
                "updated_at": iso_datetime(datetime.now(timezone.utc)),
            })
        if contact_rows:
            supabase.upsert("telegram_inbox_chats", contact_rows, "chat_id")
        print(f"Telegram contacts indexed: {len(contact_rows)}")

        if chat_updates:
            supabase.upsert("telegram_inbox_chats", chat_updates, "chat_id")
            print(f"Chat metadata batch saved: rows={len(chat_updates)}")

        # Process queued replies. A row is claimed as "sending" before the Telegram call;
        # stale "sending" rows are deliberately not retried automatically to avoid duplicate replies.
        queued = supabase.select(
            "telegram_inbox_outbox",
            {"select": "id,chat_id,requested_by,message_text,attachment_path,attachment_name,attachment_mime_type,attachment_size", "status": "eq.pending", "order": "created_at.asc", "limit": "20"},
        )
        sent_count = 0
        for item in queued:
            outbox_id = str(item["id"])
            chat_id = int(item["chat_id"])
            text_value = str(item.get("message_text") or "").strip()
            attachment_path = item.get("attachment_path")
            attachment_name = item.get("attachment_name") or "attachment"
            attachment_mime_type = item.get("attachment_mime_type") or "application/octet-stream"
            if not text_value and not attachment_path:
                supabase.patch("telegram_inbox_outbox", {"id": f"eq.{outbox_id}", "status": "eq.pending"},
                               {"status": "failed", "error_message": "Message text and attachment are empty."})
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
                if attachment_path:
                    file_bytes = supabase.storage_download(str(attachment_path))
                    sent = await client.send_file(
                        chat_id, file_bytes, file=attachment_name,
                        caption=text_value if text_value and text_value != attachment_name else None,
                        parse_mode=TelegramHTML,
                    )
                else:
                    sent = await client.send_message(chat_id, text_value, parse_mode=TelegramHTML)
                supabase.patch("telegram_inbox_outbox", {"id": f"eq.{outbox_id}", "status": "eq.sending"},
                               {"status": "sent", "telegram_message_id": int(sent.id),
                                "sent_at": iso_datetime(sent.date), "error_message": None})
                supabase.upsert("telegram_inbox_messages", {
                    "chat_id": chat_id, "message_id": int(sent.id), "sender_id": int(me.id),
                    "sent_by_profile_id": item.get("requested_by"),
                    "outgoing": True, "message_text": text_value, "sent_at": iso_datetime(sent.date),
                    "reply_to_message_id": None,
                    "media_path": attachment_path,
                    "media_name": attachment_name if attachment_path else None,
                    "media_mime_type": attachment_mime_type if attachment_path else None,
                    "media_size": int(item.get("attachment_size") or 0) or None,
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
