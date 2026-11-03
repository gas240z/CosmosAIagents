"""Конфигурация: загрузка .env, поиск ключей, настройки в памяти сервера."""
from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env", encoding="utf-8-sig")
load_dotenv(ROOT / "backend" / ".env", encoding="utf-8-sig")

RUNS_DIR = ROOT / "backend" / "runs"
RUNS_DIR.mkdir(parents=True, exist_ok=True)

DEMO_MODE = os.getenv("DEMO_MODE", "").strip().lower() in ("1", "true", "yes")

# id -> метаданные. aliases — подстроки в имени переменной окружения.
PROVIDERS: dict[str, dict] = {
    "anthropic": {"name": "Anthropic", "aliases": ["ANTHROPIC", "CLAUDE"]},
    "openai": {"name": "OpenAI", "aliases": ["OPENAI", "OPEN_AI", "CHATGPT"]},
    "groq": {"name": "Groq", "aliases": ["GROQ"]},
    "gemini": {"name": "Gemini", "aliases": ["GEMINI", "GOOGLE"]},
}

STANDARD_NAMES = {
    "anthropic": ["ANTHROPIC_API_KEY"],
    "openai": ["OPENAI_API_KEY"],
    "groq": ["GROQ_API_KEY"],
    "gemini": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
}


def env_key(pid: str) -> str:
    """Ключ из окружения/.env. Сначала стандартные имена, затем нестрогий поиск."""
    for name in STANDARD_NAMES[pid]:
        v = os.environ.get(name, "").strip().strip('"').strip("'")
        if v:
            return v
    for name, val in os.environ.items():
        up = name.upper()
        if "KEY" not in up and "TOKEN" not in up:
            continue
        if any(a in up for a in PROVIDERS[pid]["aliases"]):
            v = val.strip().strip('"').strip("'")
            if v:
                return v
    return ""


def concurrency(pid: str) -> int:
    try:
        return max(1, int(os.getenv(f"CONCURRENCY_{pid.upper()}", "1")))
    except ValueError:
        return 1


class Store:
    """Настройки в памяти: ключи из UI (не пишутся на диск), выбранные модели."""

    def __init__(self) -> None:
        self.ui_keys: dict[str, str] = {}
        self.models: dict[str, str] = {}
        self.orch: dict[str, str | None] = {"provider": None, "model": None}
        self._cache: dict[str, dict] = {}
        self._lock = asyncio.Lock()

    # --- ключи ---
    def key(self, pid: str) -> str:
        if DEMO_MODE:
            return "demo"
        return self.ui_keys.get(pid) or env_key(pid)

    def key_source(self, pid: str) -> str:
        if DEMO_MODE:
            return "demo"
        if self.ui_keys.get(pid):
            return "ui"
        return "env" if env_key(pid) else "none"

    def key_hint(self, pid: str) -> str:
        k = self.key(pid)
        return ("…" + k[-4:]) if len(k) > 8 and not DEMO_MODE else ""

    def available(self) -> list[str]:
        return [p for p in PROVIDERS if self.key(p)]

    # --- модели ---
    async def get_models(self, pid: str, refresh: bool = False) -> dict:
        from .providers import ADAPTERS, pick_default

        c = self._cache.get(pid)
        if c and not refresh and time.time() - c["ts"] < 600 and c.get("key") == self.key(pid):
            return c
        key = self.key(pid)
        if not key:
            res = {"models": [], "error": "", "ts": time.time(), "key": key}
        else:
            try:
                models = await ADAPTERS[pid].list_models(key)
                res = {"models": models, "error": "", "ts": time.time(), "key": key}
            except Exception as e:  # noqa: BLE001
                res = {"models": [], "error": str(e)[:300], "ts": time.time() - 590, "key": key}
        self._cache[pid] = res
        cur = self.models.get(pid)
        if res["models"] and (not cur or cur not in res["models"]):
            self.models[pid] = pick_default(pid, res["models"])
        return res

    async def resolve_model(self, pid: str) -> str:
        await self.get_models(pid)
        m = self.models.get(pid)
        if not m:
            raise RuntimeError(f"Не удалось получить список моделей {PROVIDERS[pid]['name']}")
        return m


store = Store()
