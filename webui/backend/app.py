"""FastAPI backend for the TradingAgents web UI. Run: uvicorn app:app --port 8642"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))          # webui/backend
sys.path.insert(0, str(Path(__file__).parents[2]))      # repo root (tradingagents importable)

import store  # noqa: E402

store.ensure_dirs()
store.load_keys_into_env()

import tradingagents  # noqa: E402,F401  (loads repo .env; UI keys already win)
from fastapi import Depends, FastAPI, HTTPException, Query, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from runner import MANAGER  # noqa: E402

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="TradingAgents UI")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"], allow_headers=["*"],
)


def auth(request: Request, token: str | None = Query(default=None)) -> None:
    header = request.headers.get("authorization", "")
    bearer = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else None
    if not (store.verify_token(bearer) or store.verify_token(token)):
        raise HTTPException(status_code=401, detail="unauthorized")


# --- auth -------------------------------------------------------------------

class LoginBody(BaseModel):
    password: str


@app.get("/api/auth/status")
def auth_status():
    return {"setup": store.is_setup()}


@app.post("/api/auth/setup")
def auth_setup(body: LoginBody):
    if store.is_setup():
        raise HTTPException(status_code=400, detail="password already set")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="password must be at least 6 characters")
    store.set_password(body.password)
    return {"token": store.make_token()}


@app.post("/api/auth/login")
def auth_login(body: LoginBody):
    if not store.verify_password(body.password):
        raise HTTPException(status_code=401, detail="wrong password")
    return {"token": store.make_token()}


# --- settings / providers ---------------------------------------------------

@app.get("/api/settings", dependencies=[Depends(auth)])
def get_settings():
    from tradingagents.llm_clients.api_key_env import PROVIDER_API_KEY_ENV
    from tradingagents.llm_clients.model_catalog import MODEL_OPTIONS

    from tradingagents.llm_clients.openai_client import OPENAI_COMPATIBLE_PROVIDERS

    masked = store.key_status()
    providers = []
    for key, env_var in PROVIDER_API_KEY_ENV.items():
        spec = OPENAI_COMPATIBLE_PROVIDERS.get(key)
        key_optional = env_var is None or bool(spec and spec.key_optional)
        models = MODEL_OPTIONS.get(key, {})
        providers.append({
            "id": key,
            "env_var": env_var,
            "key_optional": key_optional,
            "key_set": bool(env_var and (masked.get(env_var) or __import__("os").environ.get(env_var))),
            "key_masked": masked.get(env_var, ""),
            "quick_models": [{"label": l, "value": v} for l, v in models.get("quick", [])],
            "deep_models": [{"label": l, "value": v} for l, v in models.get("deep", [])],
        })
    return {"providers": providers, "defaults": store.get_defaults()}


class KeyBody(BaseModel):
    env_var: str
    value: str


@app.put("/api/settings/keys", dependencies=[Depends(auth)])
def put_key(body: KeyBody):
    from tradingagents.llm_clients.api_key_env import PROVIDER_API_KEY_ENV
    allowed = {v for v in PROVIDER_API_KEY_ENV.values() if v} | {"FRED_API_KEY", "ALPHA_VANTAGE_API_KEY"}
    if body.env_var not in allowed:
        raise HTTPException(status_code=400, detail=f"unknown key env var: {body.env_var}")
    store.save_key(body.env_var, body.value.strip().replace(" ", ""))
    return {"ok": True}


class DefaultsBody(BaseModel):
    provider: str
    quick_model: str
    deep_model: str
    analysts: list[str]
    depth: int


@app.put("/api/settings/defaults", dependencies=[Depends(auth)])
def put_defaults(body: DefaultsBody):
    store.set_defaults(body.model_dump())
    return {"ok": True}


# --- symbol preview ---------------------------------------------------------

@app.get("/api/symbol/{symbol}", dependencies=[Depends(auth)])
def symbol_preview(symbol: str):
    from tradingagents.agents.utils.agent_utils import resolve_instrument_identity
    from tradingagents.dataflows.symbol_utils import normalize_symbol

    canonical = normalize_symbol(symbol)
    identity = resolve_instrument_identity(symbol) or {}
    last_close = None
    try:
        import yfinance as yf
        h = yf.Ticker(canonical).history(period="5d")
        if len(h):
            last_close = round(float(h["Close"].iloc[-1]), 2)
    except Exception:  # noqa: BLE001 - preview is best-effort
        pass
    return {"input": symbol, "canonical": canonical, "identity": identity, "last_close": last_close}


# --- runs -------------------------------------------------------------------

class RunBody(BaseModel):
    ticker: str
    date: str
    analysts: list[str]
    depth: int = 1
    provider: str
    quick_model: str
    deep_model: str
    language: str = "English"


@app.post("/api/runs", dependencies=[Depends(auth)])
def create_run(body: RunBody):
    from tradingagents.dataflows.utils import safe_ticker_component
    from tradingagents.llm_clients.api_key_env import get_api_key_env
    import os as _os

    ticker = body.ticker.strip().upper()
    try:
        safe_ticker_component(ticker)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not body.analysts:
        raise HTTPException(status_code=400, detail="select at least one analyst")
    env_var = get_api_key_env(body.provider)
    if env_var and not _os.environ.get(env_var):
        raise HTTPException(status_code=400, detail=f"{env_var} is not configured - add it in Settings")
    doc = MANAGER.start({**body.model_dump(), "ticker": ticker})
    return {"id": doc["id"]}


@app.get("/api/runs", dependencies=[Depends(auth)])
def runs_list():
    return {"runs": store.list_runs()}


@app.get("/api/runs/{run_id}", dependencies=[Depends(auth)])
def run_detail(run_id: str):
    live = MANAGER.get(run_id)
    doc = live.doc if live else store.get_run(run_id)
    if not doc:
        raise HTTPException(status_code=404, detail="run not found")
    return doc


@app.get("/api/runs/{run_id}/events", dependencies=[Depends(auth)])
async def run_events(run_id: str):
    run = MANAGER.get(run_id)
    if run is None:
        doc = store.get_run(run_id)
        if not doc:
            raise HTTPException(status_code=404, detail="run not found")

        async def replay():
            yield f"data: {json.dumps({'type': 'done' if doc['status'] == 'done' else 'error', 'rating': doc.get('rating'), 'direction': doc.get('direction'), 'confidence': doc.get('confidence'), 'message': doc.get('error')})}\n\n"
        return StreamingResponse(replay(), media_type="text/event-stream")

    async def stream():
        idx = 0
        while True:
            with run.cond:
                events = run.events[idx:]
                idx = len(run.events)
                done = run.done
            for ev in events:
                yield f"data: {json.dumps(ev)}\n\n"
            if done:
                return
            await asyncio.sleep(0.5)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# --- scorecard --------------------------------------------------------------

@app.get("/api/scorecard", dependencies=[Depends(auth)])
def scorecard():
    from tradingagents.agents.utils.memory import TradingMemoryLog
    from tradingagents.default_config import DEFAULT_CONFIG

    entries = TradingMemoryLog(DEFAULT_CONFIG).load_entries()
    resolved = [e for e in entries if not e["pending"]]
    pending = [e for e in entries if e["pending"]]

    def pct(v: str | None) -> float | None:
        try:
            return float(v.replace("%", "")) if v else None
        except (ValueError, AttributeError):
            return None

    directional = correct = 0
    for e in resolved:
        score = {"buy": 1, "overweight": 1, "sell": -1, "underweight": -1}.get(e["rating"].lower(), 0)
        alpha = pct(e["alpha"])
        if score and alpha is not None:
            directional += 1
            if score * alpha > 0:
                correct += 1
    return {
        "resolved": [{k: e[k] for k in ("date", "ticker", "rating", "raw", "alpha", "holding", "reflection")} for e in resolved],
        "pending": [{k: e[k] for k in ("date", "ticker", "rating")} for e in pending],
        "directional_calls": directional,
        "directional_correct": correct,
    }
