"""Единый интерфейс-адаптер для всех провайдеров + повторные попытки + демо-режим."""
from __future__ import annotations

import asyncio
import json
import os
import random
import re
from typing import AsyncIterator, Awaitable, Callable

import httpx

OnText = Callable[[str], None]


class ProviderError(Exception):
    def __init__(self, msg: str, status: int | None = None, retryable: bool = False,
                 retry_after: float | None = None):
        super().__init__(msg)
        self.status = status
        self.retryable = retryable
        self.retry_after = retry_after


def _parse_wait(text: str) -> float | None:
    """Достаём 'try again in 7.5s' / '1m3s' / retryDelay: '23s' из текста ошибки."""
    m = re.search(r'retryDelay"?\s*:\s*"(\d+(?:\.\d+)?)s"', text)
    if m:
        return float(m.group(1))
    m = re.search(r"try again in\s+(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)(ms|s))?", text, re.I)
    if m and (m.group(1) or m.group(2)):
        sec = int(m.group(1) or 0) * 60
        if m.group(2):
            sec += float(m.group(2)) / (1000 if m.group(3) == "ms" else 1)
        return sec
    return None


def make_error(status: int, body: str, headers: httpx.Headers) -> ProviderError:
    msg = body[:400]
    try:
        j = json.loads(body)
        e = j.get("error", j) if isinstance(j, dict) else {}
        if isinstance(e, dict):
            msg = e.get("message") or msg
        elif isinstance(e, str):
            msg = e
    except Exception:  # noqa: BLE001
        pass
    wait = None
    ra = headers.get("retry-after")
    if ra:
        try:
            wait = float(ra)
        except ValueError:
            pass
    wait = wait or _parse_wait(body)
    retryable = status in (408, 409, 425, 429, 500, 502, 503, 504, 529)
    low = body.lower()
    # суточные квоты / нулевой лимит ждать бессмысленно -> сразу failover
    if "perday" in low or "per day" in low or "limit: 0" in low or "quota exceeded" in low and wait is None:
        retryable = False
    if wait and wait > 75:
        retryable = False
    if status == 413:
        retryable = False
    return ProviderError(f"HTTP {status}: {msg}", status, retryable, wait)


async def sse_lines(client: httpx.AsyncClient, method: str, url: str, headers: dict,
                    payload: dict | None = None) -> AsyncIterator[str]:
    try:
        async with client.stream(method, url, headers=headers, json=payload,
                                 timeout=httpx.Timeout(30, read=300)) as r:
            if r.status_code >= 400:
                body = (await r.aread()).decode(errors="replace")
                raise make_error(r.status_code, body, r.headers)
            async for line in r.aiter_lines():
                if line.startswith("data:"):
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    if data:
                        yield data
    except (httpx.TimeoutException, httpx.TransportError) as e:
        raise ProviderError(f"Сеть: {type(e).__name__} {e}", retryable=True) from e


async def get_json(url: str, headers: dict, params: dict | None = None) -> dict:
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(url, headers=headers, params=params)
    except httpx.HTTPError as e:
        raise ProviderError(f"Сеть: {type(e).__name__} {e}", retryable=True) from e
    if r.status_code >= 400:
        raise make_error(r.status_code, r.text, r.headers)
    return r.json()


class Adapter:
    id = ""

    async def list_models(self, key: str) -> list[str]:  # pragma: no cover
        raise NotImplementedError

    async def stream(self, key: str, model: str, system: str, user: str, on_text: OnText) -> str:
        raise NotImplementedError


class OpenAICompat(Adapter):
    base = ""
    bad: tuple[str, ...] = ()
    prefix: re.Pattern | None = None

    def _ok(self, mid: str) -> bool:
        low = mid.lower()
        if self.prefix and not self.prefix.match(low):
            return False
        return not any(b in low for b in self.bad)

    async def list_models(self, key: str) -> list[str]:
        j = await get_json(f"{self.base}/models", {"Authorization": f"Bearer {key}"})
        items = sorted(j.get("data", []), key=lambda m: m.get("created", 0), reverse=True)
        return [m["id"] for m in items if self._ok(m["id"])]

    async def stream(self, key, model, system, user, on_text):
        payload = {"model": model, "stream": True,
                   "messages": [{"role": "system", "content": system},
                                {"role": "user", "content": user}]}
        out: list[str] = []
        async with httpx.AsyncClient() as c:
            async for data in sse_lines(c, "POST", f"{self.base}/chat/completions",
                                        {"Authorization": f"Bearer {key}"}, payload):
                try:
                    j = json.loads(data)
                except ValueError:
                    continue
                if j.get("error"):
                    raise ProviderError(str(j["error"])[:300], retryable=True)
                for ch in j.get("choices", []):
                    t = (ch.get("delta") or {}).get("content")
                    if t:
                        out.append(t)
                        on_text(t)
        return "".join(out)


