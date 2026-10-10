# TrailTruth — shared build contract

> National-park alerts → one go/no-go trail card. Check once, then go outside.

Hackathon: DEV "Hacktoberfest Open-Source AI Challenge — Week 1: Touch Grass".
Deadline **2026-10-11 23:59 PDT**. Target categories: **Tinker** (main, $200), **Temporal**, **Entire**, optionally **Render** / **Sentry**.

## Story in one paragraph
NPS publishes ~600 live alerts (`https://developer.nps.gov/api/v1/alerts`, `api_key=DEMO_KEY` works) — barred owls dive-bombing hikers, volcano closures, washed-out bridges. They're walls of text. We **distill a big open-weight model into a tiny one with Tinker**: a large open model labels every alert into strict JSON (teacher), then we LoRA-fine-tune a 1–3B open model (student) on Tinker. We show base-student vs LoRA-student vs teacher on held-out alerts (JSON-valid rate, decision accuracy, closure F1, latency, cost). A **Temporal** workflow runs weekly: fetch alerts for your saved parks → classify (retries on flaky API/model) → render ONE printable trail card. Then the app shuts up. KPI: minutes *not* spent in the app.

## Repo layout (each owner touches only their dir)
```
data/            raw + labeled alerts, train/test splits          (ML agent)
ml/              python: fetch, teacher label, train_tinker, eval  (ML agent)
ml/results/      eval.json, predictions.jsonl, charts              (ML agent)
agent/           python: Temporal workflows/activities/worker + FastAPI  (Backend agent)
web/             Next.js 16 + BoardUI dashboard                    (UI agent)
docs/            DEV post draft, screenshots                       (Writer agent)
shared/schema.py canonical schema (do not change without updating web/lib/types.ts)
```

## Canonical model output — `TrailVerdict`
The model receives `title` + `description` (+ `category` NOT given to the model; it is a held-out label) and must emit exactly this JSON:
```json
{
  "hazard_type": "closure|wildlife|weather|fire|water|geologic|construction|air_quality|road|facility|other",
  "severity": 1,                    // 1 = info, 2 = caution, 3 = danger
  "trails_affected": ["Bluff Trail"],
  "is_closed": false,
  "decision": "go|caution|no_go",
  "reason": "Territorial barred owl on Bluff Trail section; stay alert."   // <= 20 words
}
```
Ground truth: NPS `category` (Danger / Caution / Park Closure / Information) is a *real* human label → maps to expected decision:
`Information→go`, `Caution→caution`, `Danger→no_go`, `Park Closure→no_go` (if the closure affects trails/areas) — teacher labels fill hazard_type/trails/reason.

## Processed alert record (what backend serves, what UI renders) — `ProcessedAlert`
```json
{
  "id": "6822FAF9-...", "park_code": "chch", "park_name": "Chickamauga & Chattanooga NMP",
  "title": "...", "description": "...", "url": "", "nps_category": "Caution",
  "last_indexed": "2026-10-09",
  "verdict": { TrailVerdict },
  "model": "llama-3.2-1b-trailtruth-lora", "latency_ms": 212
}
```

## TrailCard — the one thing the user takes outside
```json
{
  "id": "card_2026-10-11_chch-havo", "generated_at": "ISO", "week_of": "2026-10-11",
  "parks": [ { "park_code": "havo", "park_name": "...", "decision": "go|caution|no_go",
               "headline": "Go — but skip Halemaʻumaʻu Trail", "closed_trails": ["..."],
               "watch_for": ["..."], "alert_ids": ["..."] } ],
  "overall": "go|caution|no_go", "workflow_id": "trailcard-...", "model": "..."
}
```

## Backend API (FastAPI, `http://localhost:8000`)
- `GET  /api/health`
- `GET  /api/parks` → `[{park_code, park_name, states, alert_count, worst_decision}]`
- `GET  /api/alerts?park=havo` → `ProcessedAlert[]`
- `POST /api/cards` body `{parks: ["havo","chch"]}` → starts Temporal workflow, returns `{workflow_id}`
- `GET  /api/cards/{workflow_id}` → `{status, card?: TrailCard, steps: [{name, status, attempt, started_at, ended_at, error?}]}`
- `GET  /api/runs` → recent workflow runs (same shape, no card)
- `GET  /api/eval` → contents of `ml/results/eval.json`

## `ml/results/eval.json`
```json
{
  "test_size": 120, "generated_at": "ISO",
  "models": [
    {"name": "teacher (Qwen3-235B)", "role": "teacher", "json_valid": 0.99, "decision_acc": 0.9, "closure_f1": 0.9, "hazard_acc": 0.8, "p50_latency_ms": 1800, "cost_per_1k_alerts_usd": 0.9},
    {"name": "Llama-3.2-1B base", "role": "base", ...},
    {"name": "Llama-3.2-1B + TrailTruth LoRA", "role": "lora", ...}
  ],
  "confusion": {"lora": {"labels": ["go","caution","no_go"], "matrix": [[..]]}},
  "training": {"steps": 0, "epochs": 0, "lora_rank": 32, "loss_curve": [[step, loss], ...]},
  "examples": [{"title": "...", "base_output": "...", "lora_output": "...", "expected_decision": "..."}]
}
```

## Model providers (pluggable, env `TRAILTRUTH_MODEL_PROVIDER`)
- `tinker` — Tinker SamplingClient on saved LoRA weights (`TINKER_API_KEY`, `TRAILTRUTH_TINKER_MODEL_PATH`)
- `openai` — any OpenAI-compatible local server (Ollama / llama.cpp / vLLM) via `TRAILTRUTH_BASE_URL`, `TRAILTRUTH_MODEL`
- `heuristic` — deterministic keyword fallback so everything runs with zero keys (dev/demo only; clearly labeled)

## Fixtures
Until real results exist, everyone codes against `shared/fixtures/*.json` (written by the backend agent from real NPS data + heuristic verdicts). The UI must render from `web/public/fixtures/` when the API is down (static demo deploy).
