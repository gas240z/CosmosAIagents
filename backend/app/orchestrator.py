"""Оркестратор: контракт -> план -> параллельное выполнение -> ревью -> ZIP."""
from __future__ import annotations

import asyncio
import json
import re
import time
import zipfile
from collections import defaultdict

from .config import PROVIDERS, RUNS_DIR, concurrency, store
from .prompts import CONTRACT_SYSTEM, PLAN_SYSTEM, REVIEW_SYSTEM, WORKER_SYSTEM
from .memory import memory
from .providers import ProviderError, call_with_retry
from .tools import ToolBox, lint_file, parse_tool_calls

MAX_STREAM = 24000
MAX_TOOL_ROUNDS = 3
PREFERENCE = ["anthropic", "openai", "gemini", "groq"]  # кому доверить роль оркестратора по умолчанию
FILE_HDR = re.compile(r"=== FILE: (.+?) ===")
END_MARK = "=== END FILE ==="


class Fatal(Exception):
    pass


class TaskError(Exception):
    pass


# ---------------------------------------------------------------- утилиты
def sanitize_path(p: str) -> str | None:
    p = (p or "").strip().strip("`'\"").replace("\\", "/")
    while p.startswith("./"):
        p = p[2:]
    if not p or p.startswith("/") or ".." in p.split("/") or ":" in p or len(p) > 160:
        return None
    return p


def extract_json(text: str) -> dict:
    t = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m and "{" in m.group(1):
        t = m.group(1)
    a, b = t.find("{"), t.rfind("}")
    if a == -1 or b <= a:
        raise ValueError("JSON не найден")
    raw = t[a:b + 1]
    try:
        return json.loads(raw)
    except ValueError:
        raw2 = re.sub(r",\s*([}\]])", r"\1", raw)
        try:
            return json.loads(raw2)
        except ValueError as e:
            raise ValueError(f"невалидный JSON: {e}") from e


def strip_fence(body: str) -> str:
    lines = body.split("\n")
    if lines and lines[0].lstrip().startswith("```") and len(lines) > 1:
        lines = lines[1:]
        while lines and not lines[-1].strip():
            lines.pop()
        if lines and lines[-1].strip() == "```":
            lines.pop()
    return "\n".join(lines)


def parse_files(text: str) -> tuple[dict[str, str], bool]:
    """-> ({path: content}, last_block_closed)"""
    ms = list(FILE_HDR.finditer(text))
    out: dict[str, str] = {}
    closed = True
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(text)
        body = text[m.end():end]
        idx = body.rfind(END_MARK)
        if idx != -1:
            body = body[:idx]
        elif i + 1 == len(ms):
            closed = False
        path = sanitize_path(m.group(1))
        if path:
            out[path] = strip_fence(body.strip("\n")).rstrip() + "\n"
    return out, closed


class Streamer:
    """Копит токены, отдаёт в UI пачками, замечает начало новых файлов."""

    def __init__(self, run: "Run", actor: str, task_id: str | None, watch: set[str] | None, on_first):
        self.run, self.actor, self.task_id = run, actor, task_id
        self.watch, self.on_first = watch or set(), on_first
        self.buf, self.full, self.scan, self.last, self.first = "", "", 0, 0.0, False
        self.seen: set[str] = set()

    def push(self, chunk: str) -> None:
        if not self.first:
            self.first = True
            if self.on_first:
                self.on_first()
        self.buf += chunk
        self.full += chunk
        if self.watch:
            for m in FILE_HDR.finditer(self.full, self.scan):
                self.scan = m.end()
                p = sanitize_path(m.group(1))
                if p in self.watch and p not in self.seen:
                    self.seen.add(p)
                    self.run.emit("file", path=p, state="writing", task_id=self.task_id, agent=self.actor)
        now = time.monotonic()
        if now - self.last > 0.05:
            self.flush()

    def flush(self) -> None:
        if self.buf:
            self.run.say(self.actor, self.buf, self.task_id)
            self.buf = ""
        self.last = time.monotonic()

    def reset(self) -> None:
        self.flush()
        self.full, self.scan, self.seen = "", 0, set()
        self.first = False


