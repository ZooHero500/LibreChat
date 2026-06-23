"""
apimart 适配层
- /v1/chat/completions：
    * 对话模型 & gemini 图像模型 → 透传到 apimart（支持流式）
    * gpt-image-2 / grok（仅异步 images 接口）→ 拦截，做 提交+轮询，把图片当聊天消息返回
- /v1/images/generations：同步封装（提交+轮询），返回 OpenAI 风格 {data:[{url}]}（备用，给图像工作台用）
- /v1/models：简单透传
"""
import json
import re
import time
import socket
import asyncio
import ipaddress
import urllib.parse
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse, Response

UPSTREAM = "https://api.apimart.ai/v1"

# LobeChat 侧用 apimart- 前缀的自定义 id（避免和内置模型撞名 → 规避 Responses API、避免服务商误点亮）
# 这里映射回 apimart 真实模型 id
MODEL_ALIASES = {
    "apimart-claude-opus-4-8": "claude-opus-4-8",
    "apimart-gpt-5.5": "gpt-5.5",
    "apimart-deepseek-v4-pro": "deepseek-v4-pro",
    "apimart-deepseek-v4-flash": "deepseek-v4-flash",
    "apimart-gemini-3.1-flash-image": "gemini-3.1-flash-image-preview",
    "apimart-gpt-image-2": "gpt-image-2",
    "apimart-grok": "grok-imagine-1.5-apimart",
}


def _real_model(m):
    return MODEL_ALIASES.get(m, m)


# 仅支持异步 images 接口、不能走 chat 的图像模型（真实 id）
ASYNC_IMAGE_MODELS = {"gpt-image-2", "grok-imagine-1.5-apimart"}
# 支持 resolution 参数的模型
RES_MODELS = {"gpt-image-2"}
# 支持参考图(图生图)的模型
IMG2IMG_MODELS = {"gpt-image-2"}

# 各图像模型能力（真实 id）：res=是否支持 resolution，edit_model=参考图专用 edit 模型(如 grok)
# 供 /v1/images/generations 同步端点(内置生图工作台调用)使用，覆盖全部图生图能力
IMAGE_CAPS = {
    "grok-imagine-1.5-apimart": {"res": False, "edit_model": "grok-imagine-1.5-edit-apimart"},
    "gemini-3.1-flash-image-preview": {"res": True, "edit_model": None},
    "gpt-image-2": {"res": True, "edit_model": None},
}

POLL_INTERVAL = 3.0
TIMEOUT = 600

app = FastAPI()


def _extract(messages):
    """从最后一条 user 消息取 prompt 文本和附带图片(data URI/URL)。"""
    prompt, image_urls = "", []
    for msg in reversed(messages or []):
        if msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str):
            prompt = content
        elif isinstance(content, list):
            texts = []
            for part in content:
                if part.get("type") == "text":
                    texts.append(part.get("text", ""))
                elif part.get("type") == "image_url":
                    u = (part.get("image_url") or {}).get("url", "")
                    if u:
                        image_urls.append(u)
            prompt = "\n".join(t for t in texts if t)
        break
    return prompt.strip(), image_urls


