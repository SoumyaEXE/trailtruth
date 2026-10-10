"""Fetch ALL NPS alerts + the park names they reference.

Writes:
  data/raw/alerts.json  -> {"fetched_at", "total", "data": [alert, ...]}
  data/raw/parks.json   -> {"fetched_at", "data": {park_code: {"fullName", "states"}}}

Key: NPS_API_KEY from the environment or the repo-root .env (never printed, never written
to disk); falls back to DEMO_KEY (~10 req/hr, easily 429s). We use big pages (limit=500)
and cache each raw API page under data/raw/cache/ (gitignored) so reruns are free.

    python ml/fetch_alerts.py            # skips alerts if data/raw/alerts.json exists
    python ml/fetch_alerts.py --force    # re-download alerts + parks (ignores caches)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CACHE = RAW / "cache"
BASE = "https://developer.nps.gov/api/v1"
PAGE = 500


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """Minimal .env loader (no dependency). Does not override existing env vars."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip().removeprefix("export ").strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def _key() -> str:
    return os.environ.get("NPS_API_KEY") or "DEMO_KEY"


def _scrub(msg: str) -> str:
    return re.sub(r"api_key=[^&\s'\"]+", "api_key=***", msg)


def _get(client: httpx.Client, path: str, params: dict, refresh: bool) -> dict:
    tag = hashlib.sha1(json.dumps([path, params], sort_keys=True).encode()).hexdigest()[:16]
    cpath = CACHE / f"{path.strip('/').replace('/', '_')}_{tag}.json"
    if cpath.exists() and not refresh:
        return json.loads(cpath.read_text(encoding="utf-8"))
    for attempt in range(5):
        try:
            # Build the query by hand: NPS only honours literal commas in parkCode lists
            # (httpx would encode them as %2C and NPS then matches just the first code).
            qs = "&".join(f"{k}={v}" for k, v in {**params, "api_key": _key()}.items())
            r = client.get(f"{BASE}{path}?{qs}")
            if r.status_code == 429:
                retry_after = r.headers.get("Retry-After")
                if retry_after and float(retry_after) > 300:
                    raise SystemExit(
                        f"NPS API rate limited (429, Retry-After={retry_after}s). "
                        "Set NPS_API_KEY (free at https://www.nps.gov/subjects/developer/get-started.htm)."
                    )
                wait = 15 * (attempt + 1)
                print(f"  rate limited (429); sleeping {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            r.raise_for_status()
            data = r.json()
            CACHE.mkdir(parents=True, exist_ok=True)
            cpath.write_text(json.dumps(data), encoding="utf-8")
            return data
        except (httpx.HTTPError, ValueError) as e:  # network blips / bad JSON
            wait = 5 * (attempt + 1)
            print(f"  {path} attempt {attempt + 1} failed: {_scrub(repr(e))}; retry in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise SystemExit(f"Failed to fetch {path} after retries")


def park_codes(alert: dict) -> list[str]:
    """Normalise an alert's parkCode field ("chch,havo", oddities like "es-es/cham")."""
    out = []
    for c in (alert.get("parkCode") or "").split(","):
        c = c.strip().lower().rsplit("/", 1)[-1]
        if re.fullmatch(r"[a-z]{3,10}", c):
            out.append(c)
    return out


def fetch_alerts(client: httpx.Client, refresh: bool) -> list[dict]:
    alerts: list[dict] = []
    start = 0
    while True:
        page = _get(client, "/alerts", {"limit": PAGE, "start": start}, refresh)
        batch = page.get("data", [])
        total = int(page.get("total", 0) or 0)
        alerts.extend(batch)
        print(f"alerts: got {len(batch)} (start={start}), running={len(alerts)}/{total}")
        start += len(batch)
        if not batch or start >= total:
            break
    seen, out = set(), []
    for a in alerts:  # dedupe by id, keep first
        if a.get("id") in seen:
            continue
        seen.add(a.get("id"))
        out.append(a)
    return out


def fetch_parks(client: httpx.Client, codes: list[str], refresh: bool) -> dict[str, dict]:
    parks: dict[str, dict] = {}
    for i in range(0, len(codes), 50):
        chunk = codes[i : i + 50]
        page = _get(
            client,
            "/parks",
            {"parkCode": ",".join(chunk), "fields": "fullName,states", "limit": 100},
            refresh,
        )
        for p in page.get("data", []):
            parks[p["parkCode"].lower()] = {"fullName": p.get("fullName", ""), "states": p.get("states", "")}
        print(f"parks: {len(parks)}/{len(codes)}")
    return parks


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", "--refresh", dest="force", action="store_true",
                    help="re-download even if data/raw/alerts.json and API caches exist")
    args = ap.parse_args()
    load_dotenv()
    RAW.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    alerts_path, parks_path = RAW / "alerts.json", RAW / "parks.json"
    with httpx.Client(timeout=60, headers={"User-Agent": "TrailTruth/0.1 (hackathon)"}) as client:
        if alerts_path.exists() and not args.force:
            alerts = json.loads(alerts_path.read_text(encoding="utf-8"))["data"]
            print(f"alerts: using cached {alerts_path} ({len(alerts)} alerts; --force to refetch)")
        else:
            alerts = fetch_alerts(client, args.force)
            alerts_path.write_text(
                json.dumps({"fetched_at": now, "total": len(alerts), "data": alerts}, indent=1), encoding="utf-8"
            )
        codes = sorted({c for a in alerts for c in park_codes(a)})
        existing = {}
        if parks_path.exists() and not args.force:
            existing = json.loads(parks_path.read_text(encoding="utf-8")).get("data", {})
        missing = [c for c in codes if c not in existing]
        missing_file = RAW / "cache" / "parks_missing.json"  # codes NPS doesn't know; don't re-ask
        known_missing = set(json.loads(missing_file.read_text())) if missing_file.exists() and not args.force else set()
        missing = [c for c in missing if c not in known_missing]
        if missing:
            parks = {**existing, **fetch_parks(client, missing, args.force)}
            CACHE.mkdir(parents=True, exist_ok=True)
            missing_file.write_text(json.dumps(sorted(known_missing | {c for c in missing if c not in parks})))
            parks_path.write_text(json.dumps({"fetched_at": now, "data": parks}, indent=1), encoding="utf-8")
        else:
            parks = existing
            print(f"parks: using cached {parks_path} ({len(parks)} parks)")

    print(f"\n{len(alerts)} alerts, {len(parks)}/{len(codes)} parks named")
    for k, v in Counter(a.get("category") for a in alerts).most_common():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
