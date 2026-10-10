"""Temporal activities: the flaky, side-effecting parts of the TrailTruth agent.

fetch_alerts(park)     NPS API (flaky, rate limited)  -> retried w/ backoff, 4xx non-retryable, 429 -> snapshot
classify_alert(input)  model call (timeouts / invalid JSON) -> retried, heartbeats, heuristic on last attempt
compose_card(input)    deterministic aggregation (pure)
publish_card(card)     writes agent/state/cards/{id}.json

TRAILTRUTH_CHAOS=1 injects fake NPS 503s (~30%) and model timeouts / invalid JSON so the retries are visible.
Chaos only fires on attempts 1-2 so a demo run always converges.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import time
from datetime import datetime, timezone

import httpx
from temporalio import activity
from temporalio.exceptions import ApplicationError

from agent import compose, heuristic, model, nps
from agent.config import CARDS_DIR, CHAOS, RUNS_DIR, safe_name
from agent.models import ClassifyInput, ClassifyResult, ComposeInput, FetchResult, PublishResult
from agent.telemetry import activity_span
from shared.schema import TrailCard, TrailVerdict

log = logging.getLogger("trailtruth")

CLASSIFY_DELAY_S = float(os.environ.get("TRAILTRUTH_CLASSIFY_DELAY", "0"))  # simulate model latency (demo)
CLASSIFY_MAX_ATTEMPTS = 5
CHAOS_503_P = float(os.environ.get("TRAILTRUTH_CHAOS_503_P", "0.30"))
CHAOS_HANG_P = float(os.environ.get("TRAILTRUTH_CHAOS_HANG_P", "0.08"))
CHAOS_JSON_P = float(os.environ.get("TRAILTRUTH_CHAOS_JSON_P", "0.10"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def record_event(step: str, attempt: int, kind: str, msg: str = "") -> None:
    """Append-only per-workflow event log; the API merges it into step status (errors of retried attempts)."""
    info = activity.info()
    if not info.workflow_id:
        return
    try:  # observability must never fail the activity
        with open(RUNS_DIR / f"{safe_name(info.workflow_id)}.events.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": _now(), "step": step, "attempt": attempt, "kind": kind, "msg": msg}) + "\n")
    except OSError as e:
        log.warning("could not record event: %s", e)


def _chaos(p: float, key: str) -> bool:
    if not CHAOS:
        return False
    info = activity.info()
    if info.attempt > 2:
        return False
    return random.Random(f"{info.workflow_id}:{key}:{info.attempt}:{time.time_ns()}").random() < p


# --------------------------------------------------------------------------------------------- fetch
@activity.defn
async def fetch_alerts(park: str) -> FetchResult:
    info = activity.info()
    step = f"fetch_alerts:{park}"
    activity.heartbeat(park)  # lets the API map a pending/retrying activity back to its park
    log.info("[fetch_alerts] park=%s attempt=%d", park, info.attempt)
    with activity_span("gen_ai.execute_tool", "execute_tool fetch_alerts", **{"gen_ai.tool.name": "fetch_alerts",
                                                                           "park": park}):
        try:
            if _chaos(CHAOS_503_P, park):
                await asyncio.sleep(0.2)
                raise ApplicationError("NPS API HTTP 503 Service Unavailable (chaos)", type="NpsUnavailable")
            # live -> cache -> snapshot ladder; after 3 failed attempts accept stale data rather than no card
            alerts, source = await asyncio.to_thread(
                nps.fetch_park_alerts, park, fallback_on_any=info.attempt >= 4)
        except ApplicationError as e:
            record_event(step, info.attempt, "error", str(e))
            log.warning("[fetch_alerts] park=%s attempt=%d FAILED: %s -> Temporal will retry with backoff",
                        park, info.attempt, e)
            raise
        except nps.NpsHttpError as e:
            record_event(step, info.attempt, "error", str(e))
            if 400 <= e.status < 500:
                log.error("[fetch_alerts] park=%s HTTP %d -> non-retryable", park, e.status)
                raise ApplicationError(str(e), type="NpsClientError", non_retryable=True) from e
            log.warning("[fetch_alerts] park=%s attempt=%d FAILED: %s -> retry", park, info.attempt, e)
            raise ApplicationError(str(e), type="NpsUnavailable") from e
        except httpx.HTTPError as e:
            msg = nps.redact(f"{type(e).__name__}: {e}")
            record_event(step, info.attempt, "error", msg)
            log.warning("[fetch_alerts] park=%s attempt=%d network error: %s -> retry", park, info.attempt, msg)
            raise ApplicationError(msg, type="NpsNetworkError") from e
    names = nps.park_names()
    if source.startswith(("stale-cache", "snapshot")):
        log.warning("[fetch_alerts] park=%s live NPS unavailable -> degraded to %s", park, source)
    log.info("[fetch_alerts] park=%s OK: %d alerts (source=%s, attempt %d)", park, len(alerts), source, info.attempt)
    record_event(step, info.attempt, "ok", f"{len(alerts)} alerts, source={source}")
    return FetchResult(park=park, park_name=names.get(park, park.upper()), alerts=alerts, source=source,
                       attempt=info.attempt)


# ------------------------------------------------------------------------------------------ classify
async def _heartbeat_while(coro, every: float = 1.0):
    task = asyncio.ensure_future(coro)
    while not task.done():
        activity.heartbeat()
        await asyncio.wait({task}, timeout=every)
    return task.result()


@activity.defn
async def classify_alert(inp: ClassifyInput) -> ClassifyResult:
    info = activity.info()
    a = inp.alert
    aid = a.get("id", "?")[:8]
    step = f"classify_alert:{a.get('id', '?')}"
    title, desc = a.get("title", ""), a.get("description", "")
    last_attempt = info.attempt >= CLASSIFY_MAX_ATTEMPTS
    with activity_span("gen_ai.invoke_agent", "invoke_agent TrailTruth", alert_id=a.get("id", ""),
                       attempt=info.attempt):
        try:
            if _chaos(CHAOS_HANG_P, aid):
                log.warning("[classify_alert] %s attempt=%d model hung (chaos) - no heartbeat -> heartbeat timeout",
                            aid, info.attempt)
                record_event(step, info.attempt, "error", "model call hung; heartbeat timeout (chaos)")
                await asyncio.sleep(8)  # stop heartbeating; server times us out after heartbeat_timeout (5s)
                activity.heartbeat()     # server already retried this elsewhere -> SDK delivers cancellation
                await asyncio.sleep(2)
                raise ApplicationError("model call hung (chaos)", type="ModelTimeout")
            if _chaos(CHAOS_JSON_P, aid + "json"):
                raise ApplicationError("model returned invalid JSON: '{\"hazard_type\": \"wildlife\", \"sev' (chaos)",
                                       type="InvalidModelJSON")
            if CLASSIFY_DELAY_S:
                await _heartbeat_while(asyncio.sleep(CLASSIFY_DELAY_S * random.uniform(0.6, 1.4)))
            if last_attempt and model.provider() != "heuristic":
                verdict, ms, name = await asyncio.to_thread(heuristic.classify, title, desc)
                fallback = True
            else:
                verdict, ms, name = await _heartbeat_while(asyncio.to_thread(model.classify, title, desc))
                fallback = False
            if not isinstance(verdict, TrailVerdict):
                verdict = TrailVerdict.model_validate(verdict)
        except ApplicationError as e:
            record_event(step, info.attempt, "error", str(e))
            log.warning("[classify_alert] %s attempt=%d FAILED: %s -> retry", aid, info.attempt, e)
            raise
        except (ValueError, TimeoutError) as e:  # pydantic ValidationError is a ValueError
            record_event(step, info.attempt, "error", f"{type(e).__name__}: {e}"[:300])
            raise ApplicationError(f"invalid model output: {e}"[:300], type="InvalidModelJSON") from e
    processed = model.to_processed(a, verdict, ms, name, {a.get("parkCode", "").split(",")[0]: inp.park_name})
    if info.attempt > 1:
        log.info("[classify_alert] %s OK on attempt %d -> %s (%s)", aid, info.attempt, verdict.decision,
                 verdict.hazard_type)
    record_event(step, info.attempt, "ok", verdict.decision)
    return ClassifyResult(alert=processed, attempt=info.attempt, fallback=fallback)


# ------------------------------------------------------------------------------------- compose/publish
@activity.defn
async def compose_card(inp: ComposeInput) -> TrailCard:
    card = compose.compose_card(inp.parks, inp.park_names, inp.alerts, inp.workflow_id, inp.generated_at,
                                inp.failed_parks)
    log.info("[compose_card] %s overall=%s parks=%s", card.id, card.overall,
             ", ".join(f"{p.park_code}:{p.decision}" for p in card.parks))
    record_event("compose_card", activity.info().attempt, "ok", card.overall)
    return card


@activity.defn
async def publish_card(card: TrailCard) -> PublishResult:
    CARDS_DIR.mkdir(parents=True, exist_ok=True)
    body = json.dumps(card.model_dump(), ensure_ascii=False, indent=1)
    for name in (f"{card.id}.json", f"{safe_name(card.workflow_id)}.json", "latest.json"):
        tmp = CARDS_DIR / (name + ".tmp")
        tmp.write_text(body, encoding="utf-8")
        tmp.replace(CARDS_DIR / name)  # atomic: a crash never leaves a half-written card
    log.info("[publish_card] wrote agent/state/cards/%s.json", card.id)
    record_event("publish_card", activity.info().attempt, "ok", card.id)
    return PublishResult(card_id=card.id, path=str(CARDS_DIR / f"{card.id}.json"), attempt=activity.info().attempt)


ALL_ACTIVITIES = [fetch_alerts, classify_alert, compose_card, publish_card]
