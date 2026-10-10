---
title: '627 park alerts, one printed card: distilling a 397B model into a 4B one for $1.60'
published: false
description: A 4B open model, fine-tuned on Tinker to copy a 397B teacher and graded against the rangers' own labels, reads every National Park Service alert for your parks once a week and prints one go/no-go trail card. Then it stops talking.
tags: devchallenge, hf26challenge, ai, opensource
cover_image: {{COVER_IMAGE_URL}}
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05)*

> Please exercise caution when hiking the section of Bluff Trail, between the Cravens House Trail and the base of the metal staircase below Point Park, as a territorial barred owl may be present. We appreciate your vigilance and your patience as we work on a solution.

That's a real alert from the National Park Service for Lookout Mountain in Chattanooga, live on October 9. "Your patience as we work on a solution", about an owl, is the best sentence the federal government has published this year.

It's one of **627** alerts open right now across more than 270 parks. Together they come to **28,760 words**, about two hours of reading. More than a quarter mention parking, visitor centers or opening hours. A handful matter a lot. Halemaʻumaʻu Trail is closed because Kīlauea's summit is inflating and shaking. A rabid bat at Olympic "was temporarily caught in her hair." Yellowstone's elk advice comes down to four words: "If an elk charges, run."

If you're hiking this weekend, you need maybe three of those alerts. So we built something that finds those three, prints them on one card, and then stops talking to you.

![{{HERO_GIF_ALT}}]({{HERO_GIF_URL}})

> **TL;DR.** TrailTruth reads every NPS alert for the parks you care about, once a week, and gives you one printable card: **GO**, **CAUTION** or **NO-GO**, plus the trails to skip. The reader is **Qwen3.5-4B** with a LoRA we trained on Tinker to copy **Qwen3.5-397B-A17B**. On 126 held-out alerts graded by the rangers' own labels, fine-tuning took it from catching **17 of 33** no-go alerts to **28 of 33**, at **$0.13 per 1,000 alerts**. The whole ML pipeline cost **$1.60**. A Temporal workflow keeps the weekly run alive through a killed worker, flaky APIs, and a demo key that told us to come back in 16 hours.

## What I Built

**TrailTruth** turns national park alerts into one decision you can fold into your pocket.

You pick your parks once, say Hawaiʻi Volcanoes and Chickamauga & Chattanooga. Every Friday at 7 a.m. a workflow pulls their alerts, runs each one through the fine-tuned 4B model, and builds a **trail card**:

```text
{{CARD_TEXT}}
```

<!-- Paste the real card text from the LoRA run (GET /api/cards/{id}) exactly. Do not hand-edit it. -->

You print it or screenshot it, and you go. That's the whole experience. There's no feed, no streak, and no notification asking how your hike was. The number we care about is minutes *not* spent in the app.

It's for people who hike national parks and have, at least once, driven two hours to a trailhead with a closure sign on it. It's also for anyone who opened a park's alerts page, saw 14 items, and decided to wing it.

A lot of entries this week want you to close the app. Same here. What we wanted to add is evidence that the one thing you read before closing it is right. That meant a model we could measure, and an answer key we didn't write ourselves.

## Demo

**Live:** {{LIVE_URL}} (no sign-up. If the API is asleep, it falls back to a static demo built from real alerts.)

{% embed {{DEMO_VIDEO_URL}} %}

![{{DASHBOARD_SCREENSHOT_ALT}}]({{DASHBOARD_SCREENSHOT_URL}})

![{{PRINTED_CARD_PHOTO_ALT}}]({{PRINTED_CARD_PHOTO_URL}})

## Code

{% github {{GITHUB_REPO}} %}

`ml/` has the data pipeline, teacher labelling, Tinker training and eval. `agent/` has the Temporal worker and API, and `web/` the dashboard. Every number in this post comes from `ml/results/eval.json`, `ml/results/spend.json` or the transcripts in `agent/demo_logs/`.

## How I Built It