class OpenAI(OpenAICompat):
    id = "openai"
    base = "https://api.openai.com/v1"
    prefix = re.compile(r"^(gpt-|o\d|chatgpt-)")
    bad = ("embedding", "tts", "whisper", "dall", "audio", "realtime", "transcribe", "image",
           "moderation", "search", "instruct", "codex", "-pro", "computer-use", "deep-research")


class Groq(OpenAICompat):
    id = "groq"
    base = "https://api.groq.com/openai/v1"
    bad = ("whisper", "tts", "guard", "playai", "orpheus", "safeguard", "embed")


class Anthropic(Adapter):
    id = "anthropic"
    base = "https://api.anthropic.com/v1"

    def _h(self, key):
        return {"x-api-key": key, "anthropic-version": "2023-06-01"}

    async def list_models(self, key):
        j = await get_json(f"{self.base}/models", self._h(key), {"limit": 1000})
        return [m["id"] for m in j.get("data", [])]

    async def stream(self, key, model, system, user, on_text):
        payload = {"model": model, "max_tokens": 8192, "stream": True, "system": system,
                   "messages": [{"role": "user", "content": user}]}
        out: list[str] = []
        async with httpx.AsyncClient() as c:
            async for data in sse_lines(c, "POST", f"{self.base}/messages",
                                        {**self._h(key), "content-type": "application/json"}, payload):
                try:
                    j = json.loads(data)
                except ValueError:
                    continue
                if j.get("type") == "error":
                    e = j.get("error", {})
                    raise ProviderError(e.get("message", "stream error"), retryable=True)
                if j.get("type") == "content_block_delta":
                    t = j.get("delta", {}).get("text")
                    if t:
                        out.append(t)
                        on_text(t)
        return "".join(out)


class Gemini(Adapter):
    id = "gemini"
    base = "https://generativelanguage.googleapis.com/v1beta"

    async def list_models(self, key):
        j = await get_json(f"{self.base}/models", {"x-goog-api-key": key}, {"pageSize": 1000})
        res = []
        for m in j.get("models", []):
            if "generateContent" not in m.get("supportedGenerationMethods", []):
                continue
            n = m["name"].removeprefix("models/")
            low = n.lower()
            if any(b in low for b in ("embedding", "image", "tts", "aqa", "veo", "imagen", "live",
                                       "audio", "robotics", "computer-use", "learnlm")):
                continue
            res.append(n)
        return sorted(res, reverse=True)

    async def stream(self, key, model, system, user, on_text):
        payload = {"systemInstruction": {"parts": [{"text": system}]},
                   "contents": [{"role": "user", "parts": [{"text": user}]}]}
        out: list[str] = []
        url = f"{self.base}/models/{model}:streamGenerateContent?alt=sse"
        async with httpx.AsyncClient() as c:
            async for data in sse_lines(c, "POST", url, {"x-goog-api-key": key}, payload):
                try:
                    j = json.loads(data)
                except ValueError:
                    continue
                for cand in j.get("candidates", []):
                    for p in (cand.get("content") or {}).get("parts", []):
                        if p.get("thought"):
                            continue
                        t = p.get("text")
                        if t:
                            out.append(t)
                            on_text(t)
        return "".join(out)


# ---------------------------------------------------------------- демо-режим
_chaos = {"groq_429": False}


