# TrailTruth backend (`agent/`)

A durable agent that turns National Park Service alerts into one go/no-go trail card per week.
It runs as a **Temporal workflow**, so flaky NPS calls and model calls get retried, and if the
worker process dies partway through, a new worker continues from where the old one stopped.

```
TrailCardWorkflow(parks)
  ├─ fetch_alerts(park)    × N  parallel · retries with exponential backoff (1s→20s, 6 attempts)
  │                             4xx = non-retryable · 429 → disk cache / snapshot fallback
  ├─ classify_alert(alert) × M  4 at a time · heartbeats (5s timeout) · retries on timeout / invalid JSON
  │                             · attempt 5 falls back to the heuristic
  ├─ compose_card               deterministic: worst decision per park, closed trails, watch_for
  └─ publish_card               atomic write → agent/state/cards/{id}.json
progress query → per-step status / attempt / error  (GET /api/cards/{id})
Temporal Schedule "trailtruth-weekly" → Fridays 07:00 America/Los_Angeles
```

## Run it (one command)

```bash
# Python 3.12 (3.14 wheels are spotty). From the repo root:
python -m venv agent/.venv          # or: uv venv -p 3.12 agent/.venv
agent/.venv/Scripts/pip install -r agent/requirements.txt      # Linux/mac: agent/.venv/bin/pip

agent/.venv/Scripts/python -m agent.dev
```

This starts three things:

| what | where |
|---|---|
| Temporal dev server (official CLI. `WorkflowEnvironment.start_local()` downloads it on first run, ~160 MB) | `localhost:7233`, stored in `agent/state/temporal-dev.db` |
| Temporal Web UI | http://localhost:8233 |
| Worker (`python -m agent.worker`) | task queue `trailtruth` |
| FastAPI (`uvicorn agent.api:app`) | http://localhost:8000 |

Configuration comes from env vars or the repo-root `.env` (see `agent/.env.example`). `NPS_API_KEY`
falls back to `DEMO_KEY`, which is heavily rate-limited (it returned HTTP 429 with a 16h Retry-After
during the build). API keys are never logged: URLs are redacted to `api_key=***`.

### Try it

```bash
curl localhost:8000/api/health
curl "localhost:8000/api/parks?with_alerts=true"
curl "localhost:8000/api/alerts?park=havo"
curl -X POST localhost:8000/api/cards -H 'content-type: application/json' -d '{"parks":["havo","chch","yell"]}'
curl localhost:8000/api/cards/<workflow_id>      # {status, card?, steps:[{name,status,attempt,started_at,ended_at,error?}]}
curl localhost:8000/api/runs
curl localhost:8000/api/eval                     # ml/results/eval.json, else the fixture
```

CLI equivalent with live narration: `python -m agent.run_card havo chch yell`

## Demos (transcripts in `agent/demo_logs/`)

| file | command | shows |
|---|---|---|
| `00_dev_stack.txt` | `python -m agent.dev` | server, worker and API come up |
| `01_happy_path.txt` | `python -m agent.run_card havo chch yell` | full run against the live NPS API |
| `02_chaos_retries.txt` (+ `.worker.txt`) | worker with `TRAILTRUTH_CHAOS=1`, then `run_card havo chch yell zion` | fake NPS 503s retried with backoff (havo succeeds on attempt 3); model hangs caught by the heartbeat timeout; invalid JSON retried |
| `03_nps_429_fallback.txt` | worker with `NPS_API_KEY=DEMO_KEY TRAILTRUTH_NPS_CACHE_TTL=0` | real HTTP 429 from NPS; falls back to the stale cache or the snapshot, and the log says which |
| `04_crash_resume.txt` | `python -m agent.demo_crash` | worker hard-killed partway through classification. The new worker re-runs only the 4 in-flight activities. Event history confirms 21 scheduled, 8 done before the crash, none re-run |
| `05_api_cards.txt` | `curl POST /api/cards` + poll | API ↔ workflow progress query |
| `06_refresh.txt` | `python -m agent.refresh` | batch fetch and classification of all 627 live alerts for `/api/alerts` |
| `07_schedule.txt` | `python -m agent.schedule create/trigger/describe` | weekly Temporal Schedule |
| `11_happy_path_lora.txt` (+ `.worker.txt`) | same as 01, provider=tinker | 18 alerts classified by the real LoRA in about 12 s |
| `12_chaos_retries_lora.txt` (+ `.worker.txt`) | same as 02, provider=tinker | 503s, hangs and invalid JSON retried, with real model calls |
| `14_crash_resume_lora.txt` | `python -m agent.demo_crash`, provider=tinker | kill partway through classification with real LoRA calls: 21 scheduled, 10 done before the crash, 6 in flight and retried |
| `16_refresh_lora.txt` | `python -m agent.refresh` | all 627 live alerts classified by the LoRA (627/627 valid, no fallbacks) |
| `17_schedule_lora.txt` | `python -m agent.schedule trigger` | scheduled run on the tinker worker |