def _parse_inline(prompt):
    """解析 --ar/--size、--res、--n。"""
    ov = {}
    pats = {
        "size": r"--(?:ar|size)[=\s]+(\S+)",
        "resolution": r"--(?:res|resolution)[=\s]+(\S+)",
        "n": r"--n[=\s]+(\d+)",
    }
    for k, p in pats.items():
        m = re.search(p, prompt, flags=re.IGNORECASE)
        if m:
            ov[k] = m.group(1)
            prompt = re.sub(p, "", prompt, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", prompt).strip(), ov


def _build_payload(model, prompt, image_urls, size, resolution, n):
    payload = {"model": model, "prompt": prompt, "size": size, "n": n}
    if model in RES_MODELS:
        payload["resolution"] = resolution
    if model in IMG2IMG_MODELS and image_urls:
        payload["image_urls"] = image_urls[:14]
    return payload


def _extract_urls(t):
    urls = []
    for im in (t.get("result") or {}).get("images") or []:
        u = im.get("url")
        urls.extend(u if isinstance(u, list) else [u])
    return urls


async def _gen_stream(model, prompt, image_urls, size, resolution, n, auth):
    """异步生成器：提交+轮询，过程中 yield ('progress', 已用秒) / ('done', urls) / ('error', msg)。"""
    headers = {"Authorization": auth, "Content-Type": "application/json"}
    payload = _build_payload(model, prompt, image_urls, size, resolution, n)
    async with httpx.AsyncClient(timeout=60) as c:
        try:
            r = await c.post(f"{UPSTREAM}/images/generations", headers=headers, json=payload)
            if r.status_code != 200:
                yield ("error", f"提交失败 HTTP {r.status_code}: {r.text[:300]}")
                return
            task_id = r.json()["data"][0]["task_id"]
        except Exception as e:
            yield ("error", f"提交异常: {e}")
            return

        start = time.time()
        while time.time() - start < TIMEOUT:
            await asyncio.sleep(POLL_INTERVAL)
            try:
                tr = await c.get(f"{UPSTREAM}/tasks/{task_id}", headers=headers)
                t = tr.json().get("data", {})
            except Exception:
                yield ("progress", int(time.time() - start))
                continue
            st = t.get("status")
            if st == "completed":
                urls = _extract_urls(t)
                yield ("done", urls) if urls else ("error", "完成但无图片")
                return
            if st in ("failed", "cancelled"):
                yield ("error", f"任务{st}: {t.get('error') or t.get('message') or ''}")
                return
            yield ("progress", int(time.time() - start))
        yield ("error", f"超时({TIMEOUT}s)")


async def _generate_image(model, prompt, image_urls, size, resolution, n, auth):
    """非流式：跑完整个生成，返回图片 URL 列表。出错抛异常。"""
    async for kind, payload in _gen_stream(model, prompt, image_urls, size, resolution, n, auth):
        if kind == "done":
            return payload
        if kind == "error":
            raise RuntimeError(payload)
    raise RuntimeError("未知错误")


def _chunk(model, content=None, finish=None):
    d = {"role": "assistant"}
    if content is not None:
        d["content"] = content
    obj = {
        "id": "chatcmpl-img",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": d if content is not None else {}, "finish_reason": finish}],
    }
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@app.post("/v1/chat/completions")
async def chat_completions(req: Request):
    body = await req.json()
    auth = req.headers.get("authorization", "")
    model = _real_model(body.get("model", ""))
    body["model"] = model  # 透传时也用真实 id
    stream = body.get("stream", False)

    # 非异步图像模型：透传
    if model not in ASYNC_IMAGE_MODELS:
        headers = {"Authorization": auth, "Content-Type": "application/json"}
        if stream:
            async def proxy_stream():
                async with httpx.AsyncClient(timeout=300) as c:
                    async with c.stream("POST", f"{UPSTREAM}/chat/completions",
                                        headers=headers, json=body) as up:
                        async for chunk in up.aiter_raw():
                            yield chunk
            return StreamingResponse(proxy_stream(), media_type="text/event-stream")
        async with httpx.AsyncClient(timeout=300) as c:
            up = await c.post(f"{UPSTREAM}/chat/completions", headers=headers, json=body)
            return Response(content=up.content, status_code=up.status_code,
                            media_type=up.headers.get("content-type", "application/json"))

    # 异步图像模型：拦截，转图片
    prompt, image_urls = _extract(body.get("messages"))
    prompt, ov = _parse_inline(prompt)
    size = ov.get("size", "1:1")
    resolution = ov.get("resolution", "1k")
    try:
        n = int(ov.get("n", 1))
    except ValueError:
        n = 1

    if not prompt:
        text = "请输入图像描述（提示词）。"
        if stream:
            async def g():
                yield _chunk(model, text)
                yield _chunk(model, finish="stop")
                yield "data: [DONE]\n\n"
            return StreamingResponse(g(), media_type="text/event-stream")
        return JSONResponse(_full(model, text))

    # 流式：边轮询边发心跳，保持连接不被中间层超时断开
    if stream:
        async def g():
            yield _chunk(model, "🎨 正在生成图像，请稍候…\n\n")
            last_beat = -1
            async for kind, payload in _gen_stream(model, prompt, image_urls, size, resolution, n, auth):
                if kind == "progress":
                    # 每约 6 秒更新一次进度，避免刷屏，同时保活
                    if payload - last_beat >= 6:
                        last_beat = payload
                        yield _chunk(model, f"`{payload}s` ")
                elif kind == "done":
                    img = "\n\n".join(f"![image]({u})" for u in payload)
                    yield _chunk(model, f"\n\n{img}")
                elif kind == "error":
                    yield _chunk(model, f"\n\n❌ 生成失败：{payload}")
            yield _chunk(model, finish="stop")
            yield "data: [DONE]\n\n"
        return StreamingResponse(g(), media_type="text/event-stream")

    # 非流式
    try:
        urls = await _generate_image(model, prompt, image_urls, size, resolution, n, auth)
        md = "\n\n".join(f"![image]({u})" for u in urls)
    except Exception as e:
        md = f"❌ 生成失败：{e}"
    return JSONResponse(_full(model, md))


def _full(model, content):
    return {
        "id": "chatcmpl-img",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content},
                     "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


async def _generate_full(model, prompt, image_urls, size, resolution, n, auth):
    """按模型能力选择 generations/edits 接口，提交+轮询，返回图片 URL 列表。出错抛异常。
    覆盖全部图生图能力（grok 走 edit 接口；gemini/gpt-image 直接带 image_urls）。"""
    headers = {"Authorization": auth, "Content-Type": "application/json"}
    endpoint, payload = _image_request(model, prompt, image_urls, size, resolution, n)
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{UPSTREAM}{endpoint}", headers=headers, json=payload)
        if r.status_code != 200:
            raise RuntimeError(f"提交失败 HTTP {r.status_code}: {r.text[:200]}")
        task_id = r.json()["data"][0]["task_id"]
        start = time.time()
        while time.time() - start < TIMEOUT:
            await asyncio.sleep(POLL_INTERVAL)
            try:
                tr = await c.get(f"{UPSTREAM}/tasks/{task_id}", headers=headers)
                t = tr.json().get("data", {})
            except Exception:
                continue
            st = t.get("status")
            if st == "completed":
                urls = _extract_urls(t)
                if not urls:
                    raise RuntimeError("完成但无图片")
                return urls
            if st in ("failed", "cancelled"):
                raise RuntimeError(f"任务{st}: {t.get('error') or t.get('message') or ''}")
        raise RuntimeError(f"超时({TIMEOUT}s)")


def _image_request(model, prompt, image_urls, size, resolution, n):
    """按模型能力选择 generations/edits 接口与 payload（grok 走 edit；带 res/参考图）。"""
    caps = IMAGE_CAPS.get(model, {})
    if image_urls and caps.get("edit_model"):
        return "/images/edits", {
            "model": caps["edit_model"], "prompt": prompt, "image_urls": image_urls[:14], "n": n,
        }
    payload = {"model": model, "prompt": prompt, "size": size, "n": n}
    if caps.get("res"):
        payload["resolution"] = resolution
    if image_urls:
        payload["image_urls"] = image_urls[:14]
    return "/images/generations", payload


@app.post("/v1/images/submit")
async def images_submit(req: Request):
    """异步提交：构造模型对应 payload，提交到 apimart，原样返回 {data:[{task_id}]}。
    供内置生图工作台(/draw)使用 —— 后端拿 task_id 后自行短请求轮询 /v1/images/task。"""
    body = await req.json()
    auth = req.headers.get("authorization", "")
    model = _real_model(body.get("model", ""))
    prompt = body.get("prompt", "")
    size = body.get("size", "1:1")
    n = int(body.get("n", 1) or 1)
    resolution = body.get("resolution", "1k")
    image_urls = body.get("image_urls", [])
    endpoint, payload = _image_request(model, prompt, image_urls, size, resolution, n)
    headers = {"Authorization": auth, "Content-Type": "application/json"}
    last_err = None
    for attempt in range(4):
        try:
            async with httpx.AsyncClient(timeout=60) as c:
                r = await c.post(f"{UPSTREAM}{endpoint}", headers=headers, json=payload)
            return Response(content=r.content, status_code=r.status_code,
                            media_type=r.headers.get("content-type", "application/json"))
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
        await asyncio.sleep(1.5 * (attempt + 1))
    return JSONResponse({"error": {"message": f"submit failed: {last_err}"}}, status_code=502)


@app.get("/v1/images/task/{task_id}")
async def images_task(task_id: str, req: Request):
    """查询出图任务状态（透传 apimart /tasks/{id}）。"""
    auth = req.headers.get("authorization", "")
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{UPSTREAM}/tasks/{task_id}", headers={"Authorization": auth})
        return Response(content=r.content, status_code=r.status_code,
                        media_type=r.headers.get("content-type", "application/json"))


# 仅阻断真正的内网/环回目标（含 Docker 172.x 网段、云元数据 169.254）。
# 注意：本部署常处于 fake-ip 代理环境，公网 CDN 会解析到 198.18.x，必须放行。
_BLOCKED_NETS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def _is_safe_public_url(url: str) -> bool:
    """允许 http(s) 且未解析到内网/环回的 URL（阻断 SSRF 触达内部服务）。
    apimart 出图结果会落在多个 CDN 域名(apib.ai / aishuch.com 等)，故不用域名白名单。"""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except Exception:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if any(ip in net for net in _BLOCKED_NETS):
            return False
    return True


@app.get("/v1/images/fetch")
async def images_fetch(url: str):
    """下载出图结果(CDN)的字节并回传 —— 让 api 容器经容器内 HTTP 取图，
    避开 api 容器直连外网 CDN 时的 TLS 干扰。对外网抖动做重试。"""
    if not _is_safe_public_url(url):
        return JSONResponse({"error": {"message": "url not allowed"}}, status_code=400)
    last_err = None
    for attempt in range(4):
        try:
            async with httpx.AsyncClient(timeout=120, follow_redirects=True) as c:
                r = await c.get(url)
            if r.status_code == 200:
                return Response(content=r.content, status_code=200,
                                media_type=r.headers.get("content-type", "application/octet-stream"))
            last_err = f"HTTP {r.status_code}"
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
        await asyncio.sleep(1.5 * (attempt + 1))
    return JSONResponse({"error": {"message": f"download failed: {last_err}"}}, status_code=502)


@app.post("/v1/images/generations")
async def images_generations(req: Request):
    """OpenAI 同步风格封装（备用）：提交+轮询，返回 {data:[{url}]}。"""
    body = await req.json()
    auth = req.headers.get("authorization", "")
    model = _real_model(body.get("model", ""))
    prompt = body.get("prompt", "")
    size = body.get("size", "1:1")
    n = int(body.get("n", 1) or 1)
    resolution = body.get("resolution", "1k")
    image_urls = body.get("image_urls", [])
    try:
        urls = await _generate_full(model, prompt, image_urls, size, resolution, n, auth)
        return {"created": int(time.time()), "data": [{"url": u} for u in urls]}
    except Exception as e:
        return JSONResponse({"error": {"message": str(e)}}, status_code=502)


@app.post("/v1/embeddings")
async def embeddings(req: Request):
    """嵌入透传到 apimart（知识库等用），不支持则原样回传错误。"""
    body = await req.json()
    auth = req.headers.get("authorization", "")
    body["model"] = _real_model(body.get("model", ""))
    async with httpx.AsyncClient(timeout=60) as c:
        up = await c.post(f"{UPSTREAM}/embeddings",
                          headers={"Authorization": auth, "Content-Type": "application/json"},
                          json=body)
        return Response(content=up.content, status_code=up.status_code,
                        media_type=up.headers.get("content-type", "application/json"))


@app.get("/v1/models")
async def models(req: Request):
    auth = req.headers.get("authorization", "")
    async with httpx.AsyncClient(timeout=30) as c:
        up = await c.get(f"{UPSTREAM}/models", headers={"Authorization": auth})
        return Response(content=up.content, status_code=up.status_code,
                        media_type=up.headers.get("content-type", "application/json"))


@app.get("/health")
async def health():
    return {"status": "ok"}
