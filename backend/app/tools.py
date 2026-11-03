"""Инструменты агентов: чтение проекта, поиск, контракт, линтер.
Протокол провайдер-независимый (текстовые блоки), поэтому работает одинаково у OpenAI, Groq, Anthropic и Gemini."""
from __future__ import annotations

import ast
import asyncio
import json
import posixpath
import re
import shutil
import subprocess
import tempfile
from html.parser import HTMLParser
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .orchestrator import Run

TOOL_NAMES = ("list_files", "read_file", "search_code", "get_contract", "lint")
TOOL_RE = re.compile(r"=== TOOL: *([A-Za-z_]+) *===\s*(.*?)\s*=== END TOOL ===", re.S)
PLACEHOLDER = re.compile(r"(?i)(rest of (the )?(code|file)|остальной код|остальная часть кода|implement(ation)? here|\.\.\.\s*(остальн|rest|remaining))")
MAX_READ = 12000


def parse_tool_calls(text: str) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    for m in TOOL_RE.finditer(text):
        body = m.group(2).strip()
        try:
            args = json.loads(body) if body else {}
            if not isinstance(args, dict):
                args = {}
        except ValueError:
            args = {"_error": "аргументы должны быть валидным JSON-объектом"}
        out.append((m.group(1).lower(), args))
    return out


class _Refs(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.refs: list[str] = []

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag in ("script", "img", "source", "audio", "video") and d.get("src"):
            self.refs.append(d["src"])
        if tag == "link" and d.get("href"):
            self.refs.append(d["href"])


async def _node_check(content: str) -> str | None:
    node = shutil.which("node")
    if not node:
        return None

    def run() -> str | None:
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "x.mjs"
            f.write_text(content, encoding="utf-8")
            try:
                r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True, timeout=15)
            except Exception:  # noqa: BLE001
                return None
            if r.returncode == 0:
                return None
            lines = [ln for ln in r.stderr.splitlines() if ln.strip()]
            err = next((ln for ln in lines if "Error" in ln), lines[-1] if lines else "синтаксическая ошибка")
            where = next((ln for ln in lines if ln.strip().startswith(str(f)) or "x.mjs:" in ln), "")
            ln = re.search(r"x\.mjs:(\d+)", where)
            return f"{err.strip()[:140]}" + (f" (строка {ln.group(1)})" if ln else "")

    return await asyncio.to_thread(run)


async def lint_file(path: str, content: str, known: set[str]) -> list[tuple[str, str]]:
    """-> [(level, message)], level: error|warn"""
    res: list[tuple[str, str]] = []
    low = path.lower()
    if not content.strip():
        return [("error", "файл пустой")]
    if PLACEHOLDER.search(content):
        res.append(("error", "в коде есть заглушка/сокращение вместо полной реализации"))
    if low.endswith(".json"):
        try:
            json.loads(content)
        except ValueError as e:
            res.append(("error", f"невалидный JSON: {e}"))
    elif low.endswith(".py"):
        try:
            ast.parse(content)
        except SyntaxError as e:
            res.append(("error", f"SyntaxError: {e.msg} (строка {e.lineno})"))
    elif low.endswith((".js", ".mjs", ".cjs")):
        msg = await _node_check(content)
        if msg:
            res.append(("error", msg))
    elif low.endswith(".css"):
        if content.count("{") != content.count("}"):
            res.append(("error", f"несбалансированные скобки в CSS: «{{» {content.count('{')} ≠ «}}» {content.count('}')}"))
    elif low.endswith((".html", ".htm")):
        if content.lower().count("<script") != content.lower().count("</script>"):
            res.append(("error", "незакрытый тег <script>"))
        p = _Refs()
        try:
            p.feed(content)
        except Exception:  # noqa: BLE001
            pass
        base = posixpath.dirname(path)
        for ref in p.refs:
            r = ref.split("#")[0].split("?")[0]
            if not r or re.match(r"^(https?:|//|data:|mailto:|tel:|javascript:)", r):
                continue
            target = posixpath.normpath(posixpath.join(base, r)) if not r.startswith("/") else r.lstrip("/")
            if target not in known:
                res.append(("error", f"ссылка на несуществующий файл: {ref}"))
    return res


