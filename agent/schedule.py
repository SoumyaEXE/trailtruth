"""Weekly TrailCard via a Temporal Schedule (Friday 07:00 local time by default).

    python -m agent.schedule create --parks havo chch [--tz America/Los_Angeles] [--cron "0 7 * * 5"]
    python -m agent.schedule trigger        # run it right now (demo)
    python -m agent.schedule describe
    python -m agent.schedule delete

The Schedule lives in the Temporal server, not in our process: if every worker is down at 07:00 Friday,
the run starts as soon as a worker comes back (catchup window 1 day). Overlap policy SKIP.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import timedelta

from temporalio.client import (Schedule, ScheduleActionStartWorkflow, ScheduleOverlapPolicy, SchedulePolicy,
                               ScheduleSpec, ScheduleState)

from agent.config import TASK_QUEUE, setup_logging, temporal_client

SCHEDULE_ID = "trailtruth-weekly"


async def main_async(a) -> None:
    from agent.workflows import TrailCardWorkflow

    client = await temporal_client()
    sid = a.id
    if a.cmd == "create":
        parks = [p.lower() for p in a.parks]
        handle = await client.create_schedule(
            sid,
            Schedule(
                action=ScheduleActionStartWorkflow(
                    TrailCardWorkflow.run, parks, id=f"weekly-trailcard-{'-'.join(parks)}", task_queue=TASK_QUEUE,
                    memo={"parks": parks}),
                spec=ScheduleSpec(cron_expressions=[a.cron], time_zone_name=a.tz),
                policy=SchedulePolicy(overlap=ScheduleOverlapPolicy.SKIP, catchup_window=timedelta(days=1)),
                state=ScheduleState(note=f"TrailTruth weekly card for {', '.join(parks)}"),
            ),
        )
        desc = await handle.describe()
        nxt = desc.info.next_action_times[:2]
        print(f"created schedule {sid}: cron '{a.cron}' ({a.tz}) parks={parks}")
        print("next runs:", ", ".join(t.isoformat() for t in nxt))
    elif a.cmd == "trigger":
        await client.get_schedule_handle(sid).trigger(overlap=ScheduleOverlapPolicy.ALLOW_ALL)
        print(f"triggered {sid} - see `python -m agent.schedule describe` or GET /api/runs")
    elif a.cmd == "describe":
        d = await client.get_schedule_handle(sid).describe()
        print(f"schedule {sid}: paused={d.schedule.state.paused} actions_taken={d.info.num_actions}")
        print("next runs:", ", ".join(t.isoformat() for t in d.info.next_action_times[:3]))
        for r in d.info.recent_actions[-5:]:
            print("recent:", r.started_at.isoformat(), getattr(r.action, "workflow_id", ""))
    elif a.cmd == "delete":
        await client.get_schedule_handle(sid).delete()
        print(f"deleted {sid}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["create", "trigger", "describe", "delete"])
    ap.add_argument("--id", default=SCHEDULE_ID)
    ap.add_argument("--parks", nargs="+", default=["havo", "chch"])
    ap.add_argument("--cron", default="0 7 * * 5", help="default: Fridays 07:00")
    ap.add_argument("--tz", default="America/Los_Angeles")
    setup_logging("schedule", "WARNING")
    asyncio.run(main_async(ap.parse_args()))


if __name__ == "__main__":
    main()
