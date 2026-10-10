"""TrailTruth API (FastAPI). Endpoints exactly as in CONTRACT.md.

    uvicorn agent.api:app --port 8000          (or: python -m agent.dev)

Data sources, in order:
  /api/alerts, /api/parks : agent/state/processed/*.json (agent.refresh batch job) -> shared/fixtures
  /api/eval               : ml/results/eval.json -> shared/fixtures/eval.json
  /api/cards, /api/runs   : Temporal (TEMPORAL_ADDRESS). If Temporal is unreachable, POST /api/cards runs the
                            same pipeline inline (non-durable, labelled) and /api/runs serves cached runs/fixtures.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent import inline
from agent.config import (CARDS_DIR, CHAOS, FIXTURES_DIR, ML_EVAL, PROCESSED_DIR, RUNS_DIR, TEMPORAL_ADDRESS,
                          safe_name, setup_logging, temporal_client)
from agent.model import describe as model_describe, provider
from agent.telemetry import init_sentry

setup_logging("api")
init_sentry("api")
log = logging.getLogger("trailtruth")

app = FastAPI(title="TrailTruth API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"]
    + [o for o in os.environ.get("TRAILTRUTH_CORS_ORIGINS", "").split(",") if o],
    allow_origin_regex=r"https://([a-z0-9-]+\.)*(vercel\.app|onrender\.com)",
    allow_methods=["*"],
    allow_headers=["*"],
)

_client = None
_client_err_at = 0.0
_inline_tasks: set[asyncio.Task] = set()


async def get_client():
    """Cached Temporal client; after a failure, retry at most every 10s (keeps endpoints fast)."""
    global _client, _client_err_at
    if _client is not None:
        return _client
    if time.time() - _client_err_at < 10:
        return None
    try:
        _client = await asyncio.wait_for(temporal_client(), timeout=3)
        log.info("connected to Temporal at %s", TEMPORAL_ADDRESS)
    except Exception as e:
        _client_err_at = time.time()
        log.warning("Temporal unreachable at %s (%s) - inline mode", TEMPORAL_ADDRESS, type(e).__name__)
    return _client


def _read(name: str) -> tuple[object, str]:
    for p, src in ((PROCESSED_DIR / name, "processed"), (FIXTURES_DIR / name, "fixture")):
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8")), src
    raise HTTPException(404, f"{name} not found")


@app.get("/api/health")
async def health():
    client = await get_client()
    _, src = _read("alerts.json")
    meta = PROCESSED_DIR / "meta.json"
    return {
        "ok": True,
        "temporal": client is not None,
        "temporal_address": TEMPORAL_ADDRESS,
        "provider": provider(),
        "model": model_describe(),
        "chaos": CHAOS,
        "data_source": src,
        "refresh": json.loads(meta.read_text(encoding="utf-8")) if meta.exists() else None,
        "sentry": bool(os.environ.get("SENTRY_DSN")),
    }


@app.get("/api/parks")
async def parks(with_alerts: bool = Query(False, description="only parks that currently have alerts")):
    data, _ = _read("parks.json")
    if with_alerts:
        data = [p for p in data if p.get("alert_count")]
    return data


@app.get("/api/alerts")
async def alerts(park: str | None = None):
    data, _ = _read("alerts.json")
    if park:
        wanted = {p.strip().lower() for p in park.split(",")}
        data = [a for a in data if a["park_code"] in wanted]
    return data


class CardRequest(BaseModel):
    parks: list[str] = Field(min_length=1, max_length=6)


_PARK_RE = re.compile(r"^[a-z]{4}$")


@app.post("/api/cards")
async def create_card(req: CardRequest):
    parks = []
    for p in req.parks:
        p = p.strip().lower()
        if not _PARK_RE.match(p):
            raise HTTPException(422, f"invalid park code: {p!r}")
        if p not in parks:
            parks.append(p)
    client = await get_client()
    if client is not None:
        from agent.runs import start_card_workflow

        try:
            wid = await start_card_workflow(client, parks)
            log.info("started workflow %s parks=%s", wid, parks)
            return {"workflow_id": wid, "mode": "temporal"}
        except Exception as e:
            log.warning("start_workflow failed (%s) - falling back to inline", e)
    wid = inline.new_id(parks)
    inline.init_run(wid, parks)
    task = asyncio.create_task(asyncio.to_thread(inline.run_inline, wid, parks))
    _inline_tasks.add(task)
    task.add_done_callback(_inline_tasks.discard)
    return {"workflow_id": wid, "mode": "inline"}


def _cached_run(wid: str) -> dict | None:
    p = RUNS_DIR / f"{safe_name(wid)}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


@app.get("/api/cards/latest")
async def latest_card():
    p = CARDS_DIR / "latest.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return _read("card.json")[0]


@app.get("/api/cards/{workflow_id}")
async def get_card(workflow_id: str):
    if not re.match(r"^[A-Za-z0-9_.:-]{1,200}$", workflow_id):
        raise HTTPException(422, "bad workflow id")
    run = _cached_run(workflow_id)
    if run is None and not workflow_id.startswith("local-"):
        client = await get_client()
        if client is not None:
            from agent.runs import get_run

            try:
                run = await get_run(client, workflow_id)
            except Exception as e:
                if "not found" in str(e).lower():
                    raise HTTPException(404, "workflow not found")
                raise HTTPException(502, f"temporal error: {type(e).__name__}")
    if run is None:
        fx, _ = _read("card_status.json")
        if workflow_id == fx.get("workflow_id"):
            return fx
        raise HTTPException(404, "workflow not found")
    out = {"status": run["status"], "steps": run.get("steps", []), "workflow_id": workflow_id,
           "parks": run.get("parks", []), "started_at": run.get("started_at"), "ended_at": run.get("ended_at")}
    if run.get("card"):
        out["card"] = run["card"]
    if run.get("mode"):
        out["mode"] = run["mode"]
    return out


@app.get("/api/runs")
async def runs(limit: int = Query(20, ge=1, le=100)):
    client = await get_client()
    out: list[dict] = []
    if client is not None:
        from agent.runs import list_runs

        try:
            out = await asyncio.wait_for(list_runs(client, limit), timeout=10)
        except Exception as e:
            log.warning("list_runs failed: %s", e)
    seen = {safe_name(r["workflow_id"]) for r in out}
    for p in sorted(RUNS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        if p.stem not in seen and len(out) < limit:
            r = json.loads(p.read_text(encoding="utf-8"))
            r.pop("card", None)
            out.append(r)
    out = [r for r in out if r.get("steps") or r.get("status") == "running"]  # drop step-less legacy runs
    if not out:
        out, _ = _read("runs.json")
    out.sort(key=lambda r: r.get("started_at") or "", reverse=True)
    return out[:limit]


@app.get("/api/eval")
async def eval_results():
    if ML_EVAL.exists():
        return json.loads(ML_EVAL.read_text(encoding="utf-8"))
    return _read("eval.json")[0]
