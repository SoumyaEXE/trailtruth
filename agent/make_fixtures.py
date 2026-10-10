"""Build shared/fixtures/*.json (+ copy to web/public/fixtures/) from REAL NPS alerts + heuristic verdicts.

    python -m agent.make_fixtures            # uses agent/cache snapshot or fetches live
    python -m agent.make_fixtures --card havo chch yell

runs.json is synthesized (realistic shapes incl. a retried activity and a crash-resume) unless
agent/state/runs has real runs, in which case the real ones are used.
"""
from __future__ import annotations

import argparse
import json
import shutil
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from agent.config import CACHE_DIR, FIXTURES_DIR, WEB_FIXTURES_DIR
from agent import heuristic, nps
from agent.compose import _hiker_decision, compose_card, worst
from agent.model import to_processed
from shared.schema import TrailCard

SNAPSHOT = CACHE_DIR / "alerts_snapshot.json"


def load_alerts() -> list[dict]:
    raw = nps.load_raw_alerts_file()
    if raw:
        print(f"using data/raw/alerts.json ({len(raw)} alerts)")
        return raw
    if SNAPSHOT.exists():
        return json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    parts = sorted(CACHE_DIR.glob("nps_alerts_*.json"))
    if parts:
        seen, out = set(), []
        for p in parts:
            for a in json.loads(p.read_text(encoding="utf-8"))["data"]:
                if a["id"] not in seen:
                    seen.add(a["id"])
                    out.append(a)
    else:
        out, _ = nps.fetch_all_alerts()
    SNAPSHOT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    for p in parts:
        p.unlink()
    return out


def build_park_index() -> dict[str, dict]:
    big = CACHE_DIR / "nps_parks.json"
    if big.exists() and not nps.PARK_INDEX.exists():
        d = json.loads(big.read_text(encoding="utf-8"))
        idx = {p["parkCode"]: {"park_name": p["fullName"], "states": p.get("states", "")} for p in d["data"]}
        nps.PARK_INDEX.write_text(json.dumps(idx, ensure_ascii=False, indent=0), encoding="utf-8")
        big.unlink()
    return nps.park_index()


def parks_summary(idx: dict[str, dict], processed) -> list[dict]:
    by = defaultdict(list)
    for a in processed:
        by[a.park_code].append(_hiker_decision(a))
    out = []
    for code, info in sorted(idx.items(), key=lambda kv: (-len(by.get(kv[0], [])), kv[1]["park_name"])):
        out.append({
            "park_code": code,
            "park_name": info["park_name"],
            "states": info["states"],
            "alert_count": len(by.get(code, [])),
            "worst_decision": worst(by.get(code, [])),
        })
    return out


def _ts(t: datetime) -> str:
    return t.isoformat(timespec="seconds").replace("+00:00", "Z")


def synth_runs(now: datetime) -> list[dict]:
    """Three illustrative runs. Clearly marked fixture=true."""

    def run(wid, parks, start, steps, status="completed", **extra):
        t = start
        out_steps = []
        for name, dur, attempt, st, err in steps:
            s = {"name": name, "status": st, "attempt": attempt, "started_at": _ts(t),
                 "ended_at": _ts(t + timedelta(seconds=dur)) if st != "running" else None}
            if err:
                s["error"] = err
            out_steps.append(s)
            t += timedelta(seconds=dur)
        return {"workflow_id": wid, "status": status, "parks": parks, "started_at": _ts(start),
                "ended_at": _ts(t) if status == "completed" else None, "steps": out_steps,
                "fixture": True, **extra}

    d = now.date().isoformat()
    return [
        run(f"trailcard-{d}-havo-chch-yell-a1b2", ["havo", "chch", "yell"], now - timedelta(minutes=12), [
            ("fetch_alerts:havo", 0.6, 1, "completed", None),
            ("fetch_alerts:chch", 2.4, 2, "completed", "attempt 1: NPS API HTTP 503 Service Unavailable (retried after 1s backoff)"),
            ("fetch_alerts:yell", 0.7, 1, "completed", None),
            ("classify_alerts", 3.1, 2, "completed", "attempt 1 of 1 alert: model timeout after 5s (retried)"),
            ("compose_card", 0.1, 1, "completed", None),
            ("publish_card", 0.1, 1, "completed", None),
        ], card_id=f"card_{d}_havo-chch-yell", retries=2),
        run(f"trailcard-{d}-zion-yose-c3d4", ["zion", "yose"], now - timedelta(hours=3), [
            ("fetch_alerts:zion", 0.5, 1, "completed", None),
            ("fetch_alerts:yose", 0.5, 1, "completed", None),
            ("classify_alerts", 14.2, 1, "completed", "worker process killed mid-step; workflow resumed on restarted worker from event history (4/6 alerts already classified were not re-run)"),
            ("compose_card", 0.1, 1, "completed", None),
            ("publish_card", 0.1, 1, "completed", None),
        ], card_id=f"card_{d}_zion-yose", resumed_after_crash=True, retries=0),
        run(f"weekly-trailcard-havo-olym-{d}", ["havo", "olym"], now - timedelta(days=1), [
            ("fetch_alerts:havo", 0.6, 1, "completed", None),
            ("fetch_alerts:olym", 0.8, 1, "completed", None),
            ("classify_alerts", 1.2, 1, "completed", None),
            ("compose_card", 0.1, 1, "completed", None),
            ("publish_card", 0.1, 1, "completed", None),
        ], card_id=f"card_{d}_havo-olym", trigger="schedule: Fridays 07:00", retries=0),
    ]


