"""Paths + env config shared by every agent/ module."""
from __future__ import annotations

import os
import sys
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent
ROOT = AGENT_DIR.parent
if str(ROOT) not in sys.path:  # make `shared` and `ml` importable however we're launched
    sys.path.insert(0, str(ROOT))

try:  # repo-root .env (gitignored) holds NPS_API_KEY etc. Never log its values.
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env", override=False)
    load_dotenv(AGENT_DIR / ".env", override=False)
except ImportError:
    pass

# tinker_cookbook pulls in transformers; the Temporal sandbox pokes its lazy aliases on every workflow run and
# transformers logs a warning per alias. Keep worker logs readable.
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")
os.environ.setdefault("HF_HUB_VERBOSITY", "error")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

CACHE_DIR = AGENT_DIR / "cache"            # raw NPS responses (disk cache, DEMO_KEY is rate limited)
STATE_DIR = AGENT_DIR / "state"            # runtime output (git-ignored)
CARDS_DIR = STATE_DIR / "cards"            # published TrailCards
RUNS_DIR = STATE_DIR / "runs"              # per-workflow step logs written by activities
PROCESSED_DIR = STATE_DIR / "processed"    # refresh.py output served by /api/alerts + /api/parks
FIXTURES_DIR = ROOT / "shared" / "fixtures"
WEB_FIXTURES_DIR = ROOT / "web" / "public" / "fixtures"
ML_EVAL = ROOT / "ml" / "results" / "eval.json"
RAW_ALERTS = ROOT / "data" / "raw" / "alerts.json"

NPS_API_KEY = os.environ.get("NPS_API_KEY") or "DEMO_KEY"
NPS_BASE = "https://developer.nps.gov/api/v1"

TEMPORAL_ADDRESS = os.environ.get("TEMPORAL_ADDRESS", "localhost:7233")
TEMPORAL_NAMESPACE = os.environ.get("TEMPORAL_NAMESPACE", "default")
TEMPORAL_API_KEY = os.environ.get("TEMPORAL_API_KEY")  # Temporal Cloud
TASK_QUEUE = os.environ.get("TRAILTRUTH_TASK_QUEUE", "trailtruth")

CHAOS = os.environ.get("TRAILTRUTH_CHAOS", "0") not in ("", "0", "false", "False")

for _d in (CACHE_DIR, CARDS_DIR, RUNS_DIR, PROCESSED_DIR):
    _d.mkdir(parents=True, exist_ok=True)


_RUNTIME = None


def _runtime():
    """Quiet the Rust core's WARN lines (e.g. late completions of timed-out activities) unless debugging."""
    global _RUNTIME
    if _RUNTIME is None:
        from temporalio.runtime import LoggingConfig, Runtime, TelemetryConfig, TelemetryFilter

        level = "WARN" if os.environ.get("TRAILTRUTH_LOG_LEVEL", "").upper() == "DEBUG" else "ERROR"
        _RUNTIME = Runtime(telemetry=TelemetryConfig(
            logging=LoggingConfig(filter=TelemetryFilter(core_level=level, other_level="ERROR"))))
    return _RUNTIME


async def temporal_client():
    """Connect to Temporal (local dev server by default, Temporal Cloud if TEMPORAL_API_KEY is set)."""
    from temporalio.client import Client
    from temporalio.contrib.pydantic import pydantic_data_converter

    kwargs = dict(namespace=TEMPORAL_NAMESPACE, data_converter=pydantic_data_converter, runtime=_runtime())
    if TEMPORAL_API_KEY:
        kwargs.update(api_key=TEMPORAL_API_KEY, tls=True)
    return await Client.connect(TEMPORAL_ADDRESS, **kwargs)


def setup_logging(component: str, level: str | None = None) -> None:
    """Clean, narratable console logs (these end up in demo_logs/ and the write-up)."""
    import logging

    lvl = getattr(logging, (level or os.environ.get("TRAILTRUTH_LOG_LEVEL", "INFO")).upper(), logging.INFO)
    fmt = f"%(asctime)s.%(msecs)03d [{component}] %(message)s"
    logging.basicConfig(level=lvl, format=fmt, datefmt="%H:%M:%S", force=True)
    for noisy in ("httpx", "httpcore", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    if lvl > logging.DEBUG:
        # the SDK logs every failed attempt with a full traceback; our activities already log a one-liner
        for noisy in ("temporalio.activity", "temporalio.workflow", "temporalio.worker._activity"):
            logging.getLogger(noisy).setLevel(logging.ERROR)


def safe_name(workflow_id: str) -> str:
    """Workflow ids from Schedules contain ':' (timestamps) - not allowed in Windows filenames."""
    import re

    return re.sub(r"[^A-Za-z0-9_.-]", "_", workflow_id)
