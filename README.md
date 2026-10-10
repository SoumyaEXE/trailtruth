# TrailTruth

**627 national-park alerts → one printed go/no-go trail card. Check once, then go outside.**

TrailTruth reads every live U.S. National Park Service alert (barred owls on Bluff Trail, Kīlauea seismicity closing Halemaʻumaʻu, washed-out bridges) and turns them into a single weekly card for the parks you care about.

- **Distilled with [Tinker](https://thinkingmachines.ai/tinker/):** `Qwen3.5-397B` labels all 627 alerts → LoRA fine-tune of `Qwen3.5-4B`. On 126 held-out alerts the 4B student goes from **64.3% → 74.6%** decision accuracy (teacher: 65.1%) at **~11× lower cost** per alert. Whole pipeline: **~$1.60**.
- **Durable with [Temporal](https://temporal.io):** fetch → classify → compose → publish, with retries for flaky NPS/model calls, a 429 fallback to cache, and a weekly Friday schedule. Kill the worker mid-run and it resumes without redoing finished work.
- **Built in the open with [Entire](https://entire.io):** agent sessions behind the code are recorded as checkpoints.

Write-up: [`docs/POST.md`](docs/POST.md) · Results: [`ml/results/eval.json`](ml/results/eval.json)

## Layout

| Dir | What |
|---|---|
| `ml/` | fetch alerts, teacher labeling, splits, Tinker LoRA training, eval, `infer.py` (tinker / openai-compatible / heuristic providers) |
| `agent/` | Temporal workflows + activities + worker, FastAPI, crash/chaos demos, schedule |
| `web/` | Next.js + [BoardUI](https://boardui.com) dashboard: overview, printable trail card, alerts table, Model Lab, workflow runs |
| `data/` | raw NPS alerts, teacher/heuristic labels, train/test splits |
| `shared/` | canonical schema + fixtures |
| `docs/` | DEV post, images |

## Run it

```bash
cp .env.example .env            # NPS_API_KEY, TINKER_API_KEY (optional — falls back to a heuristic)

# backend: Temporal dev server (:7233, UI :8233) + worker + API (:8000)
python -m venv agent/.venv && agent/.venv/Scripts/pip install -r agent/requirements.txt -r agent/requirements-tinker.txt
agent/.venv/Scripts/python -m agent.dev

# durability demo: kills the worker mid-run, restarts it, workflow resumes
agent/.venv/Scripts/python -m agent.demo_crash

# frontend (:3000) — works without the API using bundled fixtures
cd web && npm install && npm run dev
```

Reproducing the model: see [`ml/README.md`](ml/README.md).

## License

MIT