EVAL_FIXTURE = {
    "fixture": True,
    "note": "PLACEHOLDER NUMBERS - replaced by ml/results/eval.json once the ML pipeline runs",
    "test_size": 120,
    "generated_at": None,
    "models": [
        {"name": "teacher (Qwen3-235B) [placeholder]", "role": "teacher", "json_valid": 0.99, "decision_acc": 0.88,
         "closure_f1": 0.9, "hazard_acc": 0.81, "p50_latency_ms": 1800, "cost_per_1k_alerts_usd": 0.9},
        {"name": "Llama-3.2-1B base [placeholder]", "role": "base", "json_valid": 0.55, "decision_acc": 0.41,
         "closure_f1": 0.38, "hazard_acc": 0.3, "p50_latency_ms": 240, "cost_per_1k_alerts_usd": 0.02},
        {"name": "Llama-3.2-1B + TrailTruth LoRA [placeholder]", "role": "lora", "json_valid": 0.98,
         "decision_acc": 0.8, "closure_f1": 0.84, "hazard_acc": 0.72, "p50_latency_ms": 250,
         "cost_per_1k_alerts_usd": 0.02},
        {"name": "heuristic-keywords-v1", "role": "heuristic", "json_valid": 1.0, "decision_acc": 0.5,
         "closure_f1": 0.6, "hazard_acc": 0.5, "p50_latency_ms": 1, "cost_per_1k_alerts_usd": 0.0},
    ],
    "confusion": {"lora": {"labels": ["go", "caution", "no_go"], "matrix": [[50, 6, 2], [5, 20, 4], [1, 4, 28]]}},
    "training": {"steps": 300, "epochs": 3, "lora_rank": 32,
                 "loss_curve": [[s, round(2.2 * (0.985 ** s) + 0.25, 3)] for s in range(0, 301, 20)]},
    "examples": [
        {"title": "Use Caution When Hiking Bluff Trail on Lookout Mountain",
         "base_output": "Sure! Here is the JSON: {hazard: owl, decision: maybe}",
         "lora_output": "{\"hazard_type\":\"wildlife\",\"severity\":2,\"trails_affected\":[\"Bluff Trail\"],\"is_closed\":false,\"decision\":\"caution\",\"reason\":\"Territorial barred owl on Bluff Trail section; stay alert.\"}",
         "expected_decision": "caution"},
    ],
}