class Mock(Adapter):
    """Имитация провайдера (DEMO_MODE=1): без ключей и сети."""

    def __init__(self, pid: str):
        self.id = pid

    async def list_models(self, key):
        return [f"{self.id}-demo-large", f"{self.id}-demo-fast"]

    async def _emit(self, text: str, on_text: OnText):
        for i in range(0, len(text), 9):
            on_text(text[i:i + 9])
            await asyncio.sleep(0.012)

    async def stream(self, key, model, system, user, on_text):
        chaos = os.getenv("DEMO_CHAOS", "") == "1"
        if chaos and self.id == "groq" and not _chaos["groq_429"] and "[[ROLE:worker]]" in system:
            _chaos["groq_429"] = True
            raise ProviderError("HTTP 429: rate limit (demo)", 429, True, 1.5)
        if chaos and self.id == "gemini" and "[[ROLE:worker]]" in system and "js/app.js" in user:
            raise ProviderError("HTTP 500: demo outage", 500, False)
        await asyncio.sleep(random.uniform(0.6, 1.4))
        text = _mock_text(system, user)
        await self._emit(text, on_text)
        return text


def _mock_text(system: str, user: str) -> str:
    if "[[ROLE:contract]]" in system:
        q = user.split("ЗАПРОС ПОЛЬЗОВАТЕЛЯ:")[-1].strip()
        cyr = bool(re.search("[А-Яа-яЁё]", q))
        mm = re.search(r"(?i)(?:запомни|remember)(?: that)?[,:]?\s*(.+)", q)
        if mm:
            return json.dumps({"mode": "chat", "language": "Russian" if cyr else "English", "remember": [mm.group(1).strip()],
                               "reply": "Запомнил! Учту это в следующих проектах." if cyr else "Got it, I'll remember that."}, ensure_ascii=False)
        if re.search(r"(?i)(привет|здравствуй|как дела|салам|hello|\bhi\b|hey|how are you)", q) and not re.search(r"(?i)(созда|сделай|build|create|make)", q):
            return json.dumps({"mode": "chat", "language": "Russian" if cyr else "English",
                               "reply": "Привет! У меня всё отлично, спасибо. Могу просто поболтать или создать проект целиком — опишите, что нужно." if cyr
                               else "Hi! I'm doing great, thanks. We can just chat, or I can build a whole project for you — just describe it."}, ensure_ascii=False)
        return json.dumps({"mode": "build", "language": "Russian" if cyr else "English",
            "project_name": "demo-shop", "summary": "Демо-магазин: каталог и корзина на чистом HTML/CSS/JS.",
            "stack": "HTML + CSS + vanilla JS", "conventions": "ES-модули не используются; глобальный объект window.Shop.",
            "style": "CSS-переменные в :root, тёмная тема",
            "files": [
                {"path": "index.html", "purpose": "Страница магазина", "interface": "подключает css/style.css, js/data.js, js/app.js"},
                {"path": "css/style.css", "purpose": "Стили", "interface": "классы .card, .cart"},
                {"path": "js/data.js", "purpose": "Данные товаров", "interface": "window.Shop.products"},
                {"path": "js/app.js", "purpose": "Логика каталога и корзины", "interface": "renderProducts(), addToCart(id)"},
                {"path": "README.md", "purpose": "Документация", "interface": ""}]}, ensure_ascii=False)
    if "[[ROLE:plan]]" in system:
        ags = re.search(r"AVAILABLE_AGENTS:\s*(.+)", user)
        a = [x.strip() for x in ags.group(1).split(",")] if ags else ["openai"]
        g = lambda i: a[i % len(a)]  # noqa: E731
        return json.dumps({"tasks": [
            {"id": "t1", "title": "Данные товаров", "description": "Массив products", "files": ["js/data.js"], "depends_on": [], "agent": g(2)},
            {"id": "t2", "title": "Стили", "description": "Тёмная тема", "files": ["css/style.css"], "depends_on": [], "agent": g(0)},
            {"id": "t3", "title": "Логика корзины", "description": "Рендер и корзина", "files": ["js/app.js"], "depends_on": ["t1"], "agent": g(3)},
            {"id": "t4", "title": "Разметка", "description": "index.html", "files": ["index.html"], "depends_on": ["t2", "t3"], "agent": g(1)},
            {"id": "t5", "title": "README", "description": "Как запустить", "files": ["README.md"], "depends_on": ["t4"], "agent": g(2)}]},
            ensure_ascii=False)
    if "[[ROLE:review]]" in system:
        return json.dumps({"ok": True, "summary": "Несостыковок не найдено (демо).", "issues": []}, ensure_ascii=False)
    m = re.search(r"FILES_TO_WRITE:\s*(.+)", user)
    files = [f.strip() for f in m.group(1).split(",")] if m else []
    if "[РЕЗУЛЬТАТЫ ИНСТРУМЕНТОВ]" not in user and "[ЗАМЕЧАНИЯ ЛИНТЕРА]" not in user:
        calls = ['=== TOOL: get_contract ===\n{}\n=== END TOOL ===', '=== TOOL: list_files ===\n{}\n=== END TOOL ===']
        dep = re.search(r"=== FILE: (.+?) ===", user.split("ГОТОВЫЕ ФАЙЛЫ ЗАВИСИМОСТЕЙ")[-1]) if "ГОТОВЫЕ ФАЙЛЫ ЗАВИСИМОСТЕЙ" in user else None
        if dep:
            calls.append('=== TOOL: read_file ===\n{"path": "%s"}\n=== END TOOL ===' % dep.group(1))
            calls.append('=== TOOL: search_code ===\n{"query": "Shop"}\n=== END TOOL ===')
        return "\n".join(calls)
    out = []
    for f in files:
        body = f"// {f} — сгенерировано демо-агентом\n" + "\n".join(f"// строка {i}: заглушка" for i in range(1, 9)) + "\n"
        if f == "js/app.js" and os.getenv("DEMO_CHAOS", "") == "1" and "[ЗАМЕЧАНИЯ ЛИНТЕРА]" not in user:
            body = "function broken( {\n  return 1\n"
        if f.endswith(".html"):
            body = '<!doctype html><html><head><link rel="stylesheet" href="css/style.css"></head><body><script src="js/data.js"></script><script src="js/app.js"></script></body></html>\n'
        if f.endswith(".md"):
            body = f"# Demo Shop\n\nЗапуск: откройте index.html в браузере.\n"
        out.append(f"=== FILE: {f} ===\n{body}=== END FILE ===\n")
    return "\n".join(out)


