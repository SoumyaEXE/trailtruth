"""Deterministic, leakage-safe train/test split in chat format.

    python ml/make_splits.py                 # uses teacher labels if available, else heuristic
    python ml/make_splits.py --labels heuristic

- Stratified by NPS category, ~80/20, seed 42.
- Near-duplicate alerts (same title after normalisation, e.g. the same notice posted to several
  parks) are grouped and always land in the same split -> no train/test leakage.
- The split depends only on alert ids/titles/categories, NOT on the labeler, so the test set is
  identical whether you split heuristic or teacher labels.
- SFT target (assistant turn) = teacher verdict JSON, except `decision` is replaced by the gold
  decision (NPS category, see ml/common.derive_gold) when they disagree, and `severity` is then
  re-aligned to the decision (go=1, caution=2, no_go=3). The original teacher verdict is kept in
  meta.teacher_verdict for evaluation of hazard_type / closure.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.common import (LABELED, SPLITS, SYSTEM_PROMPT, derive_gold, first_park_code, load_alerts, read_jsonl,
                       utf8_stdout, verdict_json, write_jsonl)
from shared.schema import TrailVerdict, user_prompt

SEED = 42
TEST_FRAC = 0.2
SEV = {"go": 1, "caution": 2, "no_go": 3}


def norm_title(t: str) -> str:
    return re.sub(r"[^a-z]+", " ", t.lower()).strip()


def split_ids(alerts: list[dict]) -> tuple[set[str], set[str]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for a in alerts:
        groups[norm_title(a["title"])].append(a)
    by_cat: dict[str, list[list[dict]]] = defaultdict(list)
    for key in sorted(groups):
        g = groups[key]
        cat = Counter(a.get("category") for a in g).most_common(1)[0][0]
        by_cat[cat].append(g)
    rng = random.Random(SEED)
    train, test = set(), set()
    for cat in sorted(by_cat):
        gs = by_cat[cat]
        rng.shuffle(gs)
        total = sum(len(g) for g in gs)
        target = max(1, round(total * TEST_FRAC))
        n = 0
        for g in gs:
            if n < target:
                test.update(a["id"] for a in g)
                n += len(g)
            else:
                train.update(a["id"] for a in g)
    return train, test


def main() -> None:
    utf8_stdout()
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", choices=["auto", "teacher", "heuristic"], default="auto")
    args = ap.parse_args()

    alerts = load_alerts()
    teacher = {r["id"]: r for r in read_jsonl(LABELED / "teacher.jsonl") if r.get("valid")}
    heur = {r["id"]: r for r in read_jsonl(LABELED / "heuristic.jsonl") if r.get("valid")}
    src = args.labels
    if src == "auto":
        src = "teacher" if len(teacher) >= 0.9 * len(alerts) else "heuristic"
    labels = teacher if src == "teacher" else heur
    if not labels:
        raise SystemExit(f"no {src} labels found - run ml/teacher_label.py or ml/weak_label.py first")

    train_ids, test_ids = split_ids(alerts)
    rows = {"train": [], "test": []}
    overrides = Counter()
    skipped = 0
    for a in alerts:
        lab = labels.get(a["id"])
        if lab is None:
            skipped += 1
            continue
        g = derive_gold(a)
        v = TrailVerdict.model_validate(lab["verdict"])
        target = v.model_copy()
        if target.decision != g["gold_decision"]:
            overrides[(v.decision, g["gold_decision"])] += 1
            target = target.model_copy(update={"decision": g["gold_decision"], "severity": SEV[g["gold_decision"]]})
        tv = teacher.get(a["id"], {}).get("verdict")
        meta = {
            "id": a["id"], "park_code": first_park_code(a), "title": a["title"], "nps_category": a.get("category"),
            **g,
            "gold_is_closed": bool(g["gold_is_closed_cat"] or (tv or {}).get("is_closed", False)),
            "teacher_verdict": tv, "label_source": src,
        }
        rec = {
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt(a["title"], a.get("description", ""))},
                {"role": "assistant", "content": verdict_json(target)},
            ],
            "meta": meta,
        }
        rows["test" if a["id"] in test_ids else "train"].append(rec)

    SPLITS.mkdir(parents=True, exist_ok=True)
    write_jsonl(SPLITS / "train.jsonl", rows["train"])
    write_jsonl(SPLITS / "test.jsonl", rows["test"])
    stats = {
        "label_source": src, "seed": SEED, "test_frac": TEST_FRAC,
        "train": len(rows["train"]), "test": len(rows["test"]), "skipped_unlabeled": skipped,
        "train_by_category": dict(Counter(r["meta"]["nps_category"] for r in rows["train"])),
        "test_by_category": dict(Counter(r["meta"]["nps_category"] for r in rows["test"])),
        "decision_overrides_label_to_gold": {f"{a}->{b}": n for (a, b), n in overrides.most_common()},
        "title_groups_shared_across_splits": 0,
    }
    tr_t = {norm_title(r["meta"]["title"]) for r in rows["train"]}
    stats["title_groups_shared_across_splits"] = sum(norm_title(r["meta"]["title"]) in tr_t for r in rows["test"])
    (SPLITS / "split_stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