### Chaos knobs
`TRAILTRUTH_CHAOS=1` turns on fault injection. The default rates are `TRAILTRUTH_CHAOS_503_P=0.30`,
`TRAILTRUTH_CHAOS_HANG_P=0.08` and `TRAILTRUTH_CHAOS_JSON_P=0.10`. Chaos only fires on attempts 1–2,
so every demo run finishes. `TRAILTRUTH_CLASSIFY_DELAY=1.2` simulates model latency.

### Crash demo
```bash
python -m agent.dev --server-only        # terminal 1 (or the full stack)
python -m agent.demo_crash               # terminal 2: starts worker #1, starts a workflow,
                                         # taskkill /F (or SIGKILL) partway through, starts worker #2
```
`demo_crash` runs on its own private task queue, so a dev-stack worker that is already running can't
pick up its work and spoil the demo. The killed worker's in-flight activities are retried after their
5s heartbeat timeout. `sticky_queue_schedule_to_start_timeout=2s` makes the workflow move to the new
worker quickly.

## Model providers
If `TRAILTRUTH_MODEL_PROVIDER` is not set, the provider is chosen automatically:
- **`tinker`** when `TINKER_API_KEY` is set and a LoRA path exists (`TRAILTRUTH_TINKER_MODEL_PATH` or
  `ml/results/model_path.txt`). This runs Qwen3.5-4B + the TrailTruth LoRA through `ml/infer.py`.
  It needs `pip install -r agent/requirements-tinker.txt`, which pulls in torch and transformers for
  the tokenizer.
- **`heuristic`** otherwise (`heuristic-keywords-v1`).

Setting `TRAILTRUTH_MODEL_PROVIDER` explicitly overrides this, and `openai` also goes through
`ml/infer.py`. The worker pays the Tinker cold start once at boot (13–32 s in our runs) before it
starts polling. `/api/health` reports the provider, the model and a shortened model path; keys are
never shown. If `ml/infer.py` fails to import, the agent logs a warning and uses the heuristic.
`refresh` sends all alerts to `ml.infer.classify_batch` in batches of 64: all 627 alerts took about
35 s after warm-up.

## Sentry agent tracing (optional)
Set `SENTRY_DSN` to turn it on. Each classify attempt becomes a `gen_ai.invoke_agent` transaction
("invoke_agent TrailTruth") with a `gen_ai.chat` child span. The child span carries
`gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.{input,output,total}_tokens`
(estimated from characters for local models), `trailtruth.model_latency_ms` and `trailtruth.cost_usd`.
NPS fetches are `gen_ai.execute_tool` transactions. Without a DSN all of this does nothing.

## Data and fixtures
- `python -m agent.refresh` fetches every live alert, classifies it, and writes `agent/state/processed/`.
  `/api/alerts` and `/api/parks` serve those files and fall back to `shared/fixtures/`.
- `python -m agent.make_fixtures [--real-runs]` rebuilds `shared/fixtures/*.json` and copies them to
  `web/public/fixtures/`. The fixtures use real NPS alerts with heuristic verdicts. `--real-runs`
  copies showcase runs captured from Temporal into `runs.json`, `card_status.json` and `card.json`.
  `eval.json` there is a placeholder (`"fixture": true`). `/api/eval` serves `ml/results/eval.json`
  when that file exists.
- If Temporal can't be reached, `POST /api/cards` still runs the same pipeline in-process. The run is
  labelled `"mode": "inline"` and is not durable.

## Deploy (Render)
See the root `render.yaml` (Render Blueprint: API + static dashboard). For the demo, one web service runs `python -m agent.dev` (dev server, worker
and API in a single container). That survives worker crashes but not container restarts, because the
SQLite database is on ephemeral disk. For real durability, point `TEMPORAL_ADDRESS`,
`TEMPORAL_NAMESPACE` and `TEMPORAL_API_KEY` at Temporal Cloud and run `agent.worker` as a separate
service.

## Files
`workflows.py` (TrailCardWorkflow, WeeklyScheduleWorkflow) · `activities.py` · `worker.py` · `api.py` ·
`runs.py` (workflow → API run shape) · `schedule.py` · `demo_crash.py` · `run_card.py` · `dev.py` ·
`refresh.py` · `nps.py` (cache + 429 fallback) · `model.py` (provider dispatch) · `heuristic.py` ·
`compose.py` · `telemetry.py` (Sentry) · `inline.py` (no-Temporal fallback) · `make_fixtures.py`
