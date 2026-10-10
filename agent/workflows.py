"""TrailTruth durable agent: weekly go/no-go trail card, as a Temporal workflow.

    fetch_alerts(park) x N   (parallel; retry w/ exponential backoff; 4xx non-retryable)
      -> classify_alert(a) x M  (bounded parallelism; heartbeats; retry on timeout / invalid JSON)
      -> compose_card           (deterministic)
      -> publish_card           (atomic write)

Every completed activity result lives in Temporal's event history, so if the worker dies mid-run a
restarted worker replays the history and continues with only the unfinished activities.
The `progress` query exposes per-step status/attempts to the API.
"""
from __future__ import annotations

import asyncio
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    # activities pull in httpx, sentry, the model... pass them through the sandbox instead of re-importing
    from agent.activities import classify_alert, compose_card, fetch_alerts, publish_card
    from agent.activities import CLASSIFY_MAX_ATTEMPTS
    from agent.models import ClassifyInput, ComposeInput, Progress, Step
    from shared.schema import ProcessedAlert, TrailCard

FETCH_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=1),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=20),
    maximum_attempts=6,
    non_retryable_error_types=["NpsClientError"],
)
CLASSIFY_RETRY = RetryPolicy(
    initial_interval=timedelta(milliseconds=500),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=10),
    maximum_attempts=CLASSIFY_MAX_ATTEMPTS,
)
SIMPLE_RETRY = RetryPolicy(initial_interval=timedelta(seconds=1), maximum_attempts=5)
MAX_PARALLEL_CLASSIFY = 6


def _cause(e: BaseException) -> str:
    while getattr(e, "cause", None) is not None:
        e = e.cause  # type: ignore[assignment]
    return str(e)


