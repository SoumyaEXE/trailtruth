"""Batch job: fetch ALL live NPS alerts, classify each with the model (ml.infer, heuristic fallback),
write agent/state/processed/{alerts,parks,meta}.json which /api/alerts and /api/parks serve.

    python -m agent.refresh                 # live NPS (NPS_API_KEY from .env) -> snapshot fallback on 429
    python -m agent.refresh --offline       # classify data/raw/alerts.json snapshot only
    python -m agent.refresh --limit 50      # quick smoke test
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from agent import model, nps
from agent.config import PROCESSED_DIR, setup_logging
from agent.make_fixtures import parks_summary
from agent.telemetry import init_sentry

log = logging.getLogger("trailtruth")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--batch", type=int, default=64, help="Tinker batch size")
    args = ap.parse_args()
    setup_logging("refresh")
    init_sentry("refresh")

    t0 = time.time()
    if args.offline:
        raw, source = nps.snapshot_alerts(), "snapshot (--offline)"
    else:
        raw, source = nps.fetch_all_alerts()
    if args.limit:
        raw = raw[: args.limit]
    log.info("fetched %d alerts (source=%s)", len(raw), source)
    idx = nps.park_index()
    names = {k: v["park_name"] for k, v in idx.items()}

    log.info("model: %s", model.describe())
    if model.provider() == "tinker":
        log.info("warming up Tinker sampling client (cold start)...")
        log.info("Tinker ready in %.1fs", model.warmup())
        t1 = time.time()
        processed = []
        for i in range(0, len(raw), args.batch):  # Tinker pipelines requests; batches keep progress visible
            chunk = raw[i:i + args.batch]
            res = model.classify_batch([(a.get("title", ""), a.get("description", "")) for a in chunk])
            processed += [model.to_processed(a, v, ms, name, names) for a, (v, ms, name) in zip(chunk, res)]
            log.info("  classified %d/%d (%.1fs)", len(processed), len(raw), time.time() - t1)
    else:
        def one(a):
            v, ms, name = model.classify(a.get("title", ""), a.get("description", ""))
            return model.to_processed(a, v, ms, name, names)

        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            processed = list(ex.map(one, raw))
    processed.sort(key=lambda a: (a.park_code, -a.verdict.severity, a.title))
    models = Counter(a.model for a in processed)
    log.info("classified %d alerts in %.1fs; models=%s decisions=%s", len(processed), time.time() - t0,
             dict(models), dict(Counter(a.verdict.decision for a in processed)))

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "alerts.json": [a.model_dump() for a in processed],
        "parks.json": parks_summary(idx, processed),
        "meta.json": {"refreshed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                      "source": nps.redact(source), "count": len(processed), "models": dict(models)},
    }
    for fn, data in out.items():
        tmp = PROCESSED_DIR / (fn + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(PROCESSED_DIR / fn)
    log.info("wrote %s", ", ".join(f"state/processed/{k}" for k in out))


if __name__ == "__main__":
    main()
