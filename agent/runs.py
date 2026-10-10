"""Turn a Temporal workflow into the API's run shape:
    {workflow_id, status, parks, started_at, ended_at, card?, steps:[{name,status,attempt,started_at,ended_at,error?,detail?}]}

Sources merged (most authoritative last):
  1. workflow `progress` query (step list the workflow maintains itself)
  2. describe() pending activities  -> live attempt number + last failure while an activity is retrying
  3. agent/state/runs/{wid}.events.jsonl -> error text of attempts that later succeeded
Completed runs are cached to agent/state/runs/{wid}.json.
"""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta, timezone

from agent.config import RUNS_DIR, TASK_QUEUE, safe_name

STATUS = {1: "running", 2: "completed", 3: "failed", 4: "canceled", 5: "terminated", 6: "continued_as_new",
          7: "timed_out"}


def new_workflow_id(parks: list[str]) -> str:
    d = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"trailcard-{d}-{'-'.join(parks)}-{secrets.token_hex(2)}"


def _events(wid: str) -> list[dict]:
    p = RUNS_DIR / f"{safe_name(wid)}.events.jsonl"
    if not p.exists():
        return []
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return out


def _iso(ts) -> str | None:
    if ts is None:
        return None
    return ts.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def polish(run: dict) -> dict:
    """Prefer the real failure text over the workflow's generic 'succeeded on attempt N' note."""
    for st in run.get("steps", []):
        errs = st.get("attempt_errors") or []
        if errs and (not st.get("error") or st["error"].startswith("succeeded on attempt")):
            tail = f" -> succeeded on attempt {st['attempt']}" if st.get("status") == "completed" else ""
            st["error"] = (errs[0] + (f" (+{len(errs) - 1} more)" if len(errs) > 1 else "") + tail)[:300]
    return run


async def start_card_workflow(client, parks: list[str], workflow_id: str | None = None) -> str:
    from agent.workflows import TrailCardWorkflow

    wid = workflow_id or new_workflow_id(parks)
    await client.start_workflow(TrailCardWorkflow.run, parks, id=wid, task_queue=TASK_QUEUE,
                                memo={"parks": parks})
    return wid


async def get_run(client, wid: str, include_card: bool = True) -> dict:
    cache = RUNS_DIR / f"{safe_name(wid)}.json"
    if cache.exists():
        run = polish(json.loads(cache.read_text(encoding="utf-8")))
        if not include_card:
            run.pop("card", None)
        return run

    from agent.workflows import TrailCardWorkflow

    handle = client.get_workflow_handle(wid)
    desc = await handle.describe()
    status = STATUS.get(int(desc.status or 1), "running") if desc.status else "running"
    run: dict = {"workflow_id": wid, "status": status, "parks": [], "started_at": _iso(desc.start_time),
                 "ended_at": _iso(desc.close_time), "steps": []}
    try:
        memo = await desc.memo()
        run["parks"] = memo.get("parks", [])
    except Exception:
        pass

    prog = None
    try:
        prog = await handle.query(TrailCardWorkflow.progress, rpc_timeout=timedelta(seconds=3))
    except Exception as e:  # no worker yet / workflow task not started
        run["note"] = f"progress unavailable: {type(e).__name__}"
    if prog is not None:
        run["parks"] = prog.parks
        run["steps"] = [s.model_dump() for s in prog.steps]
        if prog.card is not None:
            run["card"] = prog.card.model_dump()

    # live retry info from pending activities
    pend = list(desc.raw_description.pending_activities)
    by_step: dict[str, dict] = {s["name"]: s for s in run["steps"]}
    classify_attempt = 0
    classify_err = None
    for pa in pend:
        atype = pa.activity_type.name
        err = pa.last_failure.message if pa.HasField("last_failure") else None
        if atype == "fetch_alerts":
            park = ""
            try:
                park = json.loads(pa.heartbeat_details.payloads[0].data) if pa.heartbeat_details.payloads else ""
            except Exception:
                pass
            # find the running fetch step(s); park can't be read from pending info reliably, mark all running
            for s in run["steps"]:
                if s["name"].startswith("fetch_alerts:") and s["status"] == "running" and (not park or park in s["name"]):
                    s["attempt"] = max(s["attempt"], pa.attempt)
                    if pa.attempt > 1:
                        s["status"] = "retrying"
                        s["error"] = err
        elif atype == "classify_alert":
            if pa.attempt > classify_attempt:
                classify_attempt, classify_err = pa.attempt, err
    if classify_attempt and "classify_alerts" in by_step:
        s = by_step["classify_alerts"]
        s["attempt"] = max(s["attempt"], classify_attempt)
        if classify_attempt > 1 and s["status"] == "running":
            s["status"] = "retrying"
            s["error"] = classify_err

    # error text of attempts that eventually succeeded
    for ev in _events(wid):
        if ev.get("kind") != "error":
            continue
        name = ev["step"] if not ev["step"].startswith("classify_alert:") else "classify_alerts"
        s = by_step.get(name)
        if s is None:
            continue
        s.setdefault("attempt_errors", [])
        if len(s["attempt_errors"]) < 5:
            s["attempt_errors"].append(f"attempt {ev['attempt']}: {ev['msg']}"[:240])
        if s["status"] in ("completed", "retrying") and not s.get("error"):
            s["error"] = f"attempt {ev['attempt']}: {ev['msg']}"[:240]

    if status == "completed" and "card" not in run:
        try:
            card = await handle.result()
            run["card"] = card.model_dump()
        except Exception:
            pass
    if status != "running":
        try:  # which worker processes touched this run? >1 means it survived a worker crash/restart
            from temporalio.api.enums.v1 import EventType

            ids: list[str] = []
            hist = await handle.fetch_history()
            for ev in hist.events:
                if ev.event_type == EventType.EVENT_TYPE_WORKFLOW_TASK_STARTED:
                    ident = ev.workflow_task_started_event_attributes.identity
                elif ev.event_type == EventType.EVENT_TYPE_ACTIVITY_TASK_STARTED:
                    ident = ev.activity_task_started_event_attributes.identity
                else:
                    continue
                if ident and ident not in ids:
                    ids.append(ident)
            run["workers"] = ids
            run["resumed_after_crash"] = len(ids) > 1
            run["history_events"] = len(hist.events)
        except Exception:
            pass
    if status in ("completed", "failed", "terminated", "canceled", "timed_out"):
        cache.write_text(json.dumps(run, ensure_ascii=False, indent=1), encoding="utf-8")
    polish(run)
    if not include_card:
        run.pop("card", None)
    return run


async def list_runs(client, limit: int = 20) -> list[dict]:
    out = []
    async for wf in client.list_workflows('WorkflowType="TrailCardWorkflow"', limit=limit):
        try:
            out.append(await get_run(client, wf.id, include_card=False))
        except Exception as e:
            out.append({"workflow_id": wf.id, "status": STATUS.get(int(wf.status or 1), "unknown"),
                        "steps": [], "note": f"{type(e).__name__}"})
        if len(out) >= limit:
            break
    return out
