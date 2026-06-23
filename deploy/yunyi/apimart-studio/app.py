"""
apimart 生图工作台
- 复用 LibreChat 同一套账号（连同一个 MongoDB 校验邮箱+bcrypt 密码）
- 直接调 apimart 异步出图，下载落盘（历史持久）
- 按账号存历史（MongoDB studio_history 集合）
"""
import os
import re
import time
import uuid
import asyncio

import bcrypt
import httpx
import jwt
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from pymongo import MongoClient

APIMART_KEY = os.environ["APIMART_KEY"]
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongodb:27017/LibreChat")
STUDIO_SECRET = os.environ.get("STUDIO_SECRET", "change-me-secret")
COOKIE_DOMAIN = os.environ.get("COOKIE_DOMAIN") or None  # 如 .essjoy.com，用于跨子域共享登录
LIBRECHAT_INTERNAL = os.environ.get("LIBRECHAT_INTERNAL", "http://api:3080")
SECURE_COOKIE = bool(COOKIE_DOMAIN)  # 有父域(走HTTPS)时用 Secure
BROWSER_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
UPSTREAM = "https://api.apimart.ai/v1"
IMG_DIR = "/data/img"
os.makedirs(IMG_DIR, exist_ok=True)

mongo = MongoClient(MONGO_URI)
db = mongo.get_database("LibreChat")
users = db.get_collection("users")
history = db.get_collection("studio_history")

app = FastAPI()

MODELS = [
    {"id": "grok-imagine-1.5-apimart", "name": "Grok Imagine", "tag": "快",
     "ratios": ["1:1", "16:9", "9:16", "3:2", "2:3"], "res": [], "img2img": True,
     "edit_model": "grok-imagine-1.5-edit-apimart"},
    {"id": "gemini-3.1-flash-image-preview", "name": "Gemini 3.1 Flash", "tag": "快·支持参考图",
     "ratios": ["auto", "1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4"],
     "res": ["0.5k", "1k", "2k", "4k"], "img2img": True},
    {"id": "gpt-image-2", "name": "GPT-Image-2", "tag": "质量高·较慢",
     "ratios": ["auto", "1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4"],
     "res": ["1k", "2k", "4k"], "img2img": True},
]
MODEL_MAP = {m["id"]: m for m in MODELS}
JOBS = {}  # job_id -> {status, result/error, started, elapsed}


def make_token(uid, email):
    return jwt.encode({"uid": uid, "email": email, "exp": int(time.time()) + 7 * 86400},
                      STUDIO_SECRET, algorithm="HS256")


def current_user(req: Request):
    tok = req.cookies.get("studio_token")
    if not tok:
        raise HTTPException(401, "未登录")
    try:
        return jwt.decode(tok, STUDIO_SECRET, algorithms=["HS256"])
    except Exception:
        raise HTTPException(401, "登录已过期")


@app.post("/api/login")
async def login(req: Request):
    body = await req.json()
    email = (body.get("email") or "").strip()
    pw = body.get("password") or ""
    u = users.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
    if not u or not u.get("password"):
        raise HTTPException(401, "账号或密码错误")
    try:
        ok = bcrypt.checkpw(pw.encode(), u["password"].encode())
    except Exception:
        ok = False
    if not ok:
        raise HTTPException(401, "账号或密码错误")
    resp = JSONResponse({"ok": True, "name": u.get("name", ""), "email": u.get("email", email)})
    resp.set_cookie("studio_token", make_token(str(u["_id"]), u.get("email", email)),
                    httponly=True, max_age=7 * 86400, samesite="lax",
                    secure=SECURE_COOKIE, domain=COOKIE_DOMAIN)
    return resp


def _add_domain(setcookie: str) -> str:
    if not COOKIE_DOMAIN or "domain=" in setcookie.lower():
        return setcookie
    return setcookie + f"; Domain={COOKIE_DOMAIN}"


@app.post("/api/portal-login")
async def portal_login(req: Request):
    """门户统一登录：校验账密(经 LibreChat) → 同时下发 studio 与 LibreChat 会话 Cookie 到父域。"""
    body = await req.json()
    email = (body.get("email") or "").strip()
    pw = body.get("password") or ""
    remember = bool(body.get("remember"))
    # 用 LibreChat 登录校验，并拿到它的会话 Cookie
    async with httpx.AsyncClient(timeout=30) as c:
        lr = await c.post(f"{LIBRECHAT_INTERNAL}/api/auth/login",
                          json={"email": email, "password": pw}, headers=BROWSER_UA)
    if lr.status_code != 200:
        raise HTTPException(401, "账号或密码错误")
    u = users.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
    if not u:
        raise HTTPException(401, "账号或密码错误")
    maxage = 30 * 86400 if remember else 7 * 86400
    resp = JSONResponse({"ok": True, "name": u.get("name", ""), "email": u.get("email", email)})
    # 生图会话
    resp.set_cookie("studio_token", make_token(str(u["_id"]), u.get("email", email)),
                    httponly=True, max_age=maxage, samesite="lax",
                    secure=SECURE_COOKIE, domain=COOKIE_DOMAIN)
    # 转发 LibreChat 的会话 Cookie，作用域改写到父域 → chat 子域自动免登
    for sc in lr.headers.get_list("set-cookie"):
        resp.raw_headers.append((b"set-cookie", _add_domain(sc).encode("latin-1")))
    return resp


