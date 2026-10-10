---
title: "I Distilled a 397B Model Into a 4B One for $1.60. It Now Catches 28 of 33 Park Alerts That Should Stop Your Hike."
published: false
description: A Qwen3.5-4B LoRA trained on Tinker reads all 627 live National Park Service alerts, is graded against the rangers' own labels, and prints one go/no-go trail card a week. Then it stops talking.
tags: devchallenge, hf26challenge, ai, opensource
cover_image: https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/cover.png
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05)*

I had **Qwen3.5-397B** label every live National Park Service alert, 627 of them, then used Tinker to fine-tune **Qwen3.5-4B** on its homework, with the rangers' own categories as the answer key. On 126 held-out alerts the fine-tuned 4B went from catching **17 of 33** alerts that should stop a hiker to **28 of 33**, and from **64.3% to 74.6%** decision accuracy. The gain holds up statistically (paired test, **p = 0.015**). It costs **$0.13 per 1,000 alerts**, about 11× less than the teacher, and the whole ML pipeline cost **$1.60**.

The model's only job is to produce one printable card a week, so you can stop checking park alerts and go outside.

> **TL;DR**
> - **What:** TrailTruth reads every NPS alert for the parks you care about, once a week, and prints one card per park: **GO**, **CAUTION** or **NO-GO**, plus the trails to skip. Then it stays quiet until next Friday.
> - **The Tinker result:** a LoRA on **Qwen3.5-4B**, distilled from **Qwen3.5-397B-A17B**, scores **0.746** decision accuracy on 126 held-out alerts against **0.643** for the same base model (**+10.3 points, 95% CI +3.2 to +17.5**, exact McNemar **p = 0.015**). On the alerts that should stop you it catches **28 of 33** against **17 of 33** (p = 0.007).
> - **Cost:** teacher labelling $0.95, LoRA training $0.41, evaluation $0.25. **Total $1.60.** The student then runs at **$0.13 per 1,000 alerts** against $1.50 for the teacher.
> - **Durability:** the weekly run is a **Temporal** workflow. I hard-killed the worker mid-run with the real model loaded: 21 alerts, 10 finished before the crash and were kept, 6 orphaned calls were retried, and none ran twice.
> - **Honesty:** the student beats the teacher partly because I trained it toward the rangers' labels and never trained the teacher. Against the base model given the teacher's long prompt, the gain is **not** significant (p = 0.12). Both are in the tables below.
> - **Everything is open:** code, data splits, predictions, eval script and the trained adapter's path are in **[SoumyaEXE/trailtruth](https://github.com/SoumyaEXE/trailtruth)**.

> **3 findings in 30 seconds**
>
> 1. **The base model reads closures and still says "go with care".** It called 16 of the 33 no-go alerts *caution*. After $0.41 of fine-tuning, it misses 5.
> 2. **Prompting isn't the same as training.** Handing the base model the teacher's 340-token-longer rules prompt nearly doubles the cost and still catches only 17 of 33.
> 3. **The answer key has typos, and they cut both ways.** NPS filed a Kīlauea eruption as *Information* (so "go" is graded correct) and a horse-only trail closure as *Park Closure*. No model gets near 100%, and I didn't edit the labels to help mine.

> **Nothing private was sent anywhere.** The data is public government text from `developer.nps.gov`. The app asks NPS for alerts by park code only. No location, no account, no tracking. The API keys used to build this live in a gitignored `.env`.

---

![TrailTruth trail card for the week of October 10, overall caution: Hawaiʻi Volcanoes, go but skip Halemaʻumaʻu and Byron Ledge trails; Chickamauga & Chattanooga, go with care on the Bluff Trail on Lookout Mountain; Yellowstone, go but skip Biscuit Basin and the West Thumb boardwalk](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/ui-card.png)

## Why this matters: 627 alerts, 28,760 words, nobody reads them

> Please exercise caution when hiking the section of Bluff Trail, between the Cravens House Trail and the base of the metal staircase below Point Park, as a territorial barred owl may be present. We appreciate your vigilance and your patience as we work on a solution.

That's a real alert, live on October 9, for Lookout Mountain in Chattanooga. "Your patience as we work on a solution", about an owl, is my favourite sentence the federal government published this year.

