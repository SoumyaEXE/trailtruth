# TrailTruth ML: distilling a big model into a 4B one with Tinker

We distill a large open model (the **teacher**) into a small one (the **student**) so it can turn NPS alerts into strict `TrailVerdict` JSON (see `shared/schema.py`).

| role | model (Tinker id) | why |
|---|---|---|
| teacher | `Qwen/Qwen3.5-397B-A17B` (non-thinking) | The largest instruct Qwen on Tinker. The Tinker docs name it as the replacement for the retired Qwen3-235B-A22B-Instruct. It produced valid JSON for 627/627 alerts on the first try. |
| student | `Qwen/Qwen3.5-4B` (non-thinking), LoRA rank 32 | The smallest LoRA-trainable instruct model on Tinker (checked with `ServiceClient().get_server_capabilities()` on 2026-10-10). Llama-3.2-1B/3B and Qwen3-4B-Instruct were retired on 2026-06-12. It shares the teacher's tokenizer and chat template (cookbook renderer `qwen3_5_disable_thinking`). |

The model ids are set in `ml/common.py` and can be overridden with the env vars `TRAILTRUTH_TEACHER` and `TRAILTRUTH_STUDENT`.

## Pipeline (run in this order)

Setup, done once (Windows / Git Bash shown; Python 3.12+; 3.14 works):

```bash
python -m venv ml/.venv
ml/.venv/Scripts/python -m pip install -r ml/requirements.txt
# repo-root .env (gitignored):  TINKER_API_KEY=...   NPS_API_KEY=...   (scripts load it themselves)
```

| # | command | what it does | time | est. cost |
|---|---|---|---|---|
| 0 | `ml/.venv/Scripts/python ml/fetch_alerts.py` | Fetches all NPS alerts plus park names into `data/raw/`. It skips the download if the data is already cached; pass `--force` to refetch. | <1 min | free |
| 1 | `ml/.venv/Scripts/python ml/weak_label.py` | Labels alerts with keyword rules (`data/labeled/heuristic.jsonl`). No key needed. | 1 s | free |
| 2 | `ml/.venv/Scripts/python ml/teacher_label.py` | The teacher labels all 627 alerts through Tinker sampling (`data/labeled/teacher.jsonl`). Safe to resume after an interruption. | ~1 min (32 concurrent) | ~$0.95 |
| 3 | `ml/.venv/Scripts/python ml/make_splits.py` | Builds the train/test split in chat format (`data/splits/`). | 1 s | free |
| 4 | `ml/.venv/Scripts/python ml/eval.py --roles heuristic,teacher,base,base_guided` | Scores the baselines on the test split. | ~3 min | ~$0.24 |
| 5 | `ml/.venv/Scripts/python ml/train_tinker.py` | LoRA SFT of the student. Writes `ml/results/train_log.json` and `ml/results/model_path.txt`. | ~10-15 min | ~$0.35 |
| 6 | `ml/.venv/Scripts/python ml/eval.py --roles lora` | Scores the fine-tuned student and rebuilds `ml/results/eval.json`. | ~1 min | ~$0.02 |
| opt | `ml/.venv/Scripts/python ml/download_adapter.py --peft` | Downloads the LoRA (cookbook `weights.download`) and converts it to PEFT format for vLLM, SGLang or llama.cpp. | few min | free |

**Total end-to-end cost is about $1.6** (token estimates are in `ml/results/spend.json`). The scripts check for `TINKER_API_KEY` first and exit with a clear message if it is missing.

## Results (real run, 2026-10-10, test n=126)

| model | json_valid | decision_acc | decision_acc_raw | macro-F1 | closure_f1 | hazard_acc (vs teacher) | p50 ms | p95 ms | $ / 1k alerts |
|---|---|---|---|---|---|---|---|---|---|
| teacher (Qwen3.5-397B-A17B) | 1.0 | 0.6508 | 0.6349 | 0.6415 | 0.9231 | 0.9841 | 2405.15 | 3073.88 | 1.4982 |
| Qwen3.5-4B base | 1.0 | 0.6429 | 0.627 | 0.6307 | 0.8889 | 0.6111 | 2354.15 | 2701.38 | 0.1282 |
| Qwen3.5-4B base + teacher's long prompt | 1.0 | 0.6746 | 0.6746 | 0.6481 | 0.8444 | 0.7063 | 2433.15 | 2905.92 | 0.2409 |
| Qwen3.5-4B + TrailTruth LoRA | 1.0 | 0.746 | 0.754 | 0.7422 | 0.8842 | 0.8333 | 2371.1 | 3289.9 | 0.1314 |
| keyword heuristic (no model) | 1.0 | 0.5794 | 0.5556 | 0.5859 | 0.8738 | 0.627 | 0.07 | 0.2 | 0.0 |

- LoRA vs base 4B (same short prompt, same cost): decision accuracy **0.643 -> 0.746** (+10 pts), macro-F1 0.631 -> 0.742, hazard agreement with the teacher 0.61 -> 0.83. Recall on no_go alerts went from 17/33 to 28/33.
- LoRA vs teacher: higher decision accuracy against the NPS gold (0.746 vs 0.651) at **~11x lower cost** ($0.13 vs $1.50 per 1k alerts). The teacher was never trained toward the NPS labels and the LoRA was, so this is partly calibration to the gold, not general smarts. The teacher still wins on closure_f1 (whose gold partly comes from the teacher) and on hazard agreement (which is self-agreement for the teacher).
- Giving the base 4B the teacher's long prompt (`base_guided`) helps a little (0.675) but costs about 2x more tokens, and it is still worse than the LoRA.
- Latency through Tinker's hosted sampler is about 2.4 s p50 for every model. Per-request overhead dominates, so the latency gain needs self-hosting the 4B adapter (`download_adapter.py`).
- Training: 96 steps, 3 epochs, rank 32, lr 4.91e-04. Held-out NLL went 0.338 -> 0.223 (epoch 1) -> 0.223 (epoch 2) -> 0.286 (epoch 3, mild overfit). We kept the final epoch-3 weights and did **not** pick a checkpoint on the test set.
- Total spend for the whole pipeline: about **$1.60** (see `ml/results/spend.json`).
- The famous alerts (Chickamauga barred owl, Kīlauea closures) fall in the *train* split, so they are not in eval.json's test examples.

