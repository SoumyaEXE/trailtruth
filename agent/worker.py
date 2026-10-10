"""Temporal worker: hosts TrailCardWorkflow + activities on task queue `trailtruth`.

    python -m agent.worker            # connects to TEMPORAL_ADDRESS (default localhost:7233)
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
from datetime import timedelta

from agent.config import CHAOS, TASK_QUEUE, TEMPORAL_ADDRESS, setup_logging, temporal_client
from agent.telemetry import init_sentry

log = logging.getLogger("trailtruth")


async def run_worker() -> None:
    from temporalio.worker import Worker

    from agent.activities import ALL_ACTIVITIES
    from agent.model import provider
    from agent.workflows import TrailCardWorkflow, WeeklyScheduleWorkflow

    from agent import model

    if provider() == "tinker":
        log.info("warming up Tinker sampling client for %s ...", model.describe().get("model"))
        log.info("Tinker ready in %.1fs", await asyncio.to_thread(model.warmup))
    client = await temporal_client()
    worker = Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[TrailCardWorkflow, WeeklyScheduleWorkflow],
        activities=ALL_ACTIVITIES,
        max_concurrent_activities=16,
        # if a worker dies, its sticky workflow-task queue goes silent; fall back to the shared queue fast
        sticky_queue_schedule_to_start_timeout=timedelta(seconds=2),
    )
    log.info("worker pid=%d up: temporal=%s queue=%s provider=%s chaos=%s sentry=%s", os.getpid(),
             TEMPORAL_ADDRESS, TASK_QUEUE, provider(), "ON" if CHAOS else "off",
             "on" if os.environ.get("SENTRY_DSN") else "off")
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):  # Windows
            pass
    async with worker:
        try:
            await stop.wait()
        except asyncio.CancelledError:
            pass


def main() -> None:
    setup_logging("worker")
    init_sentry("worker")
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
