"""FastAPI: REST + WebSocket поток событий."""
from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import DEMO_MODE, PROVIDERS, ROOT, store
from .memory import memory
from .orchestrator import RUNS, Run

app = FastAPI(title="Agent Orchestra")


def _provider_info(pid: str, m: dict) -> dict:
    return {"id": pid, "name": PROVIDERS[pid]["name"], "has_key": bool(store.key(pid)),
            "key_source": store.key_source(pid), "key_hint": store.key_hint(pid),
            "model": store.models.get(pid, ""), "models": m["models"], "models_error": m["error"]}


@app.get("/api/settings")
async def get_settings(refresh: bool = False):
    import asyncio as aio
    res = await aio.gather(*(store.get_models(p, refresh) for p in PROVIDERS))
    prov = [_provider_info(p, m) for p, m in zip(PROVIDERS, res)]
    avail = [p["id"] for p in prov if p["has_key"]]
    op = store.orch.get("provider")
    return {"demo": DEMO_MODE, "providers": prov,
            "orchestrator": {"provider": op if op in avail else (avail[0] if avail else None),
                             "model": store.orch.get("model") or ""}}


class SettingsIn(BaseModel):
    keys: dict[str, str] = {}
    models: dict[str, str] = {}
    orchestrator: dict[str, str] | None = None


@app.post("/api/settings")
async def set_settings(body: SettingsIn):
    for pid, k in body.keys.items():
        if pid in PROVIDERS:
            if k.strip():
                store.ui_keys[pid] = k.strip()
            else:
                store.ui_keys.pop(pid, None)
    for pid, m in body.models.items():
        if pid in PROVIDERS and m:
            store.models[pid] = m
    if body.orchestrator is not None:
        store.orch["provider"] = body.orchestrator.get("provider") or None
        store.orch["model"] = body.orchestrator.get("model") or None
    refresh = bool(body.keys)
    return await get_settings(refresh=refresh)


class MemIn(BaseModel):
    text: str


@app.get("/api/memory")
async def mem_list():
    return {"items": memory.list()}


@app.post("/api/memory")
async def mem_add(body: MemIn):
    item = memory.add(body.text)
    if not item:
        raise HTTPException(400, "Слишком короткая или уже запомненная заметка")
    return {"item": item, "items": memory.list()}


@app.delete("/api/memory/{item_id}")
async def mem_del(item_id: str):
    if not memory.remove(item_id):
        raise HTTPException(404)
    return {"items": memory.list()}


@app.delete("/api/memory")
async def mem_clear():
    memory.clear()
    return {"items": []}


class RunIn(BaseModel):
    prompt: str
    history: list[dict] = []


@app.post("/api/runs")
async def create_run(body: RunIn):
    prompt = body.prompt.strip()
    if len(prompt) < 3:
        raise HTTPException(400, "Опишите, какой проект нужно создать")
    rid = uuid.uuid4().hex[:10]
    run = Run(rid, prompt[:4000], [m for m in body.history[-8:] if isinstance(m, dict)])
    RUNS[rid] = run
    run.task = asyncio.create_task(run.execute())
    return {"run_id": rid}


@app.post("/api/runs/{rid}/cancel")
async def cancel(rid: str):
    run = RUNS.get(rid)
    if not run:
        raise HTTPException(404)
    if run.task and not run.task.done():
        run.task.cancel()
    return {"ok": True}


@app.get("/api/runs/{rid}/file")
async def get_file(rid: str, path: str):
    run = RUNS.get(rid)
    if not run or path not in run.files:
        raise HTTPException(404)
    return {"path": path, "content": run.files[path]}


@app.get("/api/runs/{rid}/download")
async def download(rid: str):
    run = RUNS.get(rid)
    if not run or not run.zip_path or not Path(run.zip_path).exists():
        raise HTTPException(404, "ZIP ещё не готов")
    return FileResponse(run.zip_path, media_type="application/zip", filename=run.zip_name)


@app.websocket("/ws/runs/{rid}")
async def ws_run(ws: WebSocket, rid: str):
    await ws.accept()
    run = RUNS.get(rid)
    if not run:
        await ws.send_json({"type": "fatal", "message": "Миссия не найдена (сервер перезапускался?)"})
        await ws.close()
        return
    q: asyncio.Queue = asyncio.Queue()
    run.subs.add(q)
    snapshot, streams = list(run.history), dict(run.stream_text)
    try:
        await ws.send_json({"type": "replay_start"})
        for ev in snapshot:
            await ws.send_json(ev)
        await ws.send_json({"type": "stream_snapshot", "streams": streams})
        await ws.send_json({"type": "replay_end"})
        while True:
            await ws.send_json(await q.get())
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        run.subs.discard(q)


# Продакшен-режим: раздаём собранный фронтенд
DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="web")
