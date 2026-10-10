"""Label every NPS alert with the large teacher model via Tinker sampling (resume-safe).

    python ml/teacher_label.py [--limit N] [--concurrency 32]

Writes/appends data/labeled/teacher.jsonl (one row per alert id; rows with a valid verdict are
skipped on rerun, invalid ones are retried). Gold decision from the NPS category is stored too.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from collections import Counter
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.common import (LABELED, TEACHER_MODEL, TEACHER_SYSTEM_PROMPT, add_spend, derive_gold, first_park_code,
                       load_alerts, make_renderer, messages_for, read_jsonl, require_tinker_key, sample_cost_usd,
                       utf8_stdout, write_jsonl)

OUT = LABELED / "teacher.jsonl"


async def main_async(args) -> None:
    import tinker

    from ml.tinker_sampling import classify_many

    alerts = load_alerts()
    existing = {r["id"]: r for r in read_jsonl(OUT)}
    todo = [a for a in alerts if not (existing.get(a["id"]) or {}).get("valid")]
    n_done = len(alerts) - len(todo)
    if args.limit:
        todo = todo[: args.limit]
    print(f"teacher={TEACHER_MODEL}: {len(alerts)} alerts, {n_done} already labeled, {len(todo)} to do")
    if not todo:
        return

    _tok, renderer = make_renderer(TEACHER_MODEL)
    service = tinker.ServiceClient()
    sc = await service.create_sampling_client_async(base_model=TEACHER_MODEL)
    by_id = {a["id"]: a for a in alerts}
    done = 0
    t0 = time.time()
    f = OUT.open("a", encoding="utf-8")

    def on_result(key, r):
        nonlocal done
        a = by_id[key]
        row = {
            "id": a["id"], "park_code": first_park_code(a), "title": a["title"],
            "description": a.get("description", ""), "nps_category": a.get("category"), **derive_gold(a),
            "verdict": r.verdict.model_dump() if r.verdict else None, "valid": r.verdict is not None,
            "raw_output": r.text, "error": r.error, "attempts": r.attempts, "model": TEACHER_MODEL,
            "latency_ms": round(r.latency_ms, 1), "prompt_tokens": r.prompt_tokens,
            "completion_tokens": r.completion_tokens,
        }
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
        f.flush()
        done += 1
        if done % 25 == 0 or done == len(todo):
            print(f"  {done}/{len(todo)}  ({time.time() - t0:.0f}s)")

    items = [(a["id"], messages_for(a["title"], a.get("description", ""), TEACHER_SYSTEM_PROMPT)) for a in todo]
    try:
        await classify_many(sc, renderer, items, concurrency=args.concurrency, on_result=on_result,
                            max_tokens=320, retries=2, temperature=0.0)
    finally:
        f.close()

    # compact: keep the latest row per id (valid preferred), preserve alert order
    rows = read_jsonl(OUT)
    latest: dict[str, dict] = {}
    for r in rows:
        if r["id"] not in latest or r.get("valid") or not latest[r["id"]].get("valid"):
            latest[r["id"]] = r
    ordered = [latest[a["id"]] for a in alerts if a["id"] in latest]
    write_jsonl(OUT, ordered)

    valid = [r for r in ordered if r.get("valid")]
    pt = sum(r.get("prompt_tokens", 0) for r in ordered)
    ct = sum(r.get("completion_tokens", 0) for r in ordered)
    usd = sample_cost_usd(TEACHER_MODEL, pt, ct)
    add_spend("teacher_label", {"model": TEACHER_MODEL, "rows": len(ordered), "prompt_tokens": pt,
                                "completion_tokens": ct, "est_usd": round(usd, 4)})
    agree = sum(r["verdict"]["decision"] == r["gold_decision"] for r in valid) / max(1, len(valid))
    print(f"\n{len(valid)}/{len(ordered)} valid; teacher decision vs gold: {agree:.3f}; est ${usd:.3f}")
    print("hazards:", dict(Counter(r["verdict"]["hazard_type"] for r in valid)))
    print("first-try valid:", sum(r.get("attempts") == 1 and r.get("valid") for r in ordered))


def main() -> None:
    utf8_stdout()
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--concurrency", type=int, default=32)
    args = ap.parse_args()
    require_tinker_key()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