def real_runs() -> tuple[list[dict], dict | None, dict | None]:
    """Pick showcase runs captured from the real Temporal dev server (agent/state/runs/*.json)."""
    from agent.config import RUNS_DIR
    from agent.runs import polish

    runs = []
    for p in RUNS_DIR.glob("*.json"):
        r = polish(json.loads(p.read_text(encoding="utf-8")))
        if r.get("steps") and r.get("status") == "completed" and not r.get("mode"):
            runs.append(r)
    if not runs:
        return [], None, None
    # prefer runs where the real LoRA model answered, then newest
    runs.sort(key=lambda r: ("lora" in ((r.get("card") or {}).get("model") or ""), r.get("started_at") or ""),
              reverse=True)

    def retries(r):
        return sum(max(0, s["attempt"] - 1) for s in r["steps"]) + sum(len(s.get("attempt_errors", []))
                                                                       for s in r["steps"])

    picked: list[tuple[str, dict]] = []
    chaos = max((r for r in runs if any(s.get("attempt_errors") for s in r["steps"]) and
                 any(s["name"].startswith("fetch_alerts") and s["attempt"] > 1 for s in r["steps"])),
                key=lambda r: ("lora" in ((r.get("card") or {}).get("model") or ""), retries(r)), default=None)
    if chaos:
        picked.append(("chaos: NPS 503s + model timeouts/invalid JSON, retried by Temporal", chaos))
    crash = next((r for r in runs if r.get("resumed_after_crash") and
                  any(s["name"] == "classify_alerts" and s["attempt"] > 1 for s in r["steps"])), None)
    if crash:
        picked.append(("worker process killed mid-run; resumed on a new worker from event history", crash))
    sched = next((r for r in runs if r["workflow_id"].startswith("weekly-")), None)
    if sched:
        picked.append(("started by Temporal Schedule (Fridays 07:00 America/Los_Angeles)", sched))
    fallback = next((r for r in runs if any("429" in (s.get("detail") or "") for s in r["steps"])), None)
    if fallback:
        picked.append(("NPS API rate-limited (HTTP 429) -> served disk cache / snapshot", fallback))
    used = {r["workflow_id"] for _, r in picked}
    clean = next((r for r in runs if retries(r) == 0 and not r.get("resumed_after_crash")
                  and r["workflow_id"] not in used and not r["workflow_id"].startswith("weekly-")), None)
    if clean:
        picked.append(("clean run", clean))
    out = []
    for label, r in picked:
        r = dict(r)
        card = r.pop("card", None)
        r.update(label=label, fixture=True, source="captured from a real Temporal dev-server run",
                 model=(card or {}).get("model"))
        r.pop("workers", None)
        out.append(r)
    chaos_status = None
    if chaos:
        chaos_status = {k: v for k, v in chaos.items() if k != "workers"}
        chaos_status.update(fixture=True, source="captured from a real Temporal dev-server run")
    return out, chaos_status, (clean or {}).get("card")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--card", nargs="+", default=["havo", "chch", "yell"])
    ap.add_argument("--real-runs", action="store_true", help="use captured runs from agent/state/runs")
    ap.add_argument("--heuristic", action="store_true", help="re-classify with the heuristic instead of using "
                                                             "agent/state/processed (refresh output)")
    args = ap.parse_args()

    raw = load_alerts()
    idx = build_park_index()
    names = {k: v["park_name"] for k, v in idx.items()}
    processed = []
    from agent.config import ML_EVAL, PROCESSED_DIR
    from shared.schema import ProcessedAlert

    pf = PROCESSED_DIR / "alerts.json"
    if not args.heuristic and pf.exists():
        processed = [ProcessedAlert.model_validate(a) for a in json.loads(pf.read_text(encoding="utf-8"))]
        print(f"alerts <- agent/state/processed/alerts.json (agent.refresh), models="
              f"{dict(Counter(a.model for a in processed))}")
    else:
        for r in raw:
            v, ms, model = heuristic.classify(r.get("title", ""), r.get("description", ""))
            processed.append(to_processed(r, v, ms, model, names))
    processed.sort(key=lambda a: (a.park_code, -a.verdict.severity, a.title))
    print(f"{len(processed)} alerts, decisions={Counter(a.verdict.decision for a in processed)}")
    agree = Counter((a.nps_category, a.verdict.decision) for a in processed)
    print("category x decision:", dict(agree))

    now = datetime.now(timezone.utc).replace(microsecond=0)
    card = compose_card(args.card, names, [a for a in processed if a.park_code in args.card],
                        workflow_id=f"trailcard-{now.date()}-{'-'.join(args.card)}-a1b2", generated_at=_ts(now))
    runs = synth_runs(now)
    card_status = {"status": "completed", "card": card.model_dump(), "steps": runs[0]["steps"],
                   "workflow_id": card.workflow_id, "fixture": True}
    if args.real_runs:
        rr, chaos_status, clean_card = real_runs()
        if rr:
            runs = rr
            print(f"runs.json <- {len(rr)} real Temporal runs: " + "; ".join(r["label"] for r in rr))
        if chaos_status:
            card_status = chaos_status
            old = card_status.get("card")
            if old:  # re-aggregate with the current compose.py rules (deterministic) from the same alerts
                ids = {i for p_ in old["parks"] for i in p_["alert_ids"]}
                fresh = compose_card(old["parks"] and [p_["park_code"] for p_ in old["parks"]], names,
                                     [a for a in processed if a.id in ids], old["workflow_id"], old["generated_at"])
                if fresh.model_dump() != old:
                    card_status["card"] = fresh.model_dump()
                    card_status["card_note"] = ("card re-aggregated with the current compose.py rules from the "
                                                "same alert ids (LoRA verdicts from agent.refresh)")
        from agent.config import RUNS_DIR

        for p in sorted(RUNS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            r = json.loads(p.read_text(encoding="utf-8"))
            c = r.get("card")
            if c and [x["park_code"] for x in c["parks"]] == args.card and not r.get("mode") and                     ("lora" in c.get("model", "") or not any("lora" in (json.loads(q.read_text(encoding="utf-8"))
                                                                         .get("card") or {}).get("model", "")
                                                             for q in RUNS_DIR.glob("*.json"))):
                card = TrailCard.model_validate(c)
                print(f"card.json <- real run {r['workflow_id']}")
                break
    ev = dict(EVAL_FIXTURE, generated_at=_ts(now))

    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "parks.json": parks_summary(idx, processed),
        "alerts.json": [a.model_dump() for a in processed],
        "card.json": card.model_dump(),
        "card_status.json": card_status,
        "runs.json": runs,
        "eval.json": json.loads(ML_EVAL.read_text(encoding="utf-8")) if ML_EVAL.exists() else ev,
    }
    WEB_FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    for fn, data in out.items():
        p = FIXTURES_DIR / fn
        p.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        shutil.copyfile(p, WEB_FIXTURES_DIR / fn)
        print(f"wrote {p.relative_to(FIXTURES_DIR.parent.parent)} ({p.stat().st_size // 1024} KB)")
    print(json.dumps(card.model_dump(), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
