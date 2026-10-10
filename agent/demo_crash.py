"""Durability demo: kill the worker mid-run, restart it, watch the workflow resume where it left off.

    python -m agent.demo_crash                       # uses the server from `python -m agent.dev --server-only`
    python -m agent.demo_crash --parks havo yell zion --kill-after 6

Needs a Temporal server on TEMPORAL_ADDRESS (starts a throwaway dev server itself if none is running).
The worker is a real separate OS process; it is killed with SIGKILL / taskkill /F - no graceful shutdown.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
import sys
import threading
import time
from datetime import timezone

from agent.config import ROOT, TEMPORAL_ADDRESS, setup_logging, temporal_client
from agent.runs import new_workflow_id

T0 = time.time()
DEMO_QUEUE = f"trailtruth-demo-crash-{os.getpid()}"  # private queue: no stray worker can steal the work
REAL_PID: dict[str, str] = {}


def say(msg: str = "") -> None:
    print(f"[demo t+{time.time() - T0:5.1f}s] {msg}" if msg else "", flush=True)


def spawn_worker(tag: str, delay: float) -> subprocess.Popen:
    env = os.environ.copy()
    env.update(PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8", TRAILTRUTH_CLASSIFY_DELAY=str(delay),
               TRAILTRUTH_CHAOS="0", TRAILTRUTH_TASK_QUEUE=DEMO_QUEUE, TRAILTRUTH_LOG_LEVEL="INFO")
    p = subprocess.Popen([sys.executable, "-m", "agent.worker"], cwd=str(ROOT), env=env,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                         errors="replace")

    def pump():
        for line in p.stdout:  # type: ignore[union-attr]
            if "worker pid=" in line:
                REAL_PID[tag] = line.split("worker pid=")[1].split()[0]
            print(f"    {tag} | {line.rstrip()}", flush=True)

    threading.Thread(target=pump, daemon=True).start()
    return p


def hard_kill(p: subprocess.Popen) -> None:
    if os.name == "nt":  # kill the venv launcher AND the real interpreter it spawned
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)], capture_output=True)
    else:
        p.kill()
    p.wait(timeout=10)


async def progress(handle):
    from agent.workflows import TrailCardWorkflow

    try:
        return await asyncio.wait_for(handle.query(TrailCardWorkflow.progress), timeout=2)
    except Exception:
        return None


async def history_stats(handle, crash_ts: float):
    from temporalio.api.enums.v1 import EventType

    hist = await handle.fetch_history()
    sched: dict[int, str] = {}
    completed_before, completed_after, retried, n = 0, 0, 0, 0
    for ev in hist.events:
        n += 1
        if ev.event_type == EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED:
            sched[ev.event_id] = ev.activity_task_scheduled_event_attributes.activity_type.name
        elif ev.event_type == EventType.EVENT_TYPE_ACTIVITY_TASK_STARTED:
            a = ev.activity_task_started_event_attributes
            if sched.get(a.scheduled_event_id) == "classify_alert" and a.attempt > 1:
                retried += 1
        elif ev.event_type == EventType.EVENT_TYPE_ACTIVITY_TASK_COMPLETED:
            a = ev.activity_task_completed_event_attributes
            if sched.get(a.scheduled_event_id) != "classify_alert":
                continue
            t = ev.event_time.ToDatetime().replace(tzinfo=timezone.utc).timestamp()
            if t < crash_ts:
                completed_before += 1
            else:
                completed_after += 1
    n_classify = sum(1 for v in sched.values() if v == "classify_alert")
    return n, n_classify, completed_before, completed_after, retried


async def main_async(a) -> int:
    TASK_QUEUE = DEMO_QUEUE
    from agent.run_card import fmt_step, print_card
    from agent.workflows import TrailCardWorkflow

    env = None
    try:
        client = await temporal_client()
        await client.count_workflows()
    except Exception:
        from temporalio.testing import WorkflowEnvironment

        say("no Temporal server found - starting a throwaway local dev server")
        env = await WorkflowEnvironment.start_local(port=int(TEMPORAL_ADDRESS.rsplit(":", 1)[1]))
        client = await temporal_client()

    say(f"Temporal server: {TEMPORAL_ADDRESS}  (event history is the source of truth, not the worker)")
    from agent.model import describe

    m = describe()
    say(f"model: {m['provider']} / {m['model']}" + (f" + {a.delay}s simulated latency" if a.delay else ""))
    say("1) starting worker #1")
    w1 = spawn_worker("worker#1", a.delay)
    await asyncio.sleep(2.5)

    wid = new_workflow_id(a.parks)
    handle = await client.start_workflow(TrailCardWorkflow.run, a.parks, id=wid, task_queue=TASK_QUEUE,
                                         memo={"parks": a.parks})
    say(f"2) started TrailCardWorkflow  id={wid}  parks={a.parks}")

    # wait until a good chunk of the classification is done
    while True:
        p = await progress(handle)
        cs = next((s for s in p.steps if s.name == "classify_alerts"), None) if p else None
        if cs and cs.detail and cs.status == "running":
            done, total = (int(x) for x in cs.detail.split()[0].split("/"))
            if done >= a.kill_after or (total and done >= total - 2):
                break
        await asyncio.sleep(0.2)
    say("")
    say(f"3) progress before crash: classify_alerts {cs.detail}")
    for s in p.steps:
        print("   " + fmt_step(s.model_dump()).replace("\n", "\n   "), flush=True)
    say("")
    say(f"4) [CRASH] hard-killing worker #1 (pid {REAL_PID.get('worker#1', w1.pid)}) in the middle of "
        "classify_alerts - no graceful shutdown")
    crash_ts = time.time()
    hard_kill(w1)
    say("   worker #1 is dead. No process is running the agent right now.")

    desc = await handle.describe()
    pend = list(desc.raw_description.pending_activities)
    say(f"   Temporal says: workflow status={desc.status.name if desc.status else '?'}, "
        f"history length={desc.raw_description.workflow_execution_info.history_length}, "
        f"{len(pend)} classify_alert activities in flight (orphaned)")
    say(f"   waiting {a.downtime}s of downtime...")
    await asyncio.sleep(a.downtime)

    say("")
    say("5) starting worker #2 (fresh process, no memory of worker #1)")
    w2 = spawn_worker("worker#2", a.delay)
    say("   it replays the event history: finished activities are NOT re-run; orphaned in-flight ones are")
    say("   retried once their 5s heartbeat timeout fires.")
    card = await handle.result()
    await asyncio.sleep(0.5)
    p = await progress(handle)
    say("")
    say("6) workflow COMPLETED after the crash:")
    if p:
        for s in p.steps:
            print("   " + fmt_step(s.model_dump()).replace("\n", "\n   "), flush=True)
    n, n_cls, before, after, retried = await history_stats(handle, crash_ts)
    say("")
    say("7) proof from Temporal event history:")
    say(f"   classify_alert activities scheduled : {n_cls} (one per alert - none scheduled twice)")
    say(f"   completed before the crash          : {before}  (kept; not re-run by worker #2)")
    say(f"   completed after restart             : {after}")
    say(f"   activities that needed attempt >= 2  : {retried}  (in flight when worker #1 died)")
    say(f"   total history events                : {n}")
    print_card(card.model_dump(), out=lambda s: print("   " + s, flush=True))
    from agent.runs import get_run

    await get_run(client, wid)  # cache the run record (steps + workers) for /api/runs while worker #2 is alive
    hard_kill(w2)
    if env:
        await env.shutdown()
    say("done.")
    return 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parks", nargs="+", default=["havo", "yell", "zion"])
    ap.add_argument("--kill-after", type=int, default=8, help="kill once this many alerts are classified")
    ap.add_argument("--delay", type=float, default=None,
                    help="simulated model latency per alert (s); default 0 with a real model, 1.2 with heuristic")
    ap.add_argument("--downtime", type=float, default=3.0)
    setup_logging("demo", "WARNING")
    a = ap.parse_args()
    if a.delay is None:
        from agent.model import provider

        a.delay = 0.0 if provider() != "heuristic" else 1.2
    sys.exit(asyncio.run(main_async(a)))


if __name__ == "__main__":
    main()
