"""Extract every number the blog visuals use from the real result files.

Writes docs/visuals/data.js (window.TT = {...}). Nothing in the charts is typed by hand:
re-run this after any re-train / re-eval and re-render with render.py.

    python docs/visuals/build_data.py && python docs/visuals/render.py
"""
import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "data.js"


def load(p):
    return json.loads((ROOT / p).read_text(encoding="utf-8"))


ev = load("ml/results/eval.json")
tl = load("ml/results/train_log.json")
sp = load("ml/results/spend.json")

models = {m["role"]: m for m in ev["models"]}
conf = {k: v["matrix"] for k, v in ev["confusion"].items()}
labels = ev["confusion"]["base"]["labels"]
assert labels == ["go", "caution", "no_go"]

# --- before/after example (Ocmulgee boardwalk) -----------------------------
EX_ID = "DDCD23E7-9623-42F4-91AC-19E4661D616B"
preds = [json.loads(l) for l in (ROOT / "ml/results/predictions.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
ex_preds = {p["role"]: p for p in preds if p["id"] == EX_ID}
raw = load("data/raw/alerts.json")
alerts = raw["data"] if isinstance(raw, dict) and "data" in raw else raw
ex_alert = next(a for a in alerts if a["id"] == EX_ID)
parks = load("data/raw/parks.json")
park_name = parks["data"][ex_alert["parkCode"]]["fullName"]

# --- crash/resume timeline from agent/demo_logs/04_crash_resume.txt ---------
log = (ROOT / "agent/demo_logs/04_crash_resume.txt").read_text(encoding="utf-8")
demo = [(float(t), msg.strip()) for t, msg in re.findall(r"\[demo t\+\s*([\d.]+)s\]\s*(.*)", log)]
worker = [(w, ts, msg.strip()) for w, ts, msg in re.findall(r"worker#(\d) \| (\d\d:\d\d:\d\d\.\d+) \[worker\] (.*)", log)]


def secs(ts):
    t = datetime.strptime(ts, "%H:%M:%S.%f")
    return t.hour * 3600 + t.minute * 60 + t.second + t.microsecond / 1e6


# Align the worker wall clock to the demo's t+ clock: the workflow is started at t+3.0
# and worker #1 logs its first fetch_alerts at once. That anchor is consistent with every
# other ordering in the log (worker #2 'up' after t+9.1, retries after the 5 s heartbeat
# timeout that follows the t+6.0 kill, publish before the t+18.0 status check).
first_fetch = next(secs(ts) for w, ts, m in worker if m.startswith("[fetch_alerts]"))
wf_start = next(t for t, m in demo if "started TrailCardWorkflow" in m)
offset = first_fetch - wf_start


def t_of(ts):
    return round(secs(ts) - offset, 2)


def demo_t(pat):
    return next(t for t, m in demo if re.search(pat, m))


crash = {
    "workflow_id": re.search(r"id=(trailcard-\S+)", log).group(1),
    "parks": re.search(r"parks=\[(.*?)\]", log).group(1).replace("'", "").split(", "),
    "alerts_per_park": {p: int(n) for p, n in re.findall(r"park=(\w+) OK: (\d+) alerts", log)},
    "worker1_pid": int(re.search(r"worker #1 \(pid (\d+)\)", log).group(1)),
    "worker2_pid": int(re.search(r"worker#2 \| \S+ \[worker\] worker pid=(\d+)", log).group(1)),
    "t_worker1_start": demo_t(r"starting worker #1"),
    "t_wf_start": wf_start,
    "t_progress": demo_t(r"progress before crash"),
    "done_before_crash": int(re.search(r"classify_alerts (\d+)/(\d+) alerts", log).group(1)),
    "total_alerts": int(re.search(r"classify_alerts (\d+)/(\d+) alerts", log).group(2)),
    "t_kill": demo_t(r"\[CRASH\]"),
    "t_dead": demo_t(r"worker #1 is dead"),
    "in_flight": int(re.search(r"(\d+) classify_alert activities in flight", log).group(1)),
    "history_len_at_crash": int(re.search(r"history length=(\d+)", log).group(1)),
    "t_worker2_start": demo_t(r"starting worker #2"),
    "t_done": demo_t(r"workflow COMPLETED"),
    "scheduled": int(re.search(r"activities scheduled\s*: (\d+)", log).group(1)),
    "kept": int(re.search(r"completed before the crash\s*: (\d+)", log).group(1)),
    "after_restart": int(re.search(r"completed after restart\s*: (\d+)", log).group(1)),
    "retried": int(re.search(r"needed attempt >= 2\s*: (\d+)", log).group(1)),
    "history_events": int(re.search(r"total history events\s*: (\d+)", log).group(1)),
    "heartbeat_s": int(re.search(r"(\d+)s heartbeat timeout", log).group(1)),
    "downtime_s": float(re.search(r"waiting ([\d.]+)s of downtime", log).group(1)),
    "worker_events": [
        {"w": int(w), "clock": ts, "t": t_of(ts), "msg": m} for w, ts, m in worker
    ],
    "anchor_note": "worker clock aligned to demo clock at workflow start (first fetch_alerts = t+%.1fs)" % wf_start,
}

data = {
    "test_size": ev["test_size"],
    "test_by_category": ev["test_by_category"],
    "models": {
        r: {k: m[k] for k in ("name", "decision_acc", "decision_macro_f1", "hazard_acc", "closure_f1",
                               "cost_per_1k_alerts_usd", "p50_latency_ms", "decision_acc_raw")}
        for r, m in models.items()
    },
    "confusion": conf,
    "labels": labels,
    "nogo_total": {r: sum(m[2]) for r, m in conf.items()},
    "nogo_row": {r: m[2] for r, m in conf.items()},
    "train": {
        "loss": tl["loss_curve"],
        "test_loss": tl["test_loss"],
        "steps": tl["steps"], "epochs": tl["epochs"], "rank": tl["lora_rank"],
        "lr": tl["learning_rate"], "batch": tl["batch_size"],
        "train_examples": tl["train_examples"], "test_examples": tl["test_examples"],
        "wall_seconds": tl["wall_seconds"], "base_model": tl["base_model"],
    },
    "spend": {"stages": {k: {"usd": v["est_usd"], "model": v["model"]} for k, v in sp["stages"].items()},
              "total": sp["total_est_usd"], "note": sp["note"],
              "teacher_rows": sp["stages"]["teacher_label"]["rows"]},
    "example": {
        "id": EX_ID, "park_code": ex_alert["parkCode"], "park_name": park_name,
        "title": ex_alert["title"], "description": ex_alert["description"],
        "category": ex_alert["category"],
        "expected": ex_preds["lora"]["expected_decision"],
        "base": ex_preds["base"]["verdict"], "lora": ex_preds["lora"]["verdict"],
        "teacher": ex_preds["teacher"]["verdict"],
    },
    "crash": crash,
}

OUT.write_text("// generated by build_data.py from ml/results + agent/demo_logs; do not edit\nwindow.TT = "
               + json.dumps(data, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")
print("wrote", OUT)
print("nogo rows:", data["nogo_row"])
print("crash offset (s):", round(offset, 3), "events:", [(e["clock"], e["t"]) for e in crash["worker_events"]])
print("park:", park_name)