## Design choices (and the honest caveats)

**Gold labels.** The NPS `category` is a real human label. `CATEGORY_TO_DECISION` maps it to a decision: Information→go, Caution→caution, Danger/Park Closure→no_go.
- **One adjustment** (`ml/common.derive_gold`): a *Park Closure* alert whose title only mentions facilities gets gold `caution`. Examples are parking lots, visitor centers, bookstores and campgrounds, with no trail, road or area named. Closing a visitor center does not stop you hiking. This affects 23 of 627 alerts. `decision_acc_raw` in eval.json reports accuracy against the unadjusted mapping.
- **Left as-is but flagged:** 64 *Information/Caution* alerts have "closed/closure" in the title, e.g. "Rend Trail Closed through December 2027". NPS still calls them Information (gold `go`). We keep the human label. The model still reports `is_closed=true` and the trail name, so the card can say "Go, but skip Rend Trail".
- The teacher agrees with the NPS-derived gold on only about 63% of alerts. Much of that gap is NPS labeling noise. For example, the teacher calls "Main Street Walpack Bridge Closed Until Further Notice" a no_go, but NPS filed it as Information. We report both `decision_acc` (vs gold) and `decision_agree_teacher`.

**SFT target.** The target is the teacher's JSON, with `decision` replaced by the gold decision when the two disagree (235 of 627 alerts). `severity` is then re-aligned to the decision (go=1, caution=2, no_go=3). `hazard_type`, `trails_affected`, `is_closed` and `reason` come from the teacher. Caveat: in a few overridden rows the teacher's `reason` reads more severely than the gold decision.

**Prompt distillation.** The teacher labels with `SYSTEM_PROMPT` plus a longer rules block (`TEACHER_GUIDE` in `ml/common.py`). The student is trained and served with the short production `SYSTEM_PROMPT` only. That cuts about 340 prompt tokens per call. The `base_guided` eval row tests whether simply giving the base 4B the long prompt is enough.

**Splits.** The split is stratified by NPS category, about 80/20, with seed 42. Alerts whose titles match after normalisation are always kept in the same split, which catches the same notice posted to several parks; 0 title groups are shared. The split depends only on alert ids, titles and categories, so the test set is identical for heuristic and teacher labels. Sizes: 501 train / 126 test.

**Training.** We use the cookbook renderer and `conversation_to_datum(..., TrainOnWhat.LAST_ASSISTANT_MESSAGE)`, so loss is computed only on the assistant JSON. Settings:
- LoRA rank 32
- learning rate from `hyperparam_utils.get_lr("Qwen/Qwen3.5-4B")`, about 4.9e-4, with linear decay
- batch 16, 3 epochs (96 steps)
- `forward_backward(..., "cross_entropy")` followed by `optim_step(AdamParams)`

Held-out NLL is logged every epoch. The weights are saved with `save_weights_for_sampler`, and the resulting `tinker://...` path goes in `ml/results/model_path.txt`.

**Metrics** (`ml/eval.py`; one attempt per alert, temperature 0, no retries, same concurrency for all models):
- `json_valid`
- `decision_acc` and `decision_acc_raw`
- `decision_macro_f1`
- `closure_f1`: gold is `category=='Park Closure'` OR teacher `is_closed`. This is biased in the teacher's favour.
- `hazard_acc` and `decision_agree_teacher`: agreement with the teacher labels
- p50/p95 latency: wall-clock time of each Tinker sampling request, including network and queueing. Through the hosted API it is dominated by per-request overhead, so model size barely changes it. The latency win comes from serving the 4B adapter yourself (see `download_adapter.py`).
- `cost_per_1k_alerts_usd`: measured tokens × Tinker list prices (prefill + sample, uncached)

## Using the model (`ml/infer.py`)

```python
import sys; sys.path.insert(0, "<repo root>")
from ml.infer import classify, classify_batch
verdict, latency_ms, model_name = classify(title, description)
```

The provider is chosen by `TRAILTRUTH_MODEL_PROVIDER`:
- `tinker`: uses the LoRA at `TRAILTRUTH_TINKER_MODEL_PATH`, or `ml/results/model_path.txt` if that is unset.
- `openai`: any OpenAI-compatible server, set with `TRAILTRUTH_BASE_URL` and `TRAILTRUTH_MODEL`.
- `heuristic`: the keyword rules.
- Unset: uses Tinker if a key and a model path exist, otherwise the heuristic.

`tinker` is imported lazily, so the heuristic and openai providers only need pydantic and httpx.

## Files
- `data/raw/alerts.json`, `data/raw/parks.json`: NPS API snapshot from 2026-10-10 (627 alerts, 276 parks)
- `data/labeled/{heuristic,teacher}.jsonl`: labels per alert, with gold fields, raw output, tokens and latency
- `data/splits/{train,test}.jsonl` and `split_stats.json`
- `ml/results/eval.json` (contract shape plus extra fields), `predictions.jsonl`, `preds/<role>.jsonl`, `train_log.json`, `model_path.txt`, `spend.json`