```text
NPS alerts API ──▶ Temporal: TrailCardWorkflow  (Temporal Schedule: Fridays 07:00 America/Los_Angeles)
                     ├─ fetch_alerts(park)    × N  parallel · backoff 1s→20s, 6 attempts · 429 → cache/snapshot
                     ├─ classify_alert(alert) × M  4 at a time · 5s heartbeats · retry on hang / bad JSON
                     │     └─ Qwen3.5-4B + TrailTruth LoRA (Tinker)  · or any OpenAI-compatible local server
                     ├─ compose_card               deterministic: worst decision per park, closed trails
                     └─ publish_card               atomic write
FastAPI ──▶ Next.js + BoardUI dashboard (parks, alerts, workflow runs, eval)
```

The rule behind all of it: **the big model teaches, the small model works, and the rangers grade.**

### The rangers already labelled the data

Every NPS alert comes with a category a ranger picked: **Information**, **Caution**, **Danger** or **Park Closure**. That's a human label on real government text, which is rare for a hackathon dataset. We map it to a hiker's decision (Information → go, Caution → caution, Danger and closures → no-go). The model **never sees the category**, only the title and description. The category is the answer key.

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

The teacher, **Qwen3.5-397B-A17B**, reads alerts well. You just don't want to pay for it every week for every user, and it won't fit on a laptop. So we used it once:

1. **Teacher labels.** It labelled all 627 alerts in about a minute, 32 requests at a time. **627 of 627** came back as valid JSON on the first try. Cost: **$0.95**.
2. **Training target.** We kept the teacher's JSON, but where its decision disagreed with the ranger's category (235 of 627 alerts), we swapped in the ranger's decision. The hazard type, trail names and reason still come from the teacher.
3. **Student.** We LoRA-fine-tuned **Qwen3.5-4B** on 501 alerts with Tinker's cookbook: rank 32, learning rate 4.9e-4, batch 16, 3 epochs (96 steps), with loss on the JSON only. It took 6 minutes 46 seconds and **$0.41**. The student also learned to work from a prompt 340 tokens shorter than the teacher's.
4. **Test.** We held out 126 alerts, stratified by category, with duplicate notices kept in the same split. Each model got one attempt per alert, at temperature 0.

Why a 4B and not a 1B? We planned on Llama-3.2-1B, then found that Tinker retired it (along with Qwen3-4B-Instruct) on 2026-06-12. Qwen3.5-4B was the smallest instruct model we could LoRA-train, and it shares the teacher's tokenizer.

| Model | Decision accuracy | Macro-F1 | **No-go caught** | Hazard agreement w/ teacher | $ / 1k alerts |
|---|---|---|---|---|---|
| Teacher: Qwen3.5-397B-A17B | 0.651 | 0.642 | 18 / 33 | 0.98* | $1.50 |
| Qwen3.5-4B, base | 0.643 | 0.631 | 17 / 33 | 0.61 | $0.13 |
| Qwen3.5-4B, base + teacher's long prompt | 0.675 | 0.648 | 17 / 33 | 0.71 | $0.24 |
| **Qwen3.5-4B + TrailTruth LoRA** | **0.746** | **0.742** | **28 / 33** | **0.83** | **$0.13** |
| Keyword heuristic (no model) | 0.579 | 0.586 | 25 / 33 | 0.63 | $0 |

<sub>*The teacher agreeing with its own labels. Every model produced valid JSON on 126 of 126 alerts, so there's no story in that column and we dropped it. p50 latency was about 2.4 s for every model, explained below.</sub>

Look at the no-go column. **The base 4B missed almost half the alerts that should stop you, 16 of 33. The fine-tuned one misses 5.** Same model, same prompt, same $0.13 per thousand alerts. The only difference is $0.41 of training on a teacher's homework that the rangers had corrected.

![{{CONFUSION_MATRIX_ALT}}]({{CONFUSION_MATRIX_URL}})

A test alert from Ocmulgee Mounds shows the difference:

> Due to structural issues, the boardwalk along the river trail is closed until further notice. Access to the Ocmulgee Heritage Trail and river is not available due to this closure.

```text
BASE  decision: caution  "Boardwalk closed due to structural issues; access to river trail and heritage trail unavailable."
LoRA  decision: no_go    "Boardwalk and river access are closed due to structural issues."
```