class ToolBox:
    def __init__(self, run: "Run") -> None:
        self.run = run

    def known(self) -> set[str]:
        return {f["path"] for f in self.run.contract.get("files", [])} | set(self.run.files)

    def _find(self, path: str) -> str | None:
        path = (path or "").strip().strip("`'\"").replace("\\", "/").lstrip("./")
        if path in self.run.files:
            return path
        cands = [p for p in self.run.files if p.endswith(path)] if path else []
        return cands[0] if len(cands) == 1 else None

    def _who(self, path: str) -> str:
        for t in self.run.tasks.values():
            if path in t["files"]:
                return f"задача {t['id']}, агент {t['agent']}"
        return "—"

    async def call(self, name: str, args: dict) -> tuple[bool, str, str]:
        """-> (ok, текст для модели, краткое резюме для UI)"""
        if "_error" in args:
            return False, args["_error"], "неверные аргументы"
        r = self.run
        if name == "list_files":
            rows = []
            for f in r.contract.get("files", []):
                p = f["path"]
                st = f"написан ({len(r.files[p])} симв.)" if p in r.files else f"ещё не написан ({self._who(p)})"
                rows.append(f"{p} — {f.get('purpose', '')} [{st}]")
            return True, "\n".join(rows) or "(пусто)", f"{len(rows)} файлов"
        if name == "read_file":
            p = self._find(str(args.get("path", "")))
            if not p:
                want = str(args.get("path", ""))
                exists = [f["path"] for f in r.contract.get("files", []) if f["path"].endswith(want)] if want else []
                msg = f"файл {want!r} ещё не написан ({self._who(exists[0])}) — ориентируйся на контракт" if exists else f"файла {want!r} нет в проекте. Вызови list_files"
                return False, msg, "файл недоступен"
            c = r.files[p]
            cut = c if len(c) <= MAX_READ else c[:MAX_READ] + "\n...[обрезано]"
            return True, cut, f"{len(c)} симв."
        if name == "search_code":
            q = str(args.get("query", "")).strip()
            if len(q) < 2:
                return False, "укажи query (минимум 2 символа)", "пустой запрос"
            hits = []
            for p, c in r.files.items():
                for i, ln in enumerate(c.splitlines(), 1):
                    if q.lower() in ln.lower():
                        hits.append(f"{p}:{i}: {ln.strip()[:160]}")
                        if len(hits) >= 25:
                            break
                if len(hits) >= 25:
                    break
            return True, "\n".join(hits) or "ничего не найдено в уже написанных файлах", f"{len(hits)} совпадений"
        if name == "get_contract":
            p = str(args.get("path", "")).strip()
            if p:
                f = next((x for x in r.contract.get("files", []) if x["path"] == p or x["path"].endswith(p)), None)
                if not f:
                    return False, f"{p!r} нет в контракте", "нет в контракте"
                return True, f"{f['path']}\nназначение: {f.get('purpose', '')}\nинтерфейс: {f.get('interface', '')}", f["path"]
            c = r.contract
            return True, f"стек: {c.get('stack', '')}\nправила: {c.get('conventions', '')}\nстиль: {c.get('style', '')}", "контракт"
        if name == "lint":
            p = self._find(str(args.get("path", "")))
            if not p:
                return False, "файл ещё не написан", "файл недоступен"
            iss = await lint_file(p, r.files[p], self.known())
            if not iss:
                return True, "ошибок не найдено", "ок"
            return False, "\n".join(f"[{lv}] {m}" for lv, m in iss), iss[0][1][:80]
        return False, f"неизвестный инструмент {name!r}. Доступны: list_files, read_file, search_code, get_contract", "неизвестный инструмент"