@app.post("/api/logout")
async def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("studio_token", domain=COOKIE_DOMAIN)
    # 同时清掉 LibreChat 会话
    for name in ("refreshToken", "token_provider"):
        resp.delete_cookie(name, domain=COOKIE_DOMAIN)
    return resp


@app.get("/api/me")
async def me(req: Request):
    u = current_user(req)
    return {"email": u["email"]}


@app.get("/api/models")
async def models_list():
    return {"models": MODELS}


async def _generate(model, prompt, size, resolution, n, image_urls):
    headers = {"Authorization": f"Bearer {APIMART_KEY}", "Content-Type": "application/json"}
    m = MODEL_MAP[model]
    # Grok 有参考图时走专门的 edit 接口；其余模型生成接口直接带 image_urls
    if image_urls and m.get("edit_model"):
        endpoint = "/images/edits"
        payload = {"model": m["edit_model"], "prompt": prompt, "image_urls": image_urls[:14], "n": n}
    else:
        endpoint = "/images/generations"
        payload = {"model": model, "prompt": prompt, "size": size, "n": n}
        if m["res"]:
            payload["resolution"] = resolution
        if image_urls:
            payload["image_urls"] = image_urls[:14]
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{UPSTREAM}{endpoint}", headers=headers, json=payload)
        if r.status_code != 200:
            raise RuntimeError(f"提交失败 HTTP {r.status_code}: {r.text[:200]}")
        task_id = r.json()["data"][0]["task_id"]
        deadline = time.time() + 600
        while time.time() < deadline:
            await asyncio.sleep(3)
            tr = await c.get(f"{UPSTREAM}/tasks/{task_id}", headers=headers)
            t = tr.json().get("data", {})
            st = t.get("status")
            if st == "completed":
                urls = []
                for im in (t.get("result") or {}).get("images") or []:
                    u = im.get("url")
                    urls.extend(u if isinstance(u, list) else [u])
                if not urls:
                    raise RuntimeError("完成但无图片")
                return urls
            if st in ("failed", "cancelled"):
                raise RuntimeError(f"任务{st}: {t.get('error') or t.get('message') or ''}")
        raise RuntimeError("超时(600s)")


async def _download(urls):
    saved = []
    async with httpx.AsyncClient(timeout=120) as c:
        for u in urls:
            try:
                ir = await c.get(u)
                ext = "png" if "png" in ir.headers.get("content-type", "") else "jpg"
                fid = uuid.uuid4().hex
                with open(os.path.join(IMG_DIR, f"{fid}.{ext}"), "wb") as f:
                    f.write(ir.content)
                saved.append(f"/img/{fid}.{ext}")
            except Exception:
                saved.append(u)
    return saved


async def run_job(job_id, uid, model, prompt, size, resolution, n, image_urls):
    start = time.time()
    try:
        urls = await _generate(model, prompt, size, resolution, n, image_urls)
        saved = await _download(urls)
        history.insert_one({
            "user_id": uid, "model": model, "prompt": prompt, "size": size,
            "resolution": resolution, "images": saved, "created": int(time.time()),
        })
        JOBS[job_id] = {"status": "done", "result": {"images": saved, "prompt": prompt,
                        "model": model, "size": size}, "elapsed": int(time.time() - start)}
    except Exception as e:
        JOBS[job_id] = {"status": "error", "error": str(e), "elapsed": int(time.time() - start)}


@app.post("/api/generate")
async def generate(req: Request):
    user = current_user(req)
    body = await req.json()
    model = body.get("model")
    if model not in MODEL_MAP:
        raise HTTPException(400, "未知模型")
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(400, "请输入提示词")
    size = body.get("size") or "1:1"
    resolution = body.get("resolution") or "1k"
    n = max(1, min(int(body.get("n", 1) or 1), 4))
    image_urls = body.get("image_urls") or []
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {"status": "running", "elapsed": 0}
    asyncio.create_task(run_job(job_id, user["uid"], model, prompt, size, resolution, n, image_urls))
    return {"job_id": job_id}


@app.get("/api/job/{job_id}")
async def job_status(job_id: str, req: Request):
    current_user(req)
    j = JOBS.get(job_id)
    if not j:
        raise HTTPException(404, "任务不存在")
    if j.get("status") == "running":
        j = dict(j)
    return j


@app.get("/api/history")
async def get_history(req: Request):
    user = current_user(req)
    items = list(history.find({"user_id": user["uid"]}).sort("created", -1).limit(60))
    for it in items:
        it["_id"] = str(it["_id"])
    return {"items": items}


@app.get("/img/{name}")
async def img(name: str):
    p = os.path.join(IMG_DIR, os.path.basename(name))
    if not os.path.exists(p):
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
async def index(req: Request):
    host = req.headers.get("host", "")
    fname = "/app/portal.html" if host.startswith("app.") else "/app/index.html"
    with open(fname, encoding="utf-8") as f:
        return f.read()
