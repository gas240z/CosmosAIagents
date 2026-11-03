#!/usr/bin/env python3
"""Запуск Agent Orchestra одной командой:  python run.py   (dev: бэкенд :8000 + фронтенд :5173)
                                           python run.py --prod  (сборка фронтенда и всё на :8000)
                                           python run.py --demo  (имитация провайдеров, ключи не нужны)"""
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACK, FRONT = ROOT / "backend", ROOT / "frontend"
WIN = os.name == "nt"
NPM = shutil.which("npm.cmd" if WIN else "npm") or shutil.which("npm")


def run(cmd, cwd, **kw):
    return subprocess.run(cmd, cwd=cwd, check=True, **kw)


def ensure_deps():
    try:
        import fastapi, uvicorn, httpx, dotenv  # noqa: F401
    except ImportError:
        print("→ Устанавливаю Python-зависимости…")
        run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"], BACK)
    if not NPM:
        sys.exit("Не найден Node.js/npm. Установите Node 18+ с https://nodejs.org и повторите.")
    if not (FRONT / "node_modules").exists():
        print("→ Устанавливаю npm-зависимости (один раз)…")
        run([NPM, "install", "--no-audit", "--no-fund"], FRONT)


def main():
    prod = "--prod" in sys.argv
    if "--demo" in sys.argv:
        os.environ["DEMO_MODE"] = "1"
    if not (ROOT / ".env").exists() and "--demo" not in sys.argv:
        print("⚠ Файл .env не найден — скопируйте .env.example в .env и впишите ключи (или используйте --demo).")
    ensure_deps()
    procs = []
    try:
        if prod:
            print("→ Собираю фронтенд…")
            run([NPM, "run", "build"], FRONT)
        procs.append(subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], cwd=BACK))
        url = "http://localhost:8000"
        if not prod:
            procs.append(subprocess.Popen([NPM, "run", "dev", "--", "--host", "127.0.0.1"], cwd=FRONT))
            url = "http://localhost:5173"
        threading.Thread(target=lambda: (time.sleep(3.5), webbrowser.open(url)), daemon=True).start()
        print(f"\n🚀 Agent Orchestra: {url}   (Ctrl+C — остановить)\n")
        while all(p.poll() is None for p in procs):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            if p.poll() is None:
                p.terminate()
        for p in procs:
            try:
                p.wait(5)
            except Exception:  # noqa: BLE001
                p.kill()


if __name__ == "__main__":
    main()
