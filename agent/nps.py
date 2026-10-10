"""NPS API client with a disk cache + offline snapshot fallback.

Fetch order for one park (fetch_park_alerts):
  1. fresh per-URL disk cache (agent/cache/http_*.json, TTL 6h)      source="cache"
  2. live NPS API (NPS_API_KEY from env/.env, DEMO_KEY otherwise)     source="nps-live"
  3. on HTTP 429 (rate limit) -> snapshot filtered by parkCode        source="snapshot (NPS 429 ...)"
     snapshot = data/raw/alerts.json (ML agent, 627 real alerts) or agent/cache/alerts_snapshot.json
  5xx / network errors are raised so Temporal retries them; 4xx (except 429) are non-retryable.
API keys are never logged: every URL that leaves this module goes through redact().
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path

import httpx

from agent.config import CACHE_DIR, NPS_API_KEY, NPS_BASE, RAW_ALERTS

PARK_INDEX = CACHE_DIR / "parks_index.json"
SNAPSHOT = CACHE_DIR / "alerts_snapshot.json"
DEFAULT_TTL = int(os.environ.get("TRAILTRUTH_NPS_CACHE_TTL", str(6 * 3600)))  # seconds; 0 = always live


def redact(s: str) -> str:
    return re.sub(r"api_key=[^&\s]+", "api_key=***", s)


class NpsHttpError(Exception):
    def __init__(self, status: int, url: str, body: str = "", retry_after: float | None = None):
        msg = f"NPS API HTTP {status} for {redact(url)}"
        if retry_after:
            msg += f" (Retry-After {retry_after:.0f}s = {retry_after / 3600:.1f}h)"
        super().__init__(msg)
        self.status = status
        self.retry_after = retry_after


def _cache_path(url: str) -> Path:
    key = hashlib.sha1(redact(url).encode()).hexdigest()[:16]
    return CACHE_DIR / f"http_{key}.json"


def get_json(path: str, params: dict, ttl: int = DEFAULT_TTL, timeout: float = 30.0) -> tuple[dict, str]:
    """Returns (json, source) where source is 'cache' or 'nps-live'. Raises NpsHttpError / httpx errors."""
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{NPS_BASE}/{path}?{qs}&api_key={NPS_API_KEY}"
    cp = _cache_path(url)
    if cp.exists() and time.time() - cp.stat().st_mtime < ttl:
        return json.loads(cp.read_text(encoding="utf-8")), "cache"
    r = httpx.get(url, timeout=timeout, headers={"User-Agent": "TrailTruth/0.1 (hackathon)"})
    if r.status_code != 200:
        ra = r.headers.get("Retry-After")
        raise NpsHttpError(r.status_code, url, r.text, float(ra) if ra and ra.replace(".", "").isdigit() else None)
    data = r.json()
    cp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data, "nps-live"


def stale_cache(path: str, params: dict) -> dict | None:
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    cp = _cache_path(f"{NPS_BASE}/{path}?{qs}&api_key={NPS_API_KEY}")
    return json.loads(cp.read_text(encoding="utf-8")) if cp.exists() else None


_snapshot_cache: list[dict] | None = None


def snapshot_alerts() -> list[dict]:
    global _snapshot_cache
    if _snapshot_cache is None:
        raw = load_raw_alerts_file()
        if raw is None and SNAPSHOT.exists():
            raw = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        _snapshot_cache = raw or []
    return _snapshot_cache


def snapshot_for_park(park: str) -> list[dict]:
    park = park.lower()
    return [a for a in snapshot_alerts()
            if park in [p.strip().lower() for p in (a.get("parkCode") or "").split(",")]]


def fetch_park_alerts(park: str, ttl: int = DEFAULT_TTL, fallback_on_429: bool = True,
                      fallback_on_any: bool = False) -> tuple[list[dict], str]:
    """Returns (alerts, source). See module docstring for the fallback ladder."""
    params = {"parkCode": park, "limit": 50}
    try:
        data, src = get_json("alerts", params, ttl=ttl)
        return data.get("data", []), src
    except NpsHttpError as e:
        if (e.status == 429 and fallback_on_429) or fallback_on_any:
            stale = stale_cache("alerts", params)
            if stale is not None:
                return stale.get("data", []), f"stale-cache (NPS {e.status})"
            ra = f", Retry-After {e.retry_after / 3600:.1f}h" if e.retry_after else ""
            return snapshot_for_park(park), f"snapshot (NPS {e.status}{ra})"
        raise
    except httpx.HTTPError:
        if fallback_on_any:
            stale = stale_cache("alerts", params)
            if stale is not None:
                return stale.get("data", []), "stale-cache (network error)"
            return snapshot_for_park(park), "snapshot (network error)"
        raise


def fetch_all_alerts(ttl: int = DEFAULT_TTL) -> tuple[list[dict], str]:
    """Every live alert (paginated). On 429 / errors falls back to the snapshot."""
    out: list[dict] = []
    start = 0
    srcs = set()
    try:
        while True:
            page, src = get_json("alerts", {"limit": 500, "start": start}, ttl=ttl)
            srcs.add(src)
            data = page.get("data", [])
            out.extend(data)
            total = int(page.get("total", 0) or 0)
            start += len(data)
            if not data or start >= total:
                break
    except (NpsHttpError, httpx.HTTPError) as e:
        snap = snapshot_alerts()
        if snap:
            return snap, f"snapshot ({redact(str(e))[:120]})"
        raise
    return out, "+".join(sorted(srcs))


def load_raw_alerts_file() -> list[dict] | None:
    if RAW_ALERTS.exists():
        d = json.loads(RAW_ALERTS.read_text(encoding="utf-8"))
        return d.get("data", d) if isinstance(d, dict) else d
    return None


def park_index() -> dict[str, dict]:
    """park_code -> {park_name, states}. Built once from /parks and cached slim (committed)."""
    if PARK_INDEX.exists():
        return json.loads(PARK_INDEX.read_text(encoding="utf-8"))
    big, _ = get_json("parks", {"limit": 500}, ttl=30 * 86400)
    idx = {p["parkCode"]: {"park_name": p["fullName"], "states": p.get("states", "")} for p in big["data"]}
    PARK_INDEX.write_text(json.dumps(idx, ensure_ascii=False, indent=0), encoding="utf-8")
    return idx


def park_names() -> dict[str, str]:
    return {k: v["park_name"] for k, v in park_index().items()}
