"""Degraded mode: run the TrailCard pipeline in-process when no Temporal server is reachable.

Same steps and output shape as the workflow, but NOT durable (no retries across process death).
Used only by the API so a static/free deploy still answers POST /api/cards. Clearly labelled
`"mode": "inline (no Temporal)"` in the run record.
"""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone

from agent import compose, model, nps
from agent.config import CARDS_DIR, RUNS_DIR


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id(parks: list[str]) -> str:
    return f"local-{datetime.now(timezone.utc):%Y-%m-%d}-{'-'.join(parks)}-{secrets.token_hex(2)}"


def _save(run: dict) -> None:
    (RUNS_DIR / f"{run['workflow_id']}.json").write_text(json.dumps(run, ensure_ascii=False, indent=1),
                                                         encoding="utf-8")


def init_run(wid: str, parks: list[str]) -> dict:
    run = {"workflow_id": wid, "status": "running", "parks": parks, "started_at": _ts(), "ended_at": None,
           "mode": "inline (no Temporal)",
           "steps": [{"name": n, "status": "pending", "attempt": 0, "started_at": None, "ended_at": None}
                     for n in [f"fetch_alerts:{p}" for p in parks] + ["classify_alerts", "compose_card",
                                                                       "publish_card"]]}
    _save(run)
    return run


def run_inline(wid: str, parks: list[str]) -> dict:
    run = json.loads((RUNS_DIR / f"{wid}.json").read_text(encoding="utf-8"))
    steps = {s["name"]: s for s in run["steps"]}

    def start(n):
        steps[n].update(status="running", attempt=1, started_at=_ts())
        _save(run)

    def done(n, detail=None, status="completed", error=None):
        steps[n].update(status=status, ended_at=_ts())
        if detail:
            steps[n]["detail"] = detail
        if error:
            steps[n]["error"] = error
        _save(run)

    names = nps.park_names()
    raw, failed = [], []
    for p in parks:
        start(f"fetch_alerts:{p}")
        try:
            alerts, src = nps.fetch_park_alerts(p, fallback_on_any=True)
            raw.extend(alerts)
            done(f"fetch_alerts:{p}", f"{len(alerts)} alerts, source={src}")
        except Exception as e:
            failed.append(p)
            done(f"fetch_alerts:{p}", status="failed", error=nps.redact(str(e))[:240])
    start("classify_alerts")
    processed, seen = [], set()
    for a in raw:
        if a["id"] in seen:
            continue
        seen.add(a["id"])
        v, ms, name = model.classify(a.get("title", ""), a.get("description", ""))
        processed.append(model.to_processed(a, v, ms, name, names))
    done("classify_alerts", f"{len(processed)}/{len(seen)} alerts")
    start("compose_card")
    card = compose.compose_card(parks, names, processed, wid, _ts(), failed)
    done("compose_card")
    start("publish_card")
    (CARDS_DIR / f"{wid}.json").write_text(json.dumps(card.model_dump(), ensure_ascii=False, indent=1),
                                           encoding="utf-8")
    done("publish_card", card.id)
    run.update(status="completed", ended_at=_ts(), card=card.model_dump())
    _save(run)
    return run