It's one of **627** open alerts across more than 270 parks. Together they run to **28,760 words**, about two hours of reading. More than a quarter are about parking, visitor centers or opening hours. A handful matter a lot: Halemaʻumaʻu Trail is closed because Kīlauea's summit is inflating and shaking. A rabid bat at Olympic "was temporarily caught in her hair." Yellowstone's elk advice is four words long: "If an elk charges, run."

If you're hiking this weekend you need maybe three of those alerts. Everyone has either driven two hours to a trailhead with a closure sign on it, or opened a park's alerts page, seen 14 items, and decided to wing it.

## What's new here

| Existing option | What it gives you | What it can't tell you |
| --- | --- | --- |
| The park's alerts page | Every alert, in full | Which three matter for *your* hike |
| Keyword filters ("closed", "danger") | Free, instant | 64 Information/Caution alerts say "closed" in the title, and 23 *Park Closure* alerts only close a parking lot or gift shop |
| Asking a big chat model | A decent summary | Whether it's right, what it costs per week per user, and it needs a signal at the trailhead |
| **TrailTruth** | One card, made at home, measured against the rangers' own labels | It's 74.6% accurate, not 100%. The card links every source alert |

## What I Built

**TrailTruth** turns national park alerts into one decision you can fold into a pocket. You pick your parks once. Every Friday at 7 a.m. a workflow pulls their alerts, runs each one through the fine-tuned 4B model, and builds a card. This is the real card from the run on October 10:

```text
TRAILTRUTH · week of 2026-10-10 · overall CAUTION

HAWAIʻI VOLCANOES NATIONAL PARK  [CAUTION]
  Go, but skip Halemaʻumaʻu Trail & Byron Ledge Trail
  Trails closed: Halemaʻumaʻu Trail, Byron Ledge Trail, Crater Rim Trail, Kīpukapuaulu Trail, Sulphur Banks Trail
  Watch for: Protect Yourself from Volcanic Tephra
  Also closed: old Crater Rim Drive, Mauna Loa Road, Sulphur Banks Bridge

CHICKAMAUGA & CHATTANOOGA NATIONAL MILITARY PARK  [CAUTION]
  Go with care — Use Caution When Hiking Bluff Trail on Lookout Mountain
  Watch for: Use Caution When Hiking Bluff Trail on Lookout Mountain
  Also closed: East Brotherton Road

YELLOWSTONE NATIONAL PARK  [CAUTION]
  Go, but skip Biscuit Basin & West Thumb Geyser Basin Boardwalk
  Trails closed: Biscuit Basin, West Thumb Geyser Basin Boardwalk
  Watch for: Stay Away From Bull Elk
  Also closed: Beartooth Highway, Dunraven Pass

model: qwen3.5-4b-trailtruth-lora · workflow: trailcard-2026-10-10-havo-chch-yell-fc09
```

You print it or screenshot it, and you go. There's no feed, no streak, and no notification asking how your hike was. The number I care about is minutes *not* spent in the app.

