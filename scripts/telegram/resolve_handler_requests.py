"""Resolve only queued Telegram username checks; never sync inbox dialogs or messages."""
from __future__ import annotations
import asyncio, json, os, urllib.parse, urllib.request
from datetime import datetime, timezone
from typing import Any
from telethon import TelegramClient, functions
from telethon.sessions import StringSession
from telethon.tl.types import User

def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value

class SupabaseRest:
    def __init__(self, url: str, key: str) -> None:
        self.base = url.rstrip("/") + "/rest/v1/"
        self.key = key
    def request(self, method: str, table: str, params: dict[str, str], body: Any = None) -> Any:
        url = self.base + table + ("?" + urllib.parse.urlencode(params) if params else "")
        data = None if body is None else json.dumps(body).encode()
        headers = {"apikey": self.key, "Content-Type": "application/json"}
        if not self.key.startswith("sb_secret_"):
            headers["Authorization"] = "Bearer " + self.key
        if method in ("POST", "PATCH"):
            headers["Prefer"] = "return=minimal"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                raw = response.read()
                return json.loads(raw.decode()) if raw else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:500]
            raise RuntimeError(f"Supabase request failed ({exc.code}): {detail}") from exc
    def select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        result = self.request("GET", table, params)
        return result if isinstance(result, list) else []
    def patch(self, table: str, params: dict[str, str], body: dict[str, Any]) -> None:
        self.request("PATCH", table, params, body)

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

async def main() -> None:
    api_id, api_hash, session = required("TELEGRAM_API_ID"), required("TELEGRAM_API_HASH"), required("TELEGRAM_SESSION_STRING")
    key = os.environ.get("SUPABASE_SECRET_KEY", "").strip() or required("SUPABASE_SERVICE_ROLE_KEY")
    db = SupabaseRest(required("SUPABASE_URL"), key)
    if not api_id.isdigit():
        raise RuntimeError("TELEGRAM_API_ID must be numeric.")
    client = TelegramClient(StringSession(session), int(api_id), api_hash, connection_retries=2, request_retries=2, timeout=20)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise RuntimeError("Telegram session is not authorized.")
        me = await client.get_me()
        print(f"Lookup-only Telegram session ready: {me.id if me else 'unknown'}")
        pending = db.select("telegram_inbox_search_requests", {
            "select": "id,requested_by,query,purpose", "status": "eq.pending",
            "purpose": "in.(id_change_old,id_change_new)", "order": "created_at.asc", "limit": "20",
        })
        for item in pending:
            request_id = str(item["id"])
            username = str(item.get("query") or "").strip().lstrip("@")
            try:
                if not username or len(username) > 32:
                    raise ValueError("Invalid Telegram username.")
                result = await client(functions.contacts.SearchRequest(q=username, limit=10))
                matches = [u for u in getattr(result, "users", [])
                    if isinstance(u, User) and not u.bot and (not me or int(u.id) != int(me.id))
                    and str(getattr(u, "username", "") or "").lower() == username.lower()]
                update = {
                    "status": "completed", "result_count": 1 if len(matches) == 1 else 0,
                    "resolved_telegram_user_id": int(matches[0].id) if len(matches) == 1 else None,
                    "resolved_username": str(matches[0].username) if len(matches) == 1 else None,
                    "error_message": None, "completed_at": now_iso(),
                }
                db.patch("telegram_inbox_search_requests", {"id": "eq." + request_id, "status": "eq.pending"}, update)
                print(f"Handler lookup completed for request {request_id}: {'match' if matches else 'no exact match'}")
            except Exception as exc:
                db.patch("telegram_inbox_search_requests", {"id": "eq." + request_id, "status": "eq.pending"},
                    {"status": "failed", "result_count": 0, "error_message": str(exc)[:300], "completed_at": now_iso()})
                print(f"Handler lookup failed for request {request_id}: {type(exc).__name__}")
    finally:
        await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