The base model read every word correctly and still told you to go with care to a trail you can't reach.

**Read the rest of the table with these in mind:**

- **The LoRA "beats" the teacher partly because we trained it toward the rangers' labels and never trained the teacher.** So 0.746 vs 0.651 is mostly calibration to how NPS files alerts, not a smaller model being smarter. The honest headline is the student against its own base. Against the teacher, the headline is "most of its reading at an eleventh of the price".
- **Closure F1 didn't improve.** It went from 0.889 (base) to 0.884 (LoRA), and the teacher leads with 0.923. Part of that metric's gold comes from the teacher, so it's tilted in the teacher's favour.
- **Prompting isn't enough.** Giving the base model the teacher's long rules prompt helps a little (0.675), costs nearly twice as much, and still catches only 17 no-gos.
- **No latency win, yet.** Through Tinker's hosted sampler, every model takes about 2.4 s at p50, because per-request overhead swamps model size. The 4B's speed advantage only shows up if you host it yourself. `ml/download_adapter.py --peft` exports the adapter for vLLM, SGLang or llama.cpp, but we haven't timed that.
- **Test loss went up in the last epoch**, from 0.223 after epoch 2 to 0.286 after epoch 3. That's mild overfitting. We shipped the epoch-3 weights anyway, because we had no separate validation set, and picking a checkpoint by its test-set score would make the table above a lie.

### Making the weekly run survive with Temporal

The NPS API has a free `DEMO_KEY`, and its headers are honest about it: `X-Ratelimit-Limit: 10`. When we ran out on October 10, the reply was `429 Too Many Requests` with **`Retry-After: 60076`**. That's the server telling you to come back in sixteen and a half hours. Meanwhile the model calls go over the network and sometimes hang. A weekly batch is going to hit both.

**Each step is a Temporal activity with its own policy:**
- **NPS fetches** retry with exponential backoff (1 s up to 20 s, 6 attempts).
- **Model calls** run four at a time. They heartbeat every few seconds, so a hung call is detected after 5 s and retried. Invalid JSON gets retried too, and on the fifth attempt the step falls back to the keyword heuristic, labelled as such.
- **A `429` is not retried.** Hammering a server that just asked for 16 hours of quiet is pointless. The fetch falls back to the last cached copy or the bundled snapshot, and says so on the step: `source=snapshot (NPS 429, Retry-After 16.4h)`. That's from a real run against the real `DEMO_KEY`.
- **The schedule lives in Temporal**, not in a cron job on a laptop that might be asleep on Friday morning. If no worker is up at 7:00, it catches up within a day.

