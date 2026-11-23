import json
from cryptography.fernet import Fernet, InvalidToken
import asyncio
import base64
import binascii
import os
import secrets
import time
from contextlib import asynccontextmanager
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import FastAPI, HTTPException, Request
from playwright.async_api import async_playwright
from starlette.middleware.cors import CORSMiddleware

from appfolio import ORIGIN, prepare

DESK = "https://1stwesternnotices.xyz"
SB = os.getenv("SUPABASE_URL", "https://uowhdiufxssggeihiece.supabase.co")
KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_9hxTRPQ7adRCtGs5eyIvXg_igbiVZvW")
sessions = {}


async def close(ticket):
    session = sessions.pop(ticket, None)
    if session and session.get("context"):
        await session["context"].close()


async def reap():
    while True:
        await asyncio.sleep(15)
        for ticket, s in list(sessions.items()):
            if time.monotonic() > s["expires"] and not s["busy"]:
                await close(ticket)


@asynccontextmanager
async def life(app):
    async with async_playwright() as pw:
        app.state.browser = await pw.chromium.launch()
        task = asyncio.create_task(reap())
        try:
            yield
        finally:
            task.cancel()
            await app.state.browser.close()


app = FastAPI(lifespan=life, docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=[DESK], allow_methods=["POST"], allow_headers=["Authorization", "Content-Type"])


@app.get("/health")
def health():
    return {"ready": True}


async def staff(request):
    if request.headers.get("origin") != DESK:
        raise HTTPException(403)
    headers = {"apikey": KEY, "Authorization": request.headers.get("authorization", "")}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(SB + "/auth/v1/user", headers=headers)
        if r.status_code != 200:
            raise HTTPException(401, "Sign in to Notice Desk.")
        uid = str(UUID(r.json()["id"]))
        r = await client.get(SB + "/rest/v1/notice_desk_staff", headers=headers,
                             params={"select": "user_id", "user_id": "eq." + uid})
        if r.status_code != 200 or not r.json():
            raise HTTPException(403, "Notice Desk staff access required.")
    return uid


async def login_state(page):
    await page.wait_for_selector('#global-search-input, input[autocomplete="one-time-code"], input[name="otp"], #kc-feedback-wrapper, #input-error', timeout=25000)
    if urlsplit(page.url).hostname == "firstw.appfolio.com" and await page.locator("#global-search-input").is_visible():
        return "connected"
    if urlsplit(page.url).hostname == "account.appfolio.com" and await page.locator('input[autocomplete="one-time-code"],input[name="otp"]').first.is_visible():
        return "verification"
    raise ValueError("AppFolio could not complete sign-in.")