class Run:
    def __init__(self, run_id: str, prompt: str, history: list[dict] | None = None):
        self.id, self.prompt = run_id, prompt
        self.history_msgs = history or []
        self.language = "язык запроса пользователя"
        self.history: list[dict] = []
        self.subs: set[asyncio.Queue] = set()
        self.stream_text: dict[str, str] = defaultdict(str)
        self.files: dict[str, str] = {}
        self.author: dict[str, str] = {}
        self.status = "running"
        self.zip_path = None
        self.zip_name = "project.zip"
        self.task: asyncio.Task | None = None
        self.contract: dict = {}
        self.tasks: dict[str, dict] = {}
        self.agents: list[str] = []
        self.models: dict[str, str] = {}
        self.orch_provider = ""
        self.orch_model = ""
        self.sems: dict[str, asyncio.Semaphore] = {}
        self.done_ev: dict[str, asyncio.Event] = {}
        self.task_agent: dict[str, str] = {}
        self.completed: set[str] = set()
        self.failed: set[str] = set()
        self.load: dict[str, int] = defaultdict(int)
        self.toolbox = ToolBox(self)

    # ------------------------------------------------------------ события
    def emit(self, type_: str, **data) -> None:
        ev = {"type": type_, "ts": time.time(), **data}
        self.history.append(ev)
        for q in list(self.subs):
            q.put_nowait(ev)

    def say(self, actor: str, text: str, task_id: str | None = None) -> None:
        self.stream_text[actor] = (self.stream_text[actor] + text)[-MAX_STREAM:]
        ev = {"type": "stream", "actor": actor, "task_id": task_id, "text": text}
        for q in list(self.subs):
            q.put_nowait(ev)

    def set_agent(self, agent: str, status: str, **kw) -> None:
        self.emit("agent_status", agent=agent, status=status, **kw)

    def lang_line(self) -> str:
        return (f"ЯЗЫК ПОЛЬЗОВАТЕЛЯ: {self.language}. Все тексты для людей (title и description задач, README, надписи интерфейса, комментарии, "
                "сообщения, замечания) пиши на этом языке; идентификаторы и имена файлов — на английском.")

    def history_text(self) -> str:
        rows = []
        for m in self.history_msgs[-8:]:
            who = "Пользователь" if m.get("role") == "user" else "Ассистент"
            rows.append(f"{who}: {str(m.get('text', ''))[:400]}")
        return ("ИСТОРИЯ ДИАЛОГА (последние сообщения):\n" + "\n".join(rows) + "\n\n") if rows else ""

    # ------------------------------------------------------------ вызов модели
    async def llm(self, pid: str, system: str, user: str, actor: str, task_id=None, watch=None,
                  on_first=None, model: str | None = None) -> str:
        model = model or self.models[pid]
        st = Streamer(self, actor, task_id, watch, on_first)

        async def on_retry(i: int, wait: float, reason: str) -> None:
            st.reset()
            self.emit("retry", agent=pid, task_id=task_id, attempt=i, delay=round(wait, 1), reason=reason[:200])
            self.say(actor, f"\n[⚠ {reason[:140]} — повтор {i} через {wait:.0f} с]\n", task_id)

        try:
            return await call_with_retry(PROVIDER_ADAPTERS()[pid], store.key(pid), model, system, user,
                                         st.push, on_retry)
        finally:
            st.flush()

    async def orch_json(self, system: str, user: str, label: str, allow_plain: bool = False) -> dict:
        order = [self.orch_provider] + [a for a in self.agents if a != self.orch_provider]
        last: Exception | None = None
        for n, pid in enumerate(order):
            if n:
                self.emit("failover", task_id=None, frm="orchestrator", to=pid, reason=str(last)[:160])
            model = self.orch_model if pid == self.orch_provider else self.models[pid]
            err = ""
            for attempt in range(2):
                self.emit("core_status", state="thinking", label=label)
                self.say("orchestrator", f"\n▸ {label} · {PROVIDERS[pid]['name']} / {model}\n")
                u = user if not attempt else f"{user}\n\nТвой предыдущий ответ не удалось разобрать ({err}). Верни ТОЛЬКО валидный JSON."
                text = ""
                try:
                    text = await self.llm(pid, system, u, "orchestrator", model=model)
                    return extract_json(text)
                except ProviderError as e:
                    last = e
                    break
                except ValueError as e:
                    if allow_plain and text.strip() and "{" not in text:
                        return {"_plain": text.strip()}  # модель ответила обычным текстом — это чат
                    last = e
                    err = str(e)
                finally:
                    self.emit("core_status", state="idle")
        raise Fatal(f"Оркестратор не смог выполнить «{label}»: {last}")

    # ------------------------------------------------------------ запуск
    async def execute(self) -> None:
        try:
            await self._pipeline()
        except asyncio.CancelledError:
            self.status = "cancelled"
            self.emit("fatal", message="Миссия отменена пользователем")
            raise
        except Fatal as e:
            self.status = "error"
            self.emit("fatal", message=str(e))
        except Exception as e:  # noqa: BLE001
            self.status = "error"
            self.emit("fatal", message=f"{type(e).__name__}: {e}")

    async def _pipeline(self) -> None:
        avail = store.available()
        if not avail:
            raise Fatal("Нет ни одного API-ключа. Добавьте ключи в .env или в настройках (⚙).")
        for pid in avail:
            try:
                self.models[pid] = await store.resolve_model(pid)
                self.agents.append(pid)
            except Exception as e:  # noqa: BLE001
                self.emit("log", level="warn", message=f"{PROVIDERS[pid]['name']} отключён: {str(e)[:160]}")
        if not self.agents:
            raise Fatal("Ни один провайдер не отдал список моделей — проверьте ключи.")
        op = store.orch.get("provider")
        self.orch_provider = op if op in self.agents else next(p for p in PREFERENCE if p in self.agents)
        om = store.orch.get("model")
        self.orch_model = om if (om and op == self.orch_provider) else self.models[self.orch_provider]
        self.sems = {a: asyncio.Semaphore(concurrency(a)) for a in self.agents}
        self.emit("run_started", run_id=self.id, prompt=self.prompt,
                  orchestrator={"provider": self.orch_provider, "model": self.orch_model},
                  agents={p: {"model": self.models.get(p, ""), "available": p in self.agents} for p in PROVIDERS})

        self.emit("phase", phase="analyze", label="Анализируем запрос")
        if await self.make_contract():  # обычный разговор — ответ без запуска агентов
            self.status = "chat"
            self.emit("phase", phase="chat", label="Ответ готов")
            return
        self.emit("phase", phase="plan", label="Планируем задачи")
        tasks = await self.make_plan()
        self.emit("phase", phase="execute", label="Агенты в работе")
        await self.run_tasks(tasks)
        if not self.files:
            raise Fatal("Ни одна задача не завершилась успешно — файлов нет. Проверьте ключи и лимиты.")
        self.emit("phase", phase="review", label="Ревью оркестратора")
        await self.review()
        self.emit("phase", phase="package", label="Упаковка в ZIP")
        self.package()
        self.status = "done"
        c = self.contract
        memory.add(f"{c.get('project_name', 'project')}: {c.get('summary', '')[:120]} (стек: {c.get('stack', '')[:60]}; файлов: {len(self.files)}) — запрос «{self.prompt[:70]}»", "project")
        self.emit("memory_update", added=[], count=len(memory.list()))
        self.emit("phase", phase="done", label="Миссия выполнена")
        self.emit("done", zip_url=f"/api/runs/{self.id}/download", zip_name=self.zip_name,
                  file_count=len(self.files), project=self.contract.get("project_name", "project"))

    # ------------------------------------------------------------ контракт
    async def make_contract(self) -> bool:
        """Возвращает True, если это обычный чат (ответ уже отправлен)."""
        user = f"{memory.prompt_text()}{self.history_text()}ЗАПРОС ПОЛЬЗОВАТЕЛЯ:\n{self.prompt}"
        data = await self.orch_json(CONTRACT_SYSTEM, user, "анализ запроса", allow_plain=True)
        rem = data.get("remember")
        if isinstance(rem, list):
            added = [it["text"] for it in (memory.add(str(x)) for x in rem[:5]) if it]
            if added:
                self.emit("memory_update", added=added, count=len(memory.list()))
        lang = str(data.get("language") or "").strip()[:40]
        if lang:
            self.language = lang
        mode = str(data.get("mode", "")).lower()
        if "_plain" in data or (mode == "chat" and not data.get("files")) or (not data.get("files") and data.get("reply")):
            reply = str(data.get("_plain") or data.get("reply") or "").strip() or "…"
            self.emit("chat_reply", text=reply, language=self.language)
            self.emit("core_status", state="idle")
            return True
        self.emit("phase", phase="contract", label="Фиксируем контракт")
        files, seen = [], set()
        for f in data.get("files", []) if isinstance(data.get("files"), list) else []:
            p = sanitize_path(f.get("path", "")) if isinstance(f, dict) else None
            if p and p not in seen:
                seen.add(p)
                files.append({"path": p, "purpose": str(f.get("purpose", "")), "interface": str(f.get("interface", ""))})
        if not files:
            raise Fatal("Оркестратор вернул контракт без файлов")
        if "README.md" not in seen:
            files.append({"path": "README.md", "purpose": "Описание и команда запуска", "interface": ""})
        name = re.sub(r"[^a-z0-9._-]+", "-", str(data.get("project_name", "project")).lower()).strip("-") or "project"
        self.contract = {"project_name": name, "summary": str(data.get("summary", "")), "stack": str(data.get("stack", "")),
                         "conventions": str(data.get("conventions", "")), "style": str(data.get("style", "")), "files": files[:24]}
        self.emit("contract", contract=self.contract)
        self.emit("core_status", state="idle")
        return False

    # ------------------------------------------------------------ план
    async def make_plan(self) -> list[dict]:
        paths = [f["path"] for f in self.contract["files"]]
        user = (f"{memory.prompt_text()}ЗАПРОС:\n{self.prompt}\n\nКОНТРАКТ:\n{json.dumps(self.contract, ensure_ascii=False, indent=1)}\n\n"
                f"AVAILABLE_AGENTS: {', '.join(self.agents)}\n\n{self.lang_line()}")
        try:
            data = await self.orch_json(PLAN_SYSTEM, user, "план задач")
            raw = data.get("tasks")
            if not isinstance(raw, list) or not raw:
                raise ValueError("пустой план")
        except (Fatal, ValueError):
            self.emit("log", level="warn", message="План не удался — использую резервный (по 2 файла на задачу).")
            raw = [{"id": f"t{i+1}", "title": f"Файлы {i*2+1}–{i*2+2}", "description": "Реализуй файлы по контракту",
                    "files": paths[i * 2:i * 2 + 2], "depends_on": [], "agent": self.agents[i % len(self.agents)]}
                   for i in range((len(paths) + 1) // 2)]
        tasks = self.normalize_plan(raw, paths)
        self.tasks = {t["id"]: t for t in tasks}
        self.emit("plan", tasks=tasks)
        self.emit("core_status", state="idle")
        return tasks

    def pick_agent(self, load: dict[str, int]) -> str:
        return min(self.agents, key=lambda a: load[a])

    def normalize_plan(self, raw: list, contract_paths: list[str]) -> list[dict]:
        load: dict[str, int] = defaultdict(int)
        covered: set[str] = set()
        tasks: list[dict] = []
        split_map: dict[str, list[str]] = {}
        for i, r in enumerate(raw):
            if not isinstance(r, dict):
                continue
            tid = re.sub(r"[^A-Za-z0-9_-]", "", str(r.get("id") or f"t{i+1}")) or f"t{i+1}"
            if tid in {t["id"] for t in tasks} or tid in split_map:
                tid = f"{tid}_{i}"
            files = []
            for f in r.get("files", []) if isinstance(r.get("files"), list) else []:
                p = sanitize_path(str(f))
                if p and p not in covered:
                    covered.add(p)
                    files.append(p)
            if not files:
                continue
            ag = r.get("agent") if r.get("agent") in self.agents else self.pick_agent(load)
            chunks = [files[k:k + 3] for k in range(0, len(files), 3)]
            ids = []
            for k, ch in enumerate(chunks):
                cid = tid if len(chunks) == 1 else f"{tid}{chr(97 + k)}"
                ids.append(cid)
                load[ag] += 1
                tasks.append({"id": cid, "title": str(r.get("title", cid))[:70], "description": str(r.get("description", ""))[:600],
                              "files": ch, "depends_on": [str(d) for d in r.get("depends_on", []) if isinstance(d, (str, int))],
                              "agent": ag})
            split_map[tid] = ids
        # непокрытые файлы контракта -> дополнительные задачи
        known = {f["path"]: f for f in self.contract["files"]}
        missing = [p for p in contract_paths if p not in covered]
        for k in range(0, len(missing), 3):
            ag = self.pick_agent(load)
            load[ag] += 1
            tasks.append({"id": f"x{k//3+1}", "title": "Дополнительные файлы", "description": "; ".join(known[p]["purpose"] for p in missing[k:k+3]),
                          "files": missing[k:k + 3], "depends_on": [], "agent": ag})
        # новые файлы, которых нет в контракте — добавим в него
        for t in tasks:
            for p in t["files"]:
                if p not in known:
                    self.contract["files"].append({"path": p, "purpose": t["title"], "interface": ""})
                    known[p] = self.contract["files"][-1]
        # зависимости: раскрыть разбитые, убрать невалидные
        ids = {t["id"] for t in tasks}
        for t in tasks:
            deps: list[str] = []
            for d in t["depends_on"]:
                for x in split_map.get(d, [d]):
                    if x in ids and x != t["id"] and x not in deps:
                        deps.append(x)
            t["depends_on"] = deps
        # убрать циклы (Кан)
        indeg = {t["id"]: len(t["depends_on"]) for t in tasks}
        order, queue = [], [i for i, n in indeg.items() if n == 0]
        while queue:
            x = queue.pop()
            order.append(x)
            for t in tasks:
                if x in t["depends_on"]:
                    indeg[t["id"]] -= 1
                    if indeg[t["id"]] == 0:
                        queue.append(t["id"])
        stuck = {i for i in indeg if i not in order}
        for t in tasks:
            if t["id"] in stuck:
                t["depends_on"] = [d for d in t["depends_on"] if d not in stuck]
        # уровни (волны) для таймлайна
        level: dict[str, int] = {}
        byid = {t["id"]: t for t in tasks}

        def lv(i: str) -> int:
            if i not in level:
                level[i] = 1 + max([lv(d) for d in byid[i]["depends_on"]], default=0)
            return level[i]

        for t in tasks:
            t["level"] = lv(t["id"])
        return tasks

    # ------------------------------------------------------------ выполнение
    async def run_tasks(self, tasks: list[dict]) -> None:
        for t in tasks:
            self.done_ev.setdefault(t["id"], asyncio.Event())
        await asyncio.gather(*(self.worker(t) for t in tasks))

    async def worker(self, t: dict) -> None:
        try:
            for d in t["depends_on"]:
                await self.done_ev[d].wait()
            cands = [t["agent"]] + sorted((a for a in self.agents if a != t["agent"]), key=lambda a: self.load[a])
            errors: list[str] = []
            for i, cand in enumerate(cands):
                if i:
                    self.emit("failover", task_id=t["id"], frm=cands[i - 1], to=cand, reason=errors[-1][:200])
                    self.say(cand, f"\n▸ [{t['id']}] принял задачу от {PROVIDERS[cands[i-1]]['name']} (failover)\n", t["id"])
                try:
                    async with self.sems[cand]:
                        await self.execute_task(t, cand)
                    return
                except (ProviderError, TaskError) as e:
                    errors.append(str(e))
                    self.set_agent(cand, "error", task_id=t["id"], message=str(e)[:160])
                    self.say(cand, f"\n[✖ {str(e)[:200]}]\n", t["id"])
                    await asyncio.sleep(1.0)
            self.failed.add(t["id"])
            self.emit("task_status", task_id=t["id"], status="failed", agent=t["agent"], reason=errors[-1][:200] if errors else "")
        finally:
            self.done_ev[t["id"]].set()

    def context_for(self, t: dict, agent: str) -> str:
        per, total = (4000, 12000) if agent == "groq" else (10000, 36000)
        parts, used = [], 0
        src = t["depends_on"]
        paths = [p for d in src for p in self.tasks[d]["files"] if p in self.files]
        if t.get("fix"):
            paths = [p for p in self.files if p not in t["files"]]
            per = min(per, 2500)
        for p in paths:
            c = self.files[p]
            c = c if len(c) <= per else c[:per] + "\n...[обрезано]\n"
            if used + len(c) > total:
                break
            used += len(c)
            parts.append(f"=== FILE: {p} ===\n{c.rstrip()}\n{END_MARK}")
        return "\n\n".join(parts) or "(нет)"

    def build_prompt(self, t: dict, agent: str) -> str:
        c = json.dumps(self.contract, ensure_ascii=False, indent=1)
        u = (f"ЗАПРОС ПОЛЬЗОВАТЕЛЯ:\n{self.prompt}\n\nКОНТРАКТ (источник истины):\n{c}\n\n"
             f"ТВОЯ ЗАДАЧА [{t['id']}] {t['title']}:\n{t['description']}\n\nFILES_TO_WRITE: {', '.join(t['files'])}\n\n{self.lang_line()}\n")
        if t.get("fix"):
            cur = "\n\n".join(f"=== FILE: {p} ===\n{self.files.get(p, '')}{END_MARK}" for p in t["files"])
            u += f"\nЗАМЕЧАНИЕ РЕВЬЮ — исправь:\n{t['fix']}\n\nТЕКУЩИЙ КОД ТВОИХ ФАЙЛОВ (верни ПОЛНЫЕ исправленные версии):\n{cur}\n"
            u += f"\nОСТАЛЬНЫЕ ФАЙЛЫ ПРОЕКТА (для сверки интерфейсов):\n{self.context_for(t, agent)}"
        else:
            u += f"\nГОТОВЫЕ ФАЙЛЫ ЗАВИСИМОСТЕЙ (контекст от коллег):\n{self.context_for(t, agent)}"
        return u


    # ------------------------------------------------------------ инструменты
    def emit_tool(self, agent: str, tid: str | None, name: str, arg: str, ok: bool, summary: str) -> None:
        self.emit("tool", agent=agent, tool=name, arg=str(arg)[:70], ok=ok, summary=summary[:110], task_id=tid)
        self.say(agent, f"\n🔧 {name}({str(arg)[:60]}) → {'✓' if ok else '✖'} {summary[:100]}\n", tid)

    async def run_tool(self, agent: str, tid: str | None, name: str, args: dict) -> str:
        try:
            ok, text, summary = await self.toolbox.call(name, args)
        except Exception as e:  # noqa: BLE001
            ok, text, summary = False, f"ошибка инструмента: {e}", str(e)[:80]
        self.emit_tool(agent, tid, name, args.get("path") or args.get("query") or "", ok, summary)
        return text

    async def generate(self, t: dict, agent: str, user: str, watch: set[str]) -> str:
        """Вызов модели с циклом инструментов (до MAX_TOOL_ROUNDS раундов)."""
        tid, extra, text = t["id"], "", ""
        for rnd in range(MAX_TOOL_ROUNDS + 1):
            text = await self.llm(agent, WORKER_SYSTEM, user + extra, agent, tid, watch,
                                  on_first=lambda: self.set_agent(agent, "writing", task_id=tid, title=t["title"]))
            calls = parse_tool_calls(text) if "=== FILE:" not in text else []
            if not calls or rnd == MAX_TOOL_ROUNDS:
                return text
            self.set_agent(agent, "thinking", task_id=tid, title=t["title"])
            results = []
            for name, args in calls[:3]:
                res = await self.run_tool(agent, tid, name, args)
                results.append(f"--- {name}({json.dumps(args, ensure_ascii=False)}) ---\n{res}")
            extra += ("\n\n[ТВОЙ ЗАПРОС ИНСТРУМЕНТОВ]\n" + text.strip() + "\n\n[РЕЗУЛЬТАТЫ ИНСТРУМЕНТОВ]\n" + "\n\n".join(results) +
                      "\n\nТеперь продолжай: вызови ещё инструменты (только если действительно нужно) или выдай файлы.")
            await asyncio.sleep(0.5)
        return text

    async def lint_files(self, agent: str, tid: str | None, files: dict[str, str]) -> dict[str, list[str]]:
        known = self.toolbox.known() | set(files)
        errs: dict[str, list[str]] = {}
        for p, c in files.items():
            iss = await lint_file(p, c, known)
            bad = [m for lv, m in iss if lv == "error"]
            self.emit_tool(agent, tid, "lint", p, not bad, "ок" if not bad else bad[0])
            if bad:
                errs[p] = bad
        return errs

    async def lint_and_repair(self, t: dict, agent: str, user: str, text: str, files: dict[str, str], watch: set[str]) -> dict[str, str]:
        errs = await self.lint_files(agent, t["id"], files)
        if not errs:
            return files
        msg = "\n".join(f"- {p}: {'; '.join(ms)}" for p, ms in errs.items())
        self.say(agent, f"\n↻ линтер нашёл ошибки — исправляю…\n", t["id"])
        self.set_agent(agent, "thinking", task_id=t["id"], title=t["title"])
        u = (user + f"\n\n[ТВОЙ ПРЕДЫДУЩИЙ ОТВЕТ]\n{text}\n\n[ЗАМЕЧАНИЯ ЛИНТЕРА]\n{msg}\n"
             "Исправь ошибки и верни ПОЛНЫЕ версии ВСЕХ файлов задачи в том же формате (=== FILE ===). Инструменты не вызывай.")
        text2 = await self.llm(agent, WORKER_SYSTEM, u, agent, t["id"], watch,
                               on_first=lambda: self.set_agent(agent, "writing", task_id=t["id"], title=t["title"]))
        parsed, _ = parse_files(text2)
        fixed = {p: c for p, c in parsed.items() if p in watch and c.strip()}
        if any(p not in fixed for p in files):
            return files
        errs2 = await self.lint_files(agent, t["id"], fixed)
        return fixed if len(errs2) <= len(errs) else files

    async def execute_task(self, t: dict, agent: str) -> None:
        tid = t["id"]
        self.emit("task_status", task_id=tid, status="running", agent=agent)
        self.set_agent(agent, "thinking", task_id=tid, title=t["title"])
        self.emit("ship", kind="dispatch", frm="core", to=agent, task_id=tid)
        for d in t["depends_on"]:
            da = self.task_agent.get(d)
            if da and da != agent:
                self.emit("ship", kind="handoff", frm=da, to=agent, task_id=tid)
        self.say(agent, f"\n▸ [{tid}] {t['title']}\n  файлы: {', '.join(t['files'])}\n\n", tid)
        user = self.build_prompt(t, agent)
        watch = set(t["files"])
        files: dict[str, str] = {}
        for attempt in range(2):
            u = user if not attempt else user + (
                "\n\nВНИМАНИЕ: прошлый ответ был неполным/в неверном формате. Верни ВСЕ файлы из FILES_TO_WRITE "
                "блоками «=== FILE: путь ===» … «=== END FILE ===», ничего кроме них.")
            text = await self.generate(t, agent, u, watch)
            parsed, closed = parse_files(text)
            files = {p: c for p, c in parsed.items() if p in watch and c.strip()}
            missing = [p for p in t["files"] if p not in files]
            if not missing and closed:
                break
            self.say(agent, f"\n[формат/полнота: нет {', '.join(missing) or 'END-маркера'}]\n", tid)
            if attempt:
                if missing:
                    raise TaskError(f"агент не выдал файлы: {', '.join(missing)}")
                break  # все файлы есть, просто нет закрывающего маркера — принимаем
        files = await self.lint_and_repair(t, agent, user, text, files, watch)
        for p, c in files.items():
            self.files[p] = c
            self.author[p] = agent
            self.emit("file", path=p, state="done", size=len(c.encode()), task_id=tid, agent=agent)
        self.task_agent[tid] = agent
        self.load[agent] += 1
        self.completed.add(tid)
        self.set_agent(agent, "done", task_id=tid, title=t["title"])
        self.emit("ship", kind="return", frm=agent, to="core", task_id=tid)
        self.emit("task_status", task_id=tid, status="done", agent=agent)

    # ------------------------------------------------------------ ревью
    async def review(self) -> None:
        self.emit("review", state="start")
        n = max(1, len(self.files))
        per = max(1500, 70000 // n)
        digest = "\n\n".join(
            f"=== FILE: {p} ===\n{(c if len(c) <= per else c[:per] + chr(10) + '...[обрезано]')}" for p, c in self.files.items())
        lint_errs = await self.lint_files("orchestrator", None, self.files)
        lint_txt = "\n".join(f"- {p}: {'; '.join(ms)}" for p, ms in lint_errs.items()) or "ошибок не найдено"
        user = f"КОНТРАКТ:\n{json.dumps(self.contract, ensure_ascii=False)}\n\nРЕЗУЛЬТАТЫ ЛИНТЕРА:\n{lint_txt}\n\nПРОЕКТ:\n{digest}\n\n{self.lang_line()}"
        try:
            data = await self.orch_json(REVIEW_SYSTEM, user, "ревью проекта")
        except Fatal as e:
            self.emit("log", level="warn", message=f"Ревью пропущено: {str(e)[:160]}")
            self.emit("review", state="result", ok=True, summary="Ревью пропущено (оркестратор недоступен)", issues=[])
            return
        issues = [i for i in (data.get("issues") or []) if isinstance(i, dict)][:4]
        ok = bool(data.get("ok", not issues)) and not issues
        self.emit("review", state="result", ok=ok, summary=str(data.get("summary", ""))[:400], issues=issues)
        self.emit("core_status", state="idle")
        if ok:
            return
        fixes, lvl = [], max((t["level"] for t in self.tasks.values()), default=0) + 1
        for k, i in enumerate(issues):
            files = [p for p in (sanitize_path(str(x)) for x in i.get("files", [])) if p in self.files][:3]
            if not files:
                continue
            ag = self.author.get(files[0]) if self.author.get(files[0]) in self.agents else self.agents[k % len(self.agents)]
            fixes.append({"id": f"fix{k+1}", "title": f"Правка: {files[0]}", "description": str(i.get("problem", ""))[:400],
                          "files": files, "depends_on": [], "agent": ag, "level": lvl,
                          "fix": f"{i.get('problem', '')}\nЧто сделать: {i.get('fix', '')}"})
        if fixes:
            for f in fixes:
                self.tasks[f["id"]] = f
            self.emit("tasks_added", tasks=fixes)
            self.emit("phase", phase="execute", label="Правки по ревью")
            await self.run_tasks(fixes)

    # ------------------------------------------------------------ упаковка
    def package(self) -> None:
        name = self.contract.get("project_name", "project")
        if "README.md" not in self.files:
            self.files["README.md"] = f"# {name}\n\n{self.contract.get('summary', '')}\n\nСтек: {self.contract.get('stack', '')}\n"
            self.emit("file", path="README.md", state="done", size=len(self.files["README.md"]), task_id=None, agent="orchestrator")
        d = RUNS_DIR / self.id
        d.mkdir(parents=True, exist_ok=True)
        self.zip_name = f"{name}.zip"
        self.zip_path = d / self.zip_name
        with zipfile.ZipFile(self.zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            for p, c in self.files.items():
                z.writestr(f"{name}/{p}", c)


def PROVIDER_ADAPTERS():
    from .providers import ADAPTERS
    return ADAPTERS


RUNS: dict[str, Run] = {}