**Chaos run.** We turned on fault injection (30% fake NPS 503s, 8% model hangs, 10% invalid JSON) and asked for a four-park card. Hawaiʻi Volcanoes' fetch failed twice and succeeded on attempt 3. Three model calls hung and were caught by the heartbeat timeout. One reply came back as `'{"hazard_type": "wildlife", "sev'` and was retried. The card came out normally. (In fairness, chaos only fires on attempts 1 and 2, so the demo always finishes.)

**Crash run.** We started a card for Hawaiʻi Volcanoes, Yellowstone and Zion (21 alerts), then hard-killed the worker with `taskkill /F` partway through classification. For this demo the classifier is the heuristic with a simulated 1.2 s delay per alert, so the kill reliably lands mid-run.

| Time | What happened |
|---|---|
| t+3.0 s | Workflow `trailcard-2026-10-10-havo-yell-zion-16cf` starts: 3 parks, 21 alerts |
| t+6.0 s | 8 of 21 classified. Worker #1 (pid 6140) **killed**, no graceful shutdown |
| t+6.1 s | No process running the agent. Temporal still says `RUNNING`, with 4 activities orphaned mid-flight |
| t+9.1 s | Worker #2 starts as a fresh process with no memory of #1. It replays the history |
| t+18.0 s | Workflow **completed**. Card published |

From the event history afterwards: **21** `classify_alert` activities were scheduled, and none was scheduled twice. The **8** finished before the crash were kept, not re-run. Only the **4** that were in flight needed a second attempt, once their heartbeat timed out.

![{{TEMPORAL_UI_SCREENSHOT_ALT}}]({{TEMPORAL_UI_SCREENSHOT_URL}})

The dashboard (Next.js with BoardUI) is for setup and for the curious: pick parks, see every verdict, every run's attempt counts, and the eval table above. On a normal week you shouldn't need it.

## What went wrong

- **Temporal faithfully retried our own bug six times.** Workflows started by the Schedule get IDs with a timestamp in them, like `weekly-trailcard-havo-chch-2026-10-10T07:37:55Z`. We used the workflow ID as a filename for the run log, and Windows doesn't allow `:` in filenames. So every fetch succeeded, then the activity crashed writing its log. Temporal retried it at 1, 2, 4, 8 and 16 seconds, exactly as configured. Retries are for flaky things, and this wasn't flaky. The fix was a `safe_name()` for filenames, plus a rule that logging can never fail an activity.
- **The answer key is messier than it looks.** 64 alerts filed as *Information* or *Caution* say "closed" right in the title. NPS filed "Kīlauea eruption" as Information, so the gold answer is "go". When our model says no-go on a volcano, the scorer marks it wrong. We left those labels alone, because editing the answer key to flatter your model is how benchmarks die. That noise is why no model in the table gets near 100%.
- **…and sometimes the noise flatters us.** "Yockanookany Trail Section Closed to Equestrians" ends with "The trail will remain open to pedestrians." The teacher said go, which is right for a hiker. The LoRA had learned that *Park Closure* means no-go, said no-go, and the scorer gave it a point it didn't deserve.
- **Closures that don't matter.** 23 *Park Closure* alerts close only a parking lot, visitor center, bookstore or campground. We grade those as caution, not no-go, because a closed gift shop doesn't stop a hike. That's our one edit to the mapping, and `decision_acc_raw` in `eval.json` reports scores without it (LoRA 0.754).
- **Nobody caught the algae.** "Toxic Algae Found – Blue Mesa Water Quality Advisory" is filed as Danger ("no person or pet swims in, or drinks from, reservoir waters in the Iola Basin"). The teacher, the base and the LoRA all said caution. Only 13 of 627 alerts are Danger, so the student barely saw any.
- **We rate-limited ourselves.** That `429` came from our own agents sharing one IP and one `DEMO_KEY`. The data pipeline had spent the quota before the writing agent asked.

## Why Does Open Innovation Matter?

**The trailhead has no signal, and paper doesn't need any.** The card is made at home on Wi-Fi and works offline forever. The most reliable offline format we know of is a printer.

**Small and open means cheap enough to run for everyone, every week.** At $0.13 per 1,000 alerts, the student costs about 11× less than the teacher. A five-park card is about 30 alerts, which is less than half a cent. We also got to decide that this trade was worth it and measure it. A model you can't fine-tune doesn't give you that choice.

**Swapping models is one environment variable.** `TRAILTRUTH_MODEL_PROVIDER` switches between the Tinker-hosted LoRA, any OpenAI-compatible local server (Ollama, llama.cpp, vLLM), and the keyword heuristic.

**We own the fine-tune.** The adapter is ours to download, merge, quantize or throw away. If NPS changes how it writes alerts next year, we re-run the teacher and retrain the student for about $1.60. Nobody can deprecate it out from under us. (Someone did retire our first-choice model. Moving to another open one was a one-line change in `ml/common.py`.)

**Your parks list stays yours.** The only thing that leaves your machine is a request for public alerts by park code. Nobody gets your GPS position, your hiking plans or an account.

**The honest caveat:** teacher labelling, training and the default inference path all run on hosted infrastructure (Tinker). The data is public government text, so nothing private was sent. But "fully offline" only applies to the card, or to running the exported adapter yourself.

## Taking it outside

<!-- BONUS POINTS. Fill this in ONLY with what actually happened. No invented quotes, weather or wildlife.
     Prompts:
     - Which park and trail, and on what date? Who went?
     - Paste the exact card you printed (or a photo of it in your hand at the trailhead).
     - What did the card say, and was it right? Was a trail it flagged actually closed or signed?
     - Total screen time that day (Screen Time / Digital Wellbeing screenshot if you have one).
     - One thing the card got wrong or didn't tell you.
     - One photo from the trail (not of the phone). -->

{{FIELD_TEST_PARK_AND_TRAIL}}

{{FIELD_TEST_WHAT_THE_CARD_SAID}}

{{FIELD_TEST_WHAT_HAPPENED}}

![{{FIELD_TEST_PHOTO_ALT}}]({{FIELD_TEST_PHOTO_URL}})

## My Agent Session

TrailTruth was built by several coding agents working in parallel: data and ML, the Temporal backend, the dashboard, and the one that drafted this post. They all worked from one shared `CONTRACT.md` that fixed the schema before any code existed. Every session is checkpointed with **Entire**, and each checkpoint sits next to the commits it produced.

That matters when you ask why a line of code exists. Two examples:

- **Why doesn't the model ever see the NPS `category`,** the most useful field in the data? Because it's the held-out human label. Showing it to the model would mean grading the model on its own answer key. {{ENTIRE_WHY_EXAMPLE_LINK}}
- **Why does `agent/config.py` have a `safe_name()` that replaces every character except letters, digits, `_`, `.` and `-`?** Because of the Windows `:` bug above. The session where the backend agent found it is here: {{ENTIRE_SECOND_WHY_EXAMPLE}}

Entire checkpoints: {{ENTIRE_CHECKPOINTS_URL}}

{% agent_session {{DEVRELAY_SESSION_URL}} %}

## Prize Categories

- **Best Use of Tinker:** we distilled Qwen3.5-397B-A17B into a Qwen3.5-4B LoRA on Tinker and scored it on 126 held-out alerts graded by ranger labels. No-go recall went from 17/33 to 28/33 and decision accuracy from 0.643 to 0.746, at $0.13 per 1k alerts vs $1.50 for the teacher. The whole pipeline cost $1.60, and we've said where the comparison flatters us.
- **Best Use of Temporal:** a Temporal Schedule and a workflow with per-step retries, heartbeats for hung model calls, and a labelled fallback for a real 16-hour `429`. We hard-killed the worker mid-run: 21 activities scheduled, none twice, 8 kept, 4 retried.
- **Best Use of Entire:** the agent sessions behind the build are checkpointed and linked, and we use them to explain why specific code exists.
<!-- Keep ONLY if the live URL is actually served from Render: -->
- **Best Use of Render:** one web service from a `render.yaml` Blueprint runs the Temporal dev server, worker and API, with the NPS key kept out of the repo (`sync: false`). It survives worker crashes but not container restarts. For real durability you point it at Temporal Cloud, and the file says so.
<!-- Keep ONLY if Sentry was actually enabled and a trace screenshot is added: -->
- **Best Use of Sentry Agent Tracing:** each classify attempt is a `gen_ai.invoke_agent` transaction with a `gen_ai.chat` span that carries model, tokens, latency and cost. NPS fetches are `execute_tool` spans. ![{{SENTRY_TRACE_SCREENSHOT_ALT}}]({{SENTRY_TRACE_SCREENSHOT_URL}})

{{TEAM_CREDITS}}

What's the strangest park alert you've ever read before a hike? Leave it in the comments. If it involves an owl, we may need it for the test set.

<!--
PLACEHOLDER CHECKLIST. Every {{TOKEN}} must be replaced (or its line deleted) before publishing.

Media / links
[ ] {{COVER_IMAGE_URL}}               1000x420, see docs/cover-brief.md
[ ] {{HERO_GIF_URL}} {{HERO_GIF_ALT}}  dashboard -> "make card" -> printable card (<= 8 s loop)
[ ] {{LIVE_URL}}                       deployed web URL
[ ] {{DEMO_VIDEO_URL}}                 YouTube/Loom, 60-90 s
[ ] {{DASHBOARD_SCREENSHOT_URL}} {{DASHBOARD_SCREENSHOT_ALT}}
[ ] {{PRINTED_CARD_PHOTO_URL}} {{PRINTED_CARD_PHOTO_ALT}}
[ ] {{CONFUSION_MATRIX_URL}} {{CONFUSION_MATRIX_ALT}}   chart of eval.json confusion.base vs confusion.lora
[ ] {{TEMPORAL_UI_SCREENSHOT_URL}} {{TEMPORAL_UI_SCREENSHOT_ALT}}   Temporal UI (localhost:8233) for trailcard-2026-10-10-havo-yell-zion-16cf
[ ] {{GITHUB_REPO}}                    owner/repo (also add a LICENSE file and mention it in the Code section)

Card
[ ] {{CARD_TEXT}}                      exact text of a card from the LoRA provider run (backend regenerating).
                                       Check the card's model line says the LoRA, not heuristic-keywords-v1.

Field test (bonus). If nobody went outside, delete the whole "Taking it outside" section.
[ ] {{FIELD_TEST_PARK_AND_TRAIL}} {{FIELD_TEST_WHAT_THE_CARD_SAID}} {{FIELD_TEST_WHAT_HAPPENED}}
[ ] {{FIELD_TEST_PHOTO_URL}} {{FIELD_TEST_PHOTO_ALT}}

Agent session
[ ] {{ENTIRE_CHECKPOINTS_URL}} {{ENTIRE_WHY_EXAMPLE_LINK}} {{ENTIRE_SECOND_WHY_EXAMPLE}}
[ ] {{DEVRELAY_SESSION_URL}}           confirm exact agent_session liquid syntax on the challenge page
[ ] {{TEAM_CREDITS}}                   "Built by @user1 and @user2" (team rule: list DEV usernames in body)

Optional categories
[ ] Render bullet: keep only if LIVE_URL is on Render. NOTE render.yaml sets TRAILTRUTH_MODEL_PROVIDER=heuristic;
    switch it to tinker for the live demo or say in Demo that the live site runs the heuristic.
[ ] Sentry bullet: all demo logs show sentry=off. Keep only with a real trace screenshot:
    {{SENTRY_TRACE_SCREENSHOT_URL}} {{SENTRY_TRACE_SCREENSHOT_ALT}}. Otherwise delete the bullet.

Facts already filled (sources, re-check if anything is re-run)
- eval.json: decision_acc 0.6508/0.6429/0.6746/0.746/0.5794; macro-F1 0.6415/0.6307/0.6481/0.7422/0.5859;
  hazard_acc 0.9841/0.6111/0.7063/0.8333/0.627; closure_f1 base 0.8889 lora 0.8842 teacher 0.9231;
  cost/1k 1.4982/0.1282/0.2409/0.1314/0; p50 ~2354-2433 ms; json_valid 1.0 all; LoRA decision_acc_raw 0.754.
- no_go caught = confusion[*][2][2] of 33: teacher 18, base 17, base_guided 17, lora 28, heuristic 25.
- spend.json: teacher_label $0.9455, train_tinker $0.4058, total $1.6033.
- train_log.json: 501/126, r32, lr 4.905e-4, batch 16, 3 epochs/96 steps, wall 405.8 s, test_loss 0.338/0.223/0.223/0.286.
- data/labeled/teacher.jsonl: 627 rows, all attempts=1; 23 facility-only closures; 235 decision overrides (split_stats + ML README).
- ml/README: 64 Info/Caution alerts with closed/closure in title; Llama-3.2-1B/3B & Qwen3-4B-Instruct retired 2026-06-12.
- agent/demo_logs: 02 chaos (havo attempt 3, 3 hangs, 1 bad JSON), 03 real 429 Retry-After 16.4h -> snapshot,
  04 crash (21 scheduled / 8 kept / 4 retried, t+ times), 00 dev stack (':' bug retries at 1/2/4/8/16 s).
- My own observation 2026-10-10 07:18 GMT: X-Ratelimit-Limit: 10, Retry-After: 60076.
- data/raw/alerts.json: 627 alerts, 28,760 words, 13 Danger, 168 (27%) mention parking/visitor center/hours/holiday.
[ ] Final grep: no "{{" left; no hype words (revolutionary, seamless, leverage, delve, game-changer, cutting-edge).
-->