@workflow.defn
class TrailCardWorkflow:
    def __init__(self) -> None:
        self._p: Progress | None = None

    # ------------------------------------------------------------------ helpers
    def _ts(self) -> str:
        return workflow.now().isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def _step(self, name: str) -> Step:
        assert self._p
        for s in self._p.steps:
            if s.name == name:
                return s
        s = Step(name=name)
        self._p.steps.append(s)
        return s

    def _start(self, name: str, detail: str | None = None) -> Step:
        s = self._step(name)
        s.status, s.started_at, s.attempt = "running", self._ts(), max(s.attempt, 1)
        if detail:
            s.detail = detail
        return s

    def _done(self, name: str, attempt: int = 1, detail: str | None = None) -> None:
        s = self._step(name)
        s.status, s.ended_at, s.attempt = "completed", self._ts(), max(s.attempt, attempt)
        if detail:
            s.detail = detail
        if attempt > 1 and not s.error:
            s.error = f"succeeded on attempt {attempt} after {attempt - 1} retr{'y' if attempt == 2 else 'ies'}"

    def _fail(self, name: str, err: str) -> None:
        s = self._step(name)
        s.status, s.ended_at, s.error = "failed", self._ts(), err[:300]

    # ------------------------------------------------------------------ query
    @workflow.query
    def progress(self) -> Progress | None:
        return self._p

    # ------------------------------------------------------------------ run
    @workflow.run
    async def run(self, parks: list[str]) -> TrailCard:
        parks = [p.strip().lower() for p in parks if p.strip()][:6]
        wid = workflow.info().workflow_id
        self._p = Progress(workflow_id=wid, parks=parks, started_at=self._ts())
        for p in parks:
            self._step(f"fetch_alerts:{p}")
        for n in ("classify_alerts", "compose_card", "publish_card"):
            self._step(n)
        workflow.logger.info("TrailCardWorkflow %s parks=%s", wid, parks)

        # 1) fetch alerts per park, in parallel ---------------------------------------------
        async def fetch(p: str):
            self._start(f"fetch_alerts:{p}")
            try:
                r = await workflow.execute_activity(
                    fetch_alerts, p, start_to_close_timeout=timedelta(seconds=45), retry_policy=FETCH_RETRY)
                self._done(f"fetch_alerts:{p}", r.attempt, f"{len(r.alerts)} alerts, source={r.source}")
                return r
            except ActivityError as e:
                self._fail(f"fetch_alerts:{p}", _cause(e))
                return None

        fetched = await asyncio.gather(*(fetch(p) for p in parks))
        park_names = {p: p.upper() for p in parks}
        failed = [p for p, r in zip(parks, fetched) if r is None]
        raw: list[tuple[dict, str]] = []
        seen: set[str] = set()
        for r in fetched:
            if r is None:
                continue
            park_names[r.park] = r.park_name
            for a in r.alerts:
                if a.get("id") and a["id"] not in seen:
                    seen.add(a["id"])
                    raw.append((a, r.park_name))

        # 2) classify every alert with the model (bounded parallelism) ------------------------
        cs = self._start("classify_alerts", f"0/{len(raw)} alerts")
        sem = asyncio.Semaphore(MAX_PARALLEL_CLASSIFY)
        results: list[ProcessedAlert] = []
        retried = 0
        fallbacks = 0

        async def classify(a: dict, park_name: str):
            nonlocal retried, fallbacks
            async with sem:
                try:
                    r = await workflow.execute_activity(
                        classify_alert, ClassifyInput(workflow_id=wid, alert=a, park_name=park_name),
                        start_to_close_timeout=timedelta(seconds=90),  # real model calls; heartbeat catches hangs
                        heartbeat_timeout=timedelta(seconds=5),
                        retry_policy=CLASSIFY_RETRY)
                except ActivityError as e:
                    workflow.logger.warning("classify failed permanently for %s: %s", a.get("id"), _cause(e))
                    return
                results.append(r.alert)
                cs.attempt = max(cs.attempt, r.attempt)
                retried += r.attempt > 1
                fallbacks += r.fallback
                cs.detail = f"{len(results)}/{len(raw)} alerts"

        await asyncio.gather(*(classify(a, pn) for a, pn in raw))
        notes = []
        if retried:
            notes.append(f"{retried} alert(s) needed retries")
        if fallbacks:
            notes.append(f"{fallbacks} answered by heuristic fallback")
        if len(results) < len(raw):
            notes.append(f"{len(raw) - len(results)} alert(s) skipped after max retries")
        cs.error = "; ".join(notes) or None
        self._done("classify_alerts", cs.attempt, f"{len(results)}/{len(raw)} alerts")

        # keep a stable order so the card is deterministic on replay
        order = {a[0]["id"]: i for i, a in enumerate(raw)}
        results.sort(key=lambda x: order.get(x.id, 0))

        # 3) compose ---------------------------------------------------------------------
        self._start("compose_card")
        card = await workflow.execute_activity(
            compose_card,
            ComposeInput(parks=parks, park_names=park_names, alerts=results, workflow_id=wid,
                         generated_at=self._ts(), failed_parks=failed),
            start_to_close_timeout=timedelta(seconds=20), retry_policy=SIMPLE_RETRY)
        self._done("compose_card")

        # 4) publish ---------------------------------------------------------------------
        self._start("publish_card")
        pub = await workflow.execute_activity(
            publish_card, card, start_to_close_timeout=timedelta(seconds=20), retry_policy=SIMPLE_RETRY)
        self._done("publish_card", pub.attempt, pub.card_id)

        self._p.card = card
        self._p.status = "completed"
        return card


@workflow.defn
class WeeklyScheduleWorkflow:
    """Fallback for environments without Schedules: loops forever, one TrailCard per week via a child
    workflow, using a durable timer (survives restarts) and continue-as-new to keep history small.
    Prefer the Temporal Schedule created by `python -m agent.schedule create`."""

    @workflow.run
    async def run(self, parks: list[str]) -> None:
        now = workflow.now()
        # next Friday 07:00 UTC-7 (14:00 UTC) - simple, deterministic
        days = (4 - now.weekday()) % 7
        target = now.replace(hour=14, minute=0, second=0, microsecond=0) + timedelta(days=days)
        if target <= now:
            target += timedelta(days=7)
        await workflow.sleep(target - now)
        await workflow.execute_child_workflow(
            TrailCardWorkflow.run, parks,
            id=f"weekly-trailcard-{'-'.join(parks)}-{target.date().isoformat()}")
        workflow.continue_as_new(parks)
