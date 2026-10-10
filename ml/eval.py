"""Evaluate teacher / base student / LoRA student / heuristic on the held-out test split.

    python ml/eval.py                         # all roles that can run (Tinker roles need TINKER_API_KEY)
    python ml/eval.py --roles heuristic       # free, no key
    python ml/eval.py --roles base,teacher    # baseline only (before training)
    python ml/eval.py --roles lora            # after train_tinker.py (reads ml/results/model_path.txt)

Each role's predictions are cached in ml/results/preds/<role>.jsonl, so roles can be run at
different times; ml/results/eval.json is always rebuilt from whatever exists (missing Tinker roles
are reported as {"pending": true} with null metrics - nothing is ever fabricated).

Metrics (single attempt per alert, temperature 0, no retries):
  json_valid     fraction of outputs that parse + validate as TrailVerdict
  decision_acc   accuracy vs gold decision (NPS category, facility-only-closure adjustment; invalid = wrong)
  decision_acc_raw  same vs the raw CATEGORY_TO_DECISION mapping
  decision_macro_f1 macro-F1 over go/caution/no_go
  closure_f1     F1 of is_closed vs gold_closed = (category == "Park Closure") OR teacher.is_closed
  hazard_acc     hazard_type agreement with the teacher label (null if no teacher labels)
  p50/p95_latency_ms  wall-clock per request through the Tinker sampling API (same concurrency for all)
  cost_per_1k_alerts_usd  measured tokens x Tinker list price (prefill + sample)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.common import (RESULTS, SPLITS, STUDENT_MODEL, SYSTEM_PROMPT, TEACHER_MODEL, TEACHER_SYSTEM_PROMPT, add_spend,
                       load_dotenv, make_renderer, percentile, read_jsonl, sample_cost_usd, utf8_stdout, write_jsonl)

PREDS = RESULTS / "preds"
LABELS = ["go", "caution", "no_go"]


def short(m: str) -> str:
    return m.split("/")[-1]


ROLE_INFO = {
    "teacher": {"name": f"teacher ({short(TEACHER_MODEL)})", "model": TEACHER_MODEL, "system": TEACHER_SYSTEM_PROMPT},
    "base": {"name": f"{short(STUDENT_MODEL)} base", "model": STUDENT_MODEL, "system": SYSTEM_PROMPT},
    "base_guided": {"name": f"{short(STUDENT_MODEL)} base + teacher's long prompt", "model": STUDENT_MODEL,
                    "system": TEACHER_SYSTEM_PROMPT},
    "lora": {"name": f"{short(STUDENT_MODEL)} + TrailTruth LoRA", "model": STUDENT_MODEL, "system": SYSTEM_PROMPT},
    "heuristic": {"name": "keyword heuristic (no model)", "model": "heuristic", "system": None},
}
ORDER = ["teacher", "base", "base_guided", "lora", "heuristic"]


def model_path() -> str | None:
    import os

    p = RESULTS / "model_path.txt"
    return os.environ.get("TRAILTRUTH_TINKER_MODEL_PATH") or (p.read_text().strip() if p.exists() else None)


# ------------------------------------------------------------------------------------- running
def run_heuristic(test: list[dict]) -> list[dict]:
    from ml.weak_label import heuristic_verdict

    out = []
    for r in test:
        title = r["meta"]["title"]
        desc = r["messages"][1]["content"].split("\nALERT TEXT: ", 1)[-1]
        t0 = time.perf_counter()
        v = heuristic_verdict(title, desc)
        ms = (time.perf_counter() - t0) * 1000
        out.append({"id": r["meta"]["id"], "output_text": json.dumps(v.model_dump(), ensure_ascii=False),
                    "verdict": v.model_dump(), "valid": True, "latency_ms": round(ms, 4),
                    "prompt_tokens": 0, "completion_tokens": 0, "error": None})
    return out


async def run_tinker(role: str, test: list[dict], concurrency: int) -> list[dict]:
    import tinker

    from ml.tinker_sampling import classify_many

    info = ROLE_INFO[role]
    _tok, renderer = make_renderer(info["model"])
    service = tinker.ServiceClient()
    if role == "lora":
        mp = model_path()
        if not mp:
            raise SystemExit("no LoRA model path: run ml/train_tinker.py (writes ml/results/model_path.txt)")
        sc = await service.create_sampling_client_async(model_path=mp)
        info["model_path"] = mp
    else:
        sc = await service.create_sampling_client_async(base_model=info["model"])
    items = []
    for r in test:
        msgs = [{"role": "system", "content": info["system"]}, r["messages"][1]]
        items.append((r["meta"]["id"], msgs))
    # warm-up request so the first measured call doesn't pay connection / session setup
    await classify_many(sc, renderer, items[:1], concurrency=1, max_tokens=256)
    t0 = time.time()
    res = await classify_many(sc, renderer, items, concurrency=concurrency, max_tokens=256, retries=0,
                              temperature=0.0)
    print(f"  {role}: {len(items)} alerts in {time.time() - t0:.1f}s")
    out = []
    for r in test:
        x = res[r["meta"]["id"]]
        out.append({"id": r["meta"]["id"], "output_text": x.first_text or x.text,
                    "verdict": x.verdict.model_dump() if x.verdict else None, "valid": x.verdict is not None,
                    "latency_ms": round(x.latency_ms, 1), "prompt_tokens": x.prompt_tokens,
                    "completion_tokens": x.completion_tokens, "error": x.error})
    return out


# ------------------------------------------------------------------------------------- metrics
def f1(tp: int, fp: int, fn: int) -> float:
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return 2 * p * r / (p + r) if p + r else 0.0


def metrics(role: str, preds: list[dict], test: list[dict]) -> tuple[dict, dict]:
    meta = {r["meta"]["id"]: r["meta"] for r in test}
    preds = [p for p in preds if p["id"] in meta]
    n = len(preds)
    dec_ok = dec_raw_ok = 0
    tp = fp = fn = 0
    haz_ok = haz_n = 0
    tdec_ok = 0
    conf = [[0] * 3 for _ in range(3)]
    invalid = 0
    for p in preds:
        m = meta[p["id"]]
        v = p.get("verdict")
        d = v["decision"] if v else None
        if v is None:
            invalid += 1
        dec_ok += d == m["gold_decision"]
        dec_raw_ok += d == m["gold_decision_raw"]
        if d in LABELS:
            conf[LABELS.index(m["gold_decision"])][LABELS.index(d)] += 1
        pc = bool(v and v["is_closed"])
        gc = bool(m["gold_is_closed"])
        tp += pc and gc
        fp += pc and not gc
        fn += gc and not pc
        tv = m.get("teacher_verdict")
        if tv:
            haz_n += 1
            haz_ok += bool(v) and v["hazard_type"] == tv["hazard_type"]
            tdec_ok += bool(v) and v["decision"] == tv["decision"]
    per_class = []
    for i, lab in enumerate(LABELS):
        ctp = conf[i][i]
        cfp = sum(conf[j][i] for j in range(3)) - ctp
        cfn = sum(1 for p in preds if meta[p["id"]]["gold_decision"] == lab) - ctp
        per_class.append(f1(ctp, cfp, cfn))
    lat = [p["latency_ms"] for p in preds]
    model = ROLE_INFO[role]["model"]
    cost = (sum(sample_cost_usd(model, p["prompt_tokens"], p["completion_tokens"]) for p in preds) / n * 1000
            if n and model != "heuristic" else 0.0)
    row = {
        "name": ROLE_INFO[role]["name"], "role": role, "model": model,
        "n": n,
        "json_valid": round((n - invalid) / n, 4) if n else None,
        "decision_acc": round(dec_ok / n, 4) if n else None,
        "decision_acc_raw": round(dec_raw_ok / n, 4) if n else None,
        "decision_macro_f1": round(sum(per_class) / 3, 4) if n else None,
        "closure_f1": round(f1(tp, fp, fn), 4) if n else None,
        "hazard_acc": round(haz_ok / haz_n, 4) if haz_n else None,
        "decision_agree_teacher": round(tdec_ok / haz_n, 4) if haz_n else None,
        "p50_latency_ms": round(percentile(lat, 0.5), 2) if lat else None,
        "p95_latency_ms": round(percentile(lat, 0.95), 2) if lat else None,
        "avg_prompt_tokens": round(sum(p["prompt_tokens"] for p in preds) / n, 1) if n else None,
        "avg_completion_tokens": round(sum(p["completion_tokens"] for p in preds) / n, 1) if n else None,
        "cost_per_1k_alerts_usd": round(cost, 4),
        "pending": False,
    }
    if ROLE_INFO[role].get("model_path"):
        row["model_path"] = ROLE_INFO[role]["model_path"]
    return row, {"labels": LABELS, "matrix": conf, "invalid": invalid}


def pending_row(role: str) -> dict:
    return {"name": ROLE_INFO[role]["name"], "role": role, "model": ROLE_INFO[role]["model"], "pending": True,
            "json_valid": None, "decision_acc": None, "closure_f1": None, "hazard_acc": None,
            "p50_latency_ms": None, "p95_latency_ms": None, "cost_per_1k_alerts_usd": None}


VIVID = ["owl", "volcan", "kīlauea", "kilauea", "lava", "rabies", "bear", "bison", "fire", "algae", "hurricane",
         "flood", "rockfall", "glacier", "snake", "smoke", "storm", "elk", "washed"]


def pick_examples(test: list[dict], by_role: dict[str, dict[str, dict]], k: int = 6) -> list[dict]:
    scored = []
    for r in test:
        t = (r["meta"]["title"] + " " + r["messages"][1]["content"]).lower()
        hits = [w for w in VIVID if w in t]
        rank = min((VIVID.index(w) for w in hits), default=99)
        base = by_role.get("base", {}).get(r["meta"]["id"])
        lora = by_role.get("lora", {}).get(r["meta"]["id"])
        # prefer cases where the LoRA fixes the base model (most instructive), then vivid ones
        fixed = bool(base and lora and lora.get("verdict") and
                     lora["verdict"]["decision"] == r["meta"]["gold_decision"] and
                     (not base.get("verdict") or base["verdict"]["decision"] != r["meta"]["gold_decision"]))
        scored.append((0 if hits else 1, 0 if fixed else 1, rank, r["meta"]["title"], r))
    scored.sort(key=lambda x: x[:4])
    out, seen_kw = [], set()
    for _, _, rank, _, r in scored:
        if len(out) >= k:
            break
        if rank != 99 and rank in seen_kw:
            continue
        seen_kw.add(rank)
        i = r["meta"]["id"]
        get = lambda role: (by_role.get(role, {}).get(i) or {}).get("output_text")  # noqa: E731
        out.append({"id": i, "title": r["meta"]["title"], "park_code": r["meta"]["park_code"],
                    "description": r["messages"][1]["content"].split("\nALERT TEXT: ", 1)[-1],
                    "nps_category": r["meta"]["nps_category"], "expected_decision": r["meta"]["gold_decision"],
                    "base_output": get("base"), "lora_output": get("lora"), "teacher_output": get("teacher"),
                    "heuristic_output": get("heuristic")})
    return out


def build_eval(test: list[dict]) -> dict:
    by_role, rows, confusion = {}, [], {}
    for role in ORDER:
        p = read_jsonl(PREDS / f"{role}.jsonl")
        if p:
            by_role[role] = {x["id"]: x for x in p}
            row, cm = metrics(role, p, test)
            if p and p[0].get("model_path"):
                row["model_path"] = p[0]["model_path"]
            rows.append(row)
            confusion[role] = cm
        elif role in ("teacher", "base", "lora"):
            rows.append(pending_row(role))
    train_log = {}
    tl = RESULTS / "train_log.json"
    if tl.exists():
        train_log = json.loads(tl.read_text(encoding="utf-8"))
    training = {"steps": train_log.get("steps", 0), "epochs": train_log.get("epochs", 0),
                "lora_rank": train_log.get("lora_rank", 32), "loss_curve": train_log.get("loss_curve", []),
                "test_loss": train_log.get("test_loss", []), "learning_rate": train_log.get("learning_rate"),
                "batch_size": train_log.get("batch_size"), "base_model": train_log.get("base_model", STUDENT_MODEL),
                "model_path": train_log.get("model_path")}
    meta0 = test[0]["meta"] if test else {}
    ev = {
        "test_size": len(test), "generated_at": datetime.now(timezone.utc).isoformat(),
        "label_source": meta0.get("label_source"),
        "teacher_model": TEACHER_MODEL, "student_model": STUDENT_MODEL,
        "models": rows, "confusion": confusion, "training": training,
        "examples": pick_examples(test, by_role),
        "test_by_category": dict(Counter(r["meta"]["nps_category"] for r in test)),
        "notes": [
            "Gold decision = NPS category (Information->go, Caution->caution, Danger/Park Closure->no_go), except "
            "Park Closure alerts whose title is facility-only (parking/visitor center/campground...) -> caution. "
            "decision_acc_raw uses the unadjusted mapping.",
            "closure gold = category=='Park Closure' OR teacher is_closed; hazard_acc is agreement with teacher labels.",
            "Teacher row uses the long teacher prompt it labeled with; base/lora use the short production SYSTEM_PROMPT.",
            "Single attempt, temperature 0, no retries. Latency = wall-clock per Tinker sampling request (incl. network/queue).",
            "Cost = measured tokens x Tinker list prices (models.json, 2026-10-10).",
        ],
    }
    return ev, by_role


def main() -> None:
    utf8_stdout()
    ap = argparse.ArgumentParser()
    ap.add_argument("--roles", default="auto", help="comma list of teacher,base,base_guided,lora,heuristic")
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--rebuild-only", action="store_true", help="just rebuild eval.json from cached preds")
    args = ap.parse_args()
    load_dotenv()
    import os

    test = read_jsonl(SPLITS / "test.jsonl")
    if not test:
        raise SystemExit("data/splits/test.jsonl missing - run ml/make_splits.py")
    if args.limit:
        test = test[: args.limit]
    has_key = bool(os.environ.get("TINKER_API_KEY"))
    if args.roles == "auto":
        roles = ["heuristic"] + (["teacher", "base", "base_guided"] + (["lora"] if model_path() else [])
                                 if has_key else [])
    else:
        roles = [r.strip() for r in args.roles.split(",") if r.strip()]
    PREDS.mkdir(parents=True, exist_ok=True)
    if not args.rebuild_only:
        for role in roles:
            if role == "heuristic":
                preds = run_heuristic(test)
            else:
                if not has_key:
                    raise SystemExit("TINKER_API_KEY is not set (needed for role %r). Put it in .env." % role)
                preds = asyncio.run(run_tinker(role, test, args.concurrency))
                pt = sum(p["prompt_tokens"] for p in preds)
                ct = sum(p["completion_tokens"] for p in preds)
                add_spend(f"eval_{role}", {"model": ROLE_INFO[role]["model"], "prompt_tokens": pt,
                                           "completion_tokens": ct,
                                           "est_usd": round(sample_cost_usd(ROLE_INFO[role]["model"], pt, ct), 4)})
            for p in preds:
                p["role"] = role
                p["model_name"] = ROLE_INFO[role]["name"]
                if ROLE_INFO[role].get("model_path"):
                    p["model_path"] = ROLE_INFO[role]["model_path"]
            write_jsonl(PREDS / f"{role}.jsonl", preds)

    ev, by_role = build_eval(test)
    (RESULTS / "eval.json").write_text(json.dumps(ev, indent=2, ensure_ascii=False), encoding="utf-8")
    # flat predictions file with expected labels for inspection
    meta = {r["meta"]["id"]: r["meta"] for r in test}
    flat = []
    for role in ORDER:
        for i, p in by_role.get(role, {}).items():
            m = meta.get(i)
            if m:
                flat.append({**p, "title": m["title"], "nps_category": m["nps_category"],
                             "expected_decision": m["gold_decision"], "expected_decision_raw": m["gold_decision_raw"],
                             "gold_is_closed": m["gold_is_closed"]})
    write_jsonl(RESULTS / "predictions.jsonl", flat)
    cols = ["json_valid", "decision_acc", "decision_acc_raw", "decision_macro_f1", "closure_f1", "hazard_acc",
            "p50_latency_ms", "p95_latency_ms", "cost_per_1k_alerts_usd"]
    print(f"\ntest_size={ev['test_size']} label_source={ev['label_source']}")
    print(f"{'role':12s} " + " ".join(f"{c[:12]:>12s}" for c in cols))
    for r in ev["models"]:
        print(f"{r['role']:12s} " + " ".join(
            f"{'pending' if r.get('pending') else r.get(c)!s:>12s}"[:12].rjust(12) for c in cols))


if __name__ == "__main__":
    main()