ADAPTERS: dict[str, Adapter] = {"openai": OpenAI(), "groq": Groq(), "anthropic": Anthropic(), "gemini": Gemini()}
if os.getenv("DEMO_MODE", "").strip().lower() in ("1", "true", "yes"):
    ADAPTERS = {p: Mock(p) for p in ADAPTERS}


# ---------------------------------------------------------------- выбор модели по умолчанию
def _ver(s: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", s)[:3]) or (0,)


def pick_default(pid: str, models: list[str]) -> str:
    if not models:
        return ""
    low = {m: m.lower() for m in models}
    if pid == "anthropic":
        c = [m for m in models if "sonnet" in low[m]]
        return c[0] if c else models[0]
    if pid == "openai":
        c = [m for m in models if re.fullmatch(r"gpt-\d+(\.\d+)?", low[m])]
        if c:
            return max(c, key=_ver)
        c = [m for m in models if not any(x in low[m] for x in ("mini", "nano", "preview"))]
        return (c or models)[0]
    if pid == "groq":
        for key in ("llama-3.3-70b", "70b", "gpt-oss-120b", "120b"):
            c = [m for m in models if key in low[m]]
            if c:
                return c[0]
        return models[0]
    if pid == "gemini":
        c = [m for m in models if re.fullmatch(r"gemini-\d+(\.\d+)?-flash", low[m])]
        if c:
            return max(c, key=_ver)
        c = [m for m in models if "flash" in low[m] and "lite" not in low[m]]
        return (c or models)[0]
    return models[0]


# ---------------------------------------------------------------- ретраи
async def call_with_retry(adapter: Adapter, key: str, model: str, system: str, user: str,
                          on_text: OnText,
                          on_retry: Callable[[int, float, str], Awaitable[None]],
                          attempts: int = 5) -> str:
    delay = 2.0
    for i in range(1, attempts + 1):
        try:
            return await adapter.stream(key, model, system, user, on_text)
        except ProviderError as e:
            if not e.retryable or i == attempts:
                raise
            wait = min(max(e.retry_after or delay, 1.0) + random.uniform(0, 1), 70)
            await on_retry(i, wait, str(e))
            await asyncio.sleep(wait)
            delay = min(delay * 2, 30)
    raise ProviderError("unreachable")