async def credentials(request, uid, action, data):
    key = os.getenv("NOTICE_CREDENTIAL_KEY_V1")
    if not key:
        raise HTTPException(503, "AppFolio credential storage is unavailable.")
    cipher = Fernet(key.encode())
    headers = {"apikey": KEY, "Authorization": request.headers["authorization"]}
    url = SB + "/rest/v1/notice_appfolio_credentials"
    async with httpx.AsyncClient(timeout=10) as client:
        if action == "save-credentials":
            email = str(data.get("email", "")).strip()
            password = data.get("password")
            if not email or "@" not in email or not isinstance(password, str) or not password or len(password) > 4096:
                raise HTTPException(400, "Enter your AppFolio email and password.")
            token = cipher.encrypt(json.dumps([uid, email, password]).encode()).decode()
            result = await client.post(url, headers={**headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
                                       json={"user_id": uid, "ciphertext": token})
            if not result.is_success:
                raise HTTPException(503, "Could not save AppFolio settings.")
            return {"email": email}
        result = await client.get(url, headers=headers, params={"user_id": "eq." + uid, "select": "ciphertext"})
        if not result.is_success:
            raise HTTPException(503, "Could not read AppFolio settings.")
        rows = result.json()
        if not rows:
            if action == "credential-status":
                return {"email": ""}
            raise HTTPException(409, "Save your AppFolio login in Settings first.")
        try:
            owner, email, password = json.loads(cipher.decrypt(rows[0]["ciphertext"].encode()))
            if owner != uid:
                raise ValueError()
        except (InvalidToken, ValueError, TypeError):
            raise HTTPException(409, "Please save your AppFolio login again in Settings.") from None
        if action == "credential-status":
            return {"email": email}
        return {"email": email, "password": password}


@app.post("/{action}")
async def action(action: str, request: Request):
    uid = await staff(request)
    if int(request.headers.get("content-length", "0")) > 3000000:
        raise HTTPException(413)
    data = await request.json()
    if action in ("credential-status", "save-credentials"):
        return await credentials(request, uid, action, data)
    if action == "login" and "password" not in data:
        data = await credentials(request, uid, action, data)
    ticket = data.get("ticket", "")
    if action == "login":
        if any(s["user"] == uid for s in sessions.values()) or len(sessions) >= 3:
            raise HTTPException(409, "An email session is already open. Close it or wait five minutes.")
        ticket = secrets.token_urlsafe(32)
        sessions[ticket] = {"user": uid, "expires": time.monotonic()+300, "busy": False, "state": "new"}
    s = sessions.get(ticket)
    if not s or s["user"] != uid or s["expires"] < time.monotonic():
        raise HTTPException(409, "Email session expired. Start again.")
    if s["busy"]:
        raise HTTPException(409, "Another action is in progress.")
    s["busy"] = True
    try:
        if action == "cancel":
            await close(ticket)
            return {}
        if action == "login":
            ctx = await app.state.browser.new_context()
            s["context"] = ctx
            page = await ctx.new_page()
            s["page"] = page
            await page.goto(ORIGIN)
            if urlsplit(page.url).hostname != "account.appfolio.com":
                raise ValueError("AppFolio sign-in page unavailable.")
            await page.locator('input[name="username"]').fill(data["email"])
            await page.locator('input[name="password"]').fill(data["password"])
            await page.locator('input[name="login"]').click()
            s["state"] = await login_state(page)
        elif action == "verify" and s["state"] == "verification":
            page = s["page"]
            await page.locator('input[autocomplete="one-time-code"],input[name="otp"]').first.fill(data["code"])
            await page.locator('input[autocomplete="one-time-code"],input[name="otp"]').first.press("Enter")
            await page.locator("#global-search-input").wait_for()
            s["state"] = await login_state(page)
        elif action == "prepare" and s["state"] == "connected":
            s["export_id"] = str(UUID(data["exportId"]))
            pdf = base64.b64decode(data["pdf"], validate=True)
            if not pdf.startswith(b"%PDF-") or not data["filename"].lower().endswith(".pdf"):
                raise ValueError("Expected one access notice PDF.")
            s["recipient"] = await prepare(s["page"], data["tenant"], data["address"], data["subject"], data["body"], data["filename"], pdf)
            s["state"] = "review"
        elif action == "send" and s["state"] == "review":
            page = s["page"]
            if (await page.locator("#email_recipients").input_value()).strip() != s["recipient"]:
                raise ValueError("AppFolio recipient changed.")
            async with httpx.AsyncClient(timeout=10) as client:
                claim = await client.post(SB + "/rest/v1/notice_access_email_attempts",
                    headers={"apikey": KEY, "Authorization": request.headers["authorization"], "Prefer": "return=minimal"},
                    json={"export_id": s["export_id"]})
            if claim.status_code == 409:
                raise ValueError("A send was already attempted for this export. Check AppFolio email history.")
            if claim.status_code != 201:
                raise ValueError("Could not reserve this send. No email was submitted.")
            s["state"] = "sending"
            await page.locator("#send_button").click(timeout=10000)
            await page.locator("#email_message").wait_for(state="hidden", timeout=15000)
            await close(ticket)
            return {"state": "submitted"}
        else:
            raise ValueError("Start a new email session.")
        return {"ticket": ticket, "state": s["state"], "recipient": s.get("recipient")}
    except Exception as exc:
        ambiguous = s["state"] == "sending"
        await close(ticket)
        message = "Check AppFolio email history before retrying. Submission could not be confirmed." if ambiguous else (str(exc) if type(exc) is ValueError else "AppFolio did not complete this step. Review the tenant profile or sign-in details.")
        raise HTTPException(409, message) from None
    finally:
        s["busy"] = False