![The trail card at phone width: overall caution, with each park's closed trails listed](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/ui-mobile-card.png)

The dashboard (Next.js + [BoardUI](https://boardui.com)) is for setup and for the curious. On a normal week you shouldn't need it.

![TrailTruth overview: this week's overall verdict, go / caution / no-go counts, and the watched parks with their alert and closure counts](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/ui-overview.png)

![Alerts table with the Halemaʻumaʻu Trail closure expanded: the original NPS alert beside the LoRA's JSON verdict, its latency, and whether it agrees with the ranger's category](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/ui-alerts-expanded.png)

## Demo

The whole stack runs locally with one command, or on Render from the Blueprint in the repo:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/SoumyaEXE/trailtruth)

```bash
git clone https://github.com/SoumyaEXE/trailtruth && cd trailtruth
cp .env.example .env    # NPS_API_KEY, TINKER_API_KEY (optional; falls back to a keyword heuristic)

python -m venv agent/.venv && agent/.venv/Scripts/pip install -r agent/requirements-tinker.txt
agent/.venv/Scripts/python -m agent.dev        # Temporal (:7233, UI :8233) + worker + API (:8000)
agent/.venv/Scripts/python -m agent.demo_crash # kills the worker mid-run and shows it resume

cd web && npm install && npm run dev           # dashboard on :3000 (works without the API, from real fixtures)
```

![Model Lab page: accuracy, closure F1, hazard agreement and macro-F1 for all five models, plus latency, cost, training loss, a confusion matrix and side-by-side outputs](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/ui-lab.png)

## Code

{% github SoumyaEXE/trailtruth %}

`ml/` holds the data pipeline, teacher labelling, Tinker training and eval. `agent/` holds the Temporal workflow, worker and API, and `web/` the dashboard. Every number in this post comes from `ml/results/eval.json`, `ml/results/predictions.jsonl`, `ml/results/spend.json` or a transcript in `agent/demo_logs/`. MIT licensed.

## How I Built It

![Architecture: once, offline, NPS alerts are labelled by the Qwen3.5-397B teacher on Tinker, ranger categories correct 235 decisions, and a LoRA is trained on Qwen3.5-4B. Every Friday a Temporal workflow runs fetch_alerts, classify_alert (calling the LoRA), compose_card and publish_card, with per-step retries, and prints one card](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/architecture.png)

The rule behind all of it: **the big model teaches, the small model works, and the rangers grade.**

### The rangers already labelled the data

Every NPS alert comes with a category a ranger picked: **Information**, **Caution**, **Danger** or **Park Closure**. That's a human label on real government text, which is rare for a hackathon dataset. I map it to a hiker's decision: Information → go, Caution → caution, Danger and trail closures → no-go. The model **never sees the category**, only the title and description. The category is the answer key.

| NPS category | Alerts | Decision it grades as |
| --- | --- | --- |
| Information | 308 | go |
| Park Closure | 168 | no-go (caution if it only closes a facility: 23 alerts) |
| Caution | 138 | caution |
| Danger | 13 | no-go |

Each alert becomes a strict JSON verdict:

```json
{
  "hazard_type": "closure",
  "severity": 3,
  "trails_affected": ["River Trail", "Ocmulgee Heritage Trail"],
  "is_closed": true,
  "decision": "no_go",
  "reason": "Boardwalk and river access are closed due to structural issues."
}
```

### Distilling 397B into 4B with Tinker

The teacher, **Qwen3.5-397B-A17B**, reads alerts well. You just don't want to pay for it every week for every user, and it won't run on a laptop. So I used it once:

1. **Teacher labels.** All 627 alerts in about a minute, 32 requests at a time. **627 of 627** came back as valid JSON on the first try. Cost: **$0.95**.
2. **Training target.** I kept the teacher's JSON, but where its decision disagreed with the ranger's category (235 of 627 alerts) I swapped in the ranger's decision. Hazard type, trail names and reason still come from the teacher.
3. **Student.** A rank-32 LoRA on **Qwen3.5-4B** with the Tinker cookbook's renderer, trained on 501 alerts: learning rate 4.9e-4 (the cookbook default for this model) decaying linearly, batch 16, 3 epochs (96 steps), loss on the assistant's JSON only. **6 minutes 46 seconds, $0.41.** The student works from a prompt 340 tokens shorter than the teacher's.
4. **Test.** 126 held-out alerts, stratified by category, with duplicate notices kept inside one split so nothing leaks. One attempt per alert, temperature 0, for every model.

This is the training loop, trimmed of logging. My laptop builds the batches, and Tinker runs the forward/backward pass and the optimizer step on its GPUs:

```python
service = tinker.ServiceClient()
tc = service.create_lora_training_client(base_model="Qwen/Qwen3.5-4B", rank=32, seed=0)

for epoch in range(3):
    rng.shuffle(order)
    for b in range(steps_per_epoch):
        batch = [train_data[i] for i in order[b * 16 : (b + 1) * 16]]   # renderer-built Datums, loss on JSON only
        cur_lr = lr * max(0.0, 1.0 - step / total_steps)
        fwd_f = tc.forward_backward(batch, "cross_entropy")              # both calls are queued before we wait
        opt_f = tc.optim_step(tinker.AdamParams(learning_rate=cur_lr, beta1=0.9, beta2=0.95, eps=1e-8))
        fwd, _ = fwd_f.result(), opt_f.result()
        step += 1
    eval_test(step)                                                      # held-out NLL after every epoch

saved = tc.save_weights_for_sampler(name="trailtruth-qwen3.5-4b-lora").result()   # → tinker://… path
```

Serving uses the same weights through Tinker's `SamplingClient`, behind one function, `ml.infer.classify()`, that the Temporal activity calls.

![Spend breakdown: teacher labelling $0.9455, LoRA training $0.4058, evaluation of four models $0.25, total $1.6033; the LoRA then costs $0.13 per 1,000 alerts versus $1.50 for the teacher](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/cost.png)

Why a 4B and not a 1B? I planned on Llama-3.2-1B, then found that Tinker retired it (along with Qwen3-4B-Instruct) on 2026-06-12. Qwen3.5-4B was the smallest instruct model I could LoRA-train, and it shares the teacher's tokenizer.

### Results

![Bar chart of decision accuracy on 126 held-out alerts: Qwen3.5-4B + TrailTruth LoRA 0.746, base + long prompt 0.675, teacher 0.651, base 0.643, keyword heuristic 0.579, with cost per 1,000 alerts](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/results.png)

| Model | Decision accuracy (95% CI) | Macro-F1 | **No-go caught** | Hazard agreement w/ teacher | $ / 1k alerts |
| --- | --- | --- | --- | --- | --- |
| Teacher: Qwen3.5-397B-A17B | 0.651 (0.563–0.730) | 0.642 | 18 / 33 | 0.98* | $1.50 |
| Qwen3.5-4B, base | 0.643 (0.556–0.722) | 0.631 | 17 / 33 | 0.61 | $0.13 |
| Qwen3.5-4B, base + teacher's long prompt | 0.675 (0.595–0.754) | 0.648 | 17 / 33 | 0.71 | $0.24 |
| **Qwen3.5-4B + TrailTruth LoRA** | **0.746 (0.667–0.817)** | **0.742** | **28 / 33** | **0.83** | **$0.13** |
| Keyword heuristic (no model) | 0.579 (0.492–0.667) | 0.586 | 25 / 33 | 0.63 | $0 |

<sub>*The teacher agreeing with its own labels. Every model produced valid JSON on 126 of 126 alerts, so that column is gone. Intervals are 10,000-sample bootstraps over alerts.</sub>

**Is the gain real or noise?** Same 126 alerts, paired comparisons, exact McNemar test on the alerts where the two models disagree:

| Comparison | Accuracy gain (95% CI) | Only the LoRA right | Only the other right | p |
| --- | --- | --- | --- | --- |
| LoRA vs base | **+10.3 pts (+3.2 to +17.5)** | 19 | 6 | **0.015** |
| LoRA vs teacher | +9.5 pts (+2.4 to +16.7) | 18 | 6 | 0.023 |
| LoRA vs base + long prompt | +7.1 pts (−0.8 to +15.1) | 18 | 9 | 0.12 (not significant) |
| LoRA vs keyword heuristic | +16.7 pts (+7.1 to +26.2) | 31 | 10 | 0.002 |
| **No-go alerts only: LoRA vs base** | **28 vs 17 of 33** | 13 | 2 | **0.007** |

That last row is the whole project in one line. **The base 4B missed almost half the alerts that should stop you. The fine-tuned one misses 5.** Same model, same short prompt, same $0.13 per thousand alerts. The only difference is $0.41 of training on a teacher's homework that the rangers had corrected.

![Unit chart of the 33 held-out no-go alerts: the base 4B caught 17 and called the other 16 caution; the LoRA caught 28, calling 3 caution and 2 go](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/nogo-recall.png)

![Confusion matrices for the base 4B and the LoRA 4B. No-go row: base 0 go, 16 caution, 17 no-go; LoRA 2 go, 3 caution, 28 no-go. The LoRA also calls 11 go alerts no-go, up from 9](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/confusion.png)

A test alert from Ocmulgee Mounds shows the difference:

> Due to structural issues, the boardwalk along the river trail is closed until further notice. Access to the Ocmulgee Heritage Trail and river is not available due to this closure.

```text
BASE  decision: caution  "Boardwalk closed due to structural issues; access to river trail and heritage trail unavailable."
LoRA  decision: no_go    "Boardwalk and river access are closed due to structural issues."
```

The base model read every word correctly and still told you to go with care to a trail you can't reach.

![The Ocmulgee Mounds boardwalk-closure alert, then the base model's JSON (is_closed true, decision caution) next to the LoRA's JSON (is_closed true, decision no_go, matching the ranger's Park Closure label)](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/before-after.png)

**Read the rest of the table with these in mind:**

- **The LoRA "beats" the teacher partly because I trained it toward the rangers' labels and never trained the teacher.** So 0.746 vs 0.651 is mostly calibration to how NPS files alerts, not a smaller model being smarter. The honest headline is the student against its own base. Against the teacher, it's "most of its reading at an eleventh of the price".
- **The price of catching more no-gos:** the LoRA calls 11 of 61 harmless *go* alerts no-go, up from 9. For a hiking card I'll take that trade, but it is a trade.
- **Closure F1 didn't improve.** 0.889 (base) to 0.884 (LoRA), with the teacher at 0.923. Part of that metric's gold comes from the teacher, so it leans the teacher's way.
- **No latency win, yet.** Through Tinker's hosted sampler every model takes about 2.4 s at p50, because per-request overhead swamps model size. The 4B's speed advantage only shows up self-hosted. `ml/download_adapter.py --peft` exports the adapter for vLLM, SGLang or llama.cpp, but I haven't timed that.
- **Test loss rose in the last epoch**, from 0.223 to 0.286: mild overfitting. I shipped the epoch-3 weights anyway. I had no separate validation set, and picking a checkpoint by its test score would make every table above a lie.

![Training loss falls over 96 steps; test loss goes 0.338 before training, 0.223 after epochs 1 and 2, then rises to 0.286 after epoch 3](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/loss-curve.png)

{% details Evaluation protocol, definitions and statistics %}

| Quantity | Definition |
| --- | --- |
| **Decision accuracy** | P(model decision = gold decision) over the 126 test alerts |
| **Gold decision** | Information → go, Caution → caution, Danger → no_go, Park Closure → no_go, except 23 facility-only closures (parking, visitor center, campground, bookstore) → caution. `decision_acc_raw` in `eval.json` scores without that exception (LoRA 0.754) |
| **No-go caught** | Recall on the 33 test alerts whose gold decision is no_go |
| **Macro-F1** | Unweighted mean F1 over go / caution / no_go |
| **Hazard agreement** | P(model hazard_type = teacher hazard_type). The teacher is the only source for hazard labels |
| **Closure F1** | F1 of `is_closed` against gold (Park Closure category, or the teacher's flag) |
| **95% CI** | Percentile bootstrap, 10,000 resamples of the 126 alerts, seed 0 |
| **p** | Exact two-sided McNemar (binomial on discordant pairs) |
| **Cost** | Tinker list price × prompt + completion tokens actually used. Avg tokens per alert: teacher 551 + 79, LoRA 213 + 61 |

Split: 501 train / 126 test, stratified by category, seed 0. Duplicate alerts (same title) never cross the split. Every model, including the teacher, sees only title + description.

{% enddetails %}

### Making the weekly run survive with Temporal

The NPS API has a free `DEMO_KEY`, and its headers are honest about it: `X-Ratelimit-Limit: 10`. When I ran out on October 10, the reply was `429 Too Many Requests` with **`Retry-After: 60076`**, which means come back in sixteen and a half hours. Model calls go over the network and sometimes hang. A weekly batch is going to hit both.

**Each step is a Temporal activity with its own policy:**
- **NPS fetches** retry with exponential backoff (1 s up to 20 s, 6 attempts).
- **Model calls** run six at a time and heartbeat, so a hung call is noticed after 5 s and retried. Invalid JSON is retried too. On the fifth attempt the step falls back to the keyword heuristic and says so.
- **A `429` is not retried.** Hammering a server that just asked for 16 hours of quiet is pointless. The fetch falls back to the last cached copy and labels the step `source=snapshot (NPS 429, Retry-After 16.4h)`. That label is from a real run against the real `DEMO_KEY`.
- **The schedule lives in Temporal**, not in a cron job on a laptop that might be asleep on Friday morning.

**Crash run, with the real model.** I started a card for Hawaiʻi Volcanoes, Yellowstone and Zion (21 alerts) on the Tinker-served LoRA, then hard-killed the worker partway through classification.

| Time | What happened |
| --- | --- |
| t+3.0 s | Workflow `trailcard-2026-10-10-havo-yell-zion-5b7d` starts: 3 parks, 21 alerts |
| t+33.1 s | 10 of 21 classified. Worker #1 (pid 11608) **killed**, no graceful shutdown |
| t+33.2 s | No process is running the agent. Temporal still says `RUNNING`, with 6 activities orphaned mid-flight |
| t+36.2 s | Worker #2 starts as a fresh process with no memory of #1, and replays the history |
| t+69.5 s | Workflow **completed**, card published. Most of the wait is two ~20 s Tinker cold starts, one per worker |

The event history afterwards: **21** `classify_alert` activities scheduled, **none twice**. The **10** finished before the crash were kept, not re-run. Only the **6** in flight needed a second attempt. Here's Temporal's own timeline of that run. Each pink `2 • classify_alert` bar is an orphaned call that waited out the dead worker and finished on attempt 2:

![Temporal Web UI timeline of workflow trailcard-2026-10-10-havo-yell-zion-5b7d: three fetch_alerts, a column of classify_alert activities that finished before the crash, six "2 • classify_alert" retries spanning the gap while no worker was alive, then the remaining classify_alert calls, compose_card and publish_card](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/temporal-ui-crash.png)

I rehearsed the same crash first with a stand-in classifier (the keyword heuristic plus a 1.2 s delay), so the kill would land reliably: 8 kept, 4 retried, none twice.

![Timeline of the rehearsal crash run: worker 1 killed at t+6.0 s after 8 of 21 alerts, no worker for 3 s while the workflow stays RUNNING, worker 2 starts at t+9.1 s, 4 orphaned activities retried on attempt 2; 21 scheduled, none twice](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/crash-resume.png)

**Chaos run.** With fault injection on (30% fake NPS 503s, 8% model hangs, 10% invalid JSON), Hawaiʻi Volcanoes' fetch failed twice and succeeded on attempt 3, hung model calls were caught by the heartbeat timeout, and a reply that came back as `'{"hazard_type": "wildlife", "sev'` was retried. The card came out normally. To be fair, chaos only fires on attempts 1 and 2, so that demo always finishes.

All 26 runs from the build are still in the local Temporal server. 25 completed and 1 failed, and the failure is the first item in the next section.

![Temporal Web UI workflow list: 26 TrailCardWorkflow runs, 25 completed and 1 failed (weekly-trailcard-havo-chch-2026-10-10T07:37:55Z)](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/temporal-ui-runs.png)

![TrailTruth workflow runs page: recent runs with retry and resumed badges, and the crash run shown as a step waterfall and event timeline](https://raw.githubusercontent.com/SoumyaEXE/trailtruth/main/docs/images/ui-runs.png)

## What went wrong

- **Temporal faithfully retried my own bug.** Schedule-started workflows get IDs with a timestamp, like `weekly-trailcard-havo-chch-2026-10-10T07:37:55Z`. I used the workflow ID as a filename for the run log, and Windows doesn't allow `:` in filenames. Every fetch succeeded, then the activity crashed writing its log, and Temporal retried it at 1, 2, 4, 8 and 16 seconds, exactly as configured. Retries are for flaky things, and this wasn't flaky. The fix was a `safe_name()` for filenames, plus a rule that logging can never fail an activity. That's the one red `FAILED` in the list above.
- **The card contradicted itself.** The first cards said "Go — but skip Halemaʻumaʻu Trail" under a **NO-GO** badge, because one closed trail made the whole park no-go. A park with two closed trails is still worth visiting, so now the park gets *caution* and the no-go applies to the named trails.
- **The answer key is messier than it looks.** 64 alerts filed as Information or Caution say "closed" in the title. NPS filed "Kīlauea eruption" as Information, so the gold answer is "go", and a model that says no-go on a volcano gets marked wrong. I left those labels alone, because editing the answer key to flatter your model is how benchmarks die.
- **…and sometimes the noise flatters me.** "Yockanookany Trail Section Closed to Equestrians" ends with "The trail will remain open to pedestrians." The teacher said go, which is right for a hiker. The LoRA had learned that *Park Closure* means no-go, and the scorer gave it a point it didn't deserve.
- **Nobody caught the algae.** "Toxic Algae Found – Blue Mesa Water Quality Advisory" is filed as Danger. Teacher, base and LoRA all said caution. Only 13 of 627 alerts are Danger, so the student barely saw any.
- **I rate-limited myself.** That `429` came from my own pipeline sharing one IP and one `DEMO_KEY`.

## Why Does Open Innovation Matter?

**The trailhead has no signal, and paper doesn't need any.** The card is made at home on Wi-Fi and works offline forever.

**Small and open means cheap enough to run for everyone, every week.** At $0.13 per 1,000 alerts, a five-park card (about 30 alerts) costs less than half a cent. I could only make and *measure* that trade because I could fine-tune the model. A model you can't train doesn't give you the choice.

**I own the fine-tune.** The adapter is mine to download, merge, quantize or throw away. If NPS changes how it writes alerts next year, I re-run the teacher and retrain the student for about $1.60. When Tinker retired my first-choice model, switching to another open one was a one-line change in `ml/common.py`.

**Swapping models is one environment variable.** `TRAILTRUTH_MODEL_PROVIDER` switches between the Tinker-hosted LoRA, any OpenAI-compatible local server (Ollama, llama.cpp, vLLM) and the keyword heuristic.

**Your parks list stays yours.** The only thing that leaves your machine is a request for public alerts by park code.

**The honest caveat:** teacher labelling, training and the default inference path all run on hosted infrastructure (Tinker). The data is public, so nothing private was sent. "Fully offline" applies to the card, or to running the exported adapter yourself.

## My Agent Session

I built TrailTruth with a team of coding agents working in parallel: one for data and ML, one for the Temporal backend, one for the dashboard, one for the charts, and one for the first draft of this post. I coordinated them from a single session. They all worked from one shared [`CONTRACT.md`](https://github.com/SoumyaEXE/trailtruth/blob/main/CONTRACT.md) that fixed the data schema before any code existed. That contract is why four agents could write four directories at once without breaking each other.

The coordinating session is recorded with **Entire**. Each checkpoint is a commit pushed to the repo, holding the prompt and the transcript that produced the code next to it:

- **[Checkpoint 01M4JAAJ](https://github.com/SoumyaEXE/trailtruth/tree/97d48cec4a14):** the research step that chose the project. It explains why TrailTruth targets Tinker, Temporal and Entire: a count of this week's entries showed those categories nearly empty, while Gemma had 186.
- **[Checkpoint 01M4JAFF](https://github.com/SoumyaEXE/trailtruth/tree/17bb35281253):** where the build was planned and the contract written. It explains why the model never sees the NPS `category` (it's the held-out answer key) and why every model provider sits behind one `classify()` function.
- **[Checkpoint 01M4JBCW](https://github.com/SoumyaEXE/trailtruth/tree/0257b6389bb5):** I pasted a Tinker API key into the chat. Open the checkpoint and it reads `REDACTED`. Entire scrubbed it before the commit ever existed.

## Prize Categories

- **Best Use of Tinker:** I distilled Qwen3.5-397B-A17B into a rank-32 LoRA on Qwen3.5-4B with Tinker's training API (`forward_backward` / `optim_step` / `save_weights_for_sampler`) and served it through Tinker's sampler. On 126 held-out alerts graded by ranger labels: decision accuracy **0.643 → 0.746** (+10.3 pts, 95% CI +3.2 to +17.5, p = 0.015), no-go recall **17/33 → 28/33** (p = 0.007), at **$0.13 per 1k alerts vs $1.50** for the teacher. The whole pipeline cost **$1.60**, and I've shown where the comparison flatters me.
- **Best Use of Temporal:** a Temporal Schedule and a workflow with per-step retry policies, heartbeats for hung model calls, and a labelled fallback for a real 16-hour `429`. I hard-killed the worker mid-run with the real model: 21 activities scheduled, none twice, 10 kept, 6 retried, and it's all visible in Temporal's own timeline.
- **Best Use of Entire:** the coordinating agent session is checkpointed as commits in the repo, and I use three of them to explain why the project, the contract and the redaction behave the way they do.
- **Best Use of Render:** a one-click `render.yaml` Blueprint deploys two services: the agent runtime (Temporal dev server, worker and FastAPI in one Python web service, classifying with the Tinker LoRA) and the static BoardUI dashboard, wired together with `fromService`. Keys stay out of the repo (`sync: false`). It survives worker crashes but not container restarts. For real durability you point it at Temporal Cloud with three env vars.

Built by [@soumyadeepdey](https://dev.to/soumyadeepdey).

What's the strangest park alert you've ever read before a hike? Leave it in the comments. If it involves an owl, I may need it for the test set.
