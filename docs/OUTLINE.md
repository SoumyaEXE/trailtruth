# TrailTruth DEV post: research notes and outline

Researched 2026-10-10. Sources: the winners post for the previous challenge (Build for a Friend), six winning posts read in full or skimmed, ~90 current `#hf26challenge` Touch Grass entries listed, ~8 opened, and the live NPS alerts API plus our own snapshot in `data/raw/alerts.json`.

---

## 1. What the winning posts did

Posts read:

| Prize | Post | Words | Notes |
|---|---|---|---|
| Overall | "Phone calls are the boss fight of living in Japan" (Before I Call) | ~2,900 | Hero GIF first, then one personal sentence. |
| Tinker (featured) | "Rakshak: I built my parents a scam-checker that never leaves the house" | ~2,160 | Base vs LoRA table. The writeup is built around *one* number. |
| Temporal | "PaidYet: for the friend who says 'kal bhej dunga'" | ~2,270 | Timestamped kill-and-restart table. |
| Entire | "Viva: a mock interview that knows which parts of your project an AI wrote" | ~1,060 | Short. Entire is the product's data source. |
| Sentry | "If it's not in front of me, it's gone: I fine-tuned a 4B model for my friend with ADHD" | ~2,870 | TL;DR box, the friend's words quoted verbatim. |
| Gemma | "Gemma 4 reads my parent's mail at home: 39 test letters, 9 of them real, and one calm wrong answer" | ~2,830 | Title packs in the numbers and the failure. |

### Patterns worth copying

1. **The first screen is concrete.** Before I Call puts the hero GIF first, then "I stared at the building manager's number for twenty minutes." Kitchen Table opens on the pile of envelopes on the table. None of them open with "In today's world". → We open with a real NPS alert, quoted exactly.
2. **Titles are sentences with a number or a twist**, not "X: AI-powered Y". "39 test letters, 9 of them real, and one calm wrong answer." "I hard-killed my hiking safety app mid-trip. The alert still went out." → Our title needs the alert count and the size of the distilled model.
3. **One number carries the story, and the post says which one.** Rakshak: "The interesting number isn't the F1. It's the false alarms… That's the whole project in one row." → After our table, name the row that matters (probably JSON-valid rate or no_go recall for the LoRA student vs base) and say why a hiker cares.
4. **Honesty scores points.** Every winner has a section like "Bugs I hit", "What it can't do (yet)", "The honest caveat", "What I refused to promote", or "Not claiming". Rakshak says "small-sample numbers on public data, not a benchmark claim". Viva measured local Gemma at 50 to 544 s per call and said so. → We get a real "What went wrong" section: label noise in NPS categories, only 13 Danger alerts, the DEMO_KEY 429.
5. **Numbers everywhere, with units.** "$3.80 of the $10 Tinker credit", "p50 0.8 s, p95 0.9 s", "138 unit tests", "24.6 s late, not lost". → Placeholders for every number, no rounding into adjectives.
6. **The Temporal winner proved durability with a timestamped table** (saved → Ctrl-C → timer fires with no worker → restart → arrived 24.6 s late) plus a Temporal UI screenshot. → Do the same: kill the worker mid-classification and log the timestamps.
7. **The Entire winner tied Entire to *why the code exists*.** "Each phase is one commit, and each commit carries its Entire checkpoint", plus a numbered DECISIONS.md. → Show one concrete "why does this line exist?" answered from a checkpoint (e.g. why the model never sees the NPS `category`).
8. **One-line design rules readers remember.** "Gemma decides what to say. Code decides what happens." "Gemma reads, code decides." → Ours: "The big model teaches. The small model works. The rangers grade."
9. **Prize categories get one specific sentence each** (what was used, measured against what), and Baahar has a "Not claiming" list. → Each category line points to proof in the post.
10. **Alt text works as a caption.** Every image has a full-sentence description. → Required for all our screenshots.
11. **They end with a question to readers** ("Have you been asked to explain code your AI wrote?"). → Ask readers which park alert confused them most.
12. **They never invent quotes.** Rakshak left an HTML comment: "replace with what they ACTUALLY said… Never invent a quote." → Same approach for our field test.
13. **Length: 1,000–2,900 words.** Writing quality is the heaviest criterion, but the shortest winner (Viva, ~1,060) still won its category. Scannable beats long. → Aim for ~2,000.
14. **Voice:** short sentences, first person, plain verbs, few or no emojis, no hype words. Code blocks only where the code is load-bearing (a `render.yaml`, a schema, an ASCII architecture diagram).

---

## 2. Competitive scan: current Touch Grass entries (as of 2026-10-10)

Crowded angles we should **not** claim as our novelty:

- **"An AI that wants you to close it."** At least 8 entries say this outright (OutSideQuest, TrailMind AI, Outbound, WanderWise, TrailBuddy "The AI That Disappears", Baahar "success metric is leaving the house", Pocket Field Guide…). → Our "app you open once" thesis is the frame, not the pitch. Mention it in a line and move on.
- **Printable cards.** Pocket Outside ("a park plan to print"), grasscard ("prints you a pocket card"), "The AI That Prints You a Walk", Grass Pass ("one park, one sheet of paper", a treasure hunt built from OSM and iNaturalist), CleanWalk field card. → Our card is different because of *what's on it*: official closures and hazards, checked against ranger labels. It isn't a quest or a plan.
- **Temporal + hiking safety.** TrailWatch: "I hard-killed my hiking safety app mid-trip. The alert still went out." They own the kill-the-timer headline. → Our Temporal story is about a **flaky, rate-limited government API and a model call** in a weekly batch, where a crash shouldn't re-spend quota or re-classify. Don't put "killed" in our title.
- **Go/no-go outdoor decisions.** Baahar (Bengaluru AQI, TabPFN), GrassCast (weather forecaster, per brief). → Ours reads *human-written park alerts*, not sensors or forecasts.
- **Fine-tuned botanist.** FloraQuest (Tinker, per brief), plus many plant and bird ID apps. → We're not doing identification.
- **Offline trail companions.** TrailKit, Canopy, WildLens, Field Notes.

**Nobody else uses NPS alerts, distillation, or human ground truth.** Our three distinct claims:
1. **Source:** 627 official NPS alerts, written by rangers, that nobody reads in full.
2. **Method:** distill a large open teacher into a 1–3B open student on Tinker, then score both against the **rangers' own category labels**, which the model never sees. Teacher-vs-student-vs-base on real government text is unusual this week.
3. **Durability:** a weekly Temporal workflow against an API whose demo key allows 10 requests an hour (we hit `429 OVER_RATE_LIMIT` ourselves while building).

---

## 3. Facts we can use (verified 2026-10-10)

From `data/raw/alerts.json` (team snapshot) and the live API:

- **627 alerts** across **279 park units**. **28,760 words** in total, median 43 words per alert. At ~240 wpm that's about **two hours** of reading.
- Categories: **Information 308 · Park Closure 168 · Caution 138 · Danger 13**. Danger is 2% of the data, which is a real class-imbalance problem.
- **Label noise:** 94 alerts filed as Information or Caution contain the word "closed". Examples: "Kīpukapuaulu Trail Closed Due to Hazardous Trees and Hanging Limbs" is filed as **Caution**. "Mauna Loa Road Closed Past Second Cattle Guard for Tree Removal" is filed as **Information**, even though "Vehicles, bicyclists and pedestrians will not be allowed".
- 19 alerts filed as **Park Closure** are about a parking lot, visitor center, lift, museum or house (e.g. "Parking Lot Closed October 27-28, 2026"). Under our mapping, closure means no_go, which is wrong for a hiker. Be honest about this.
- DEMO_KEY response header: `X-Ratelimit-Limit: 10`. We got `HTTP/1.1 429 Too Many Requests` / `"code": "OVER_RATE_LIMIT"` with **`Retry-After: 60076`** (about 16.7 hours) on 2026-10-10 at 07:18 GMT, because other agents had already used up the key's quota. That's a great Temporal hook: a workflow that can sleep 16 hours and resume.
- 168 of 627 alerts (27%) mention parking, a visitor center, hours or a holiday.

Hook candidates (exact text, live API 2026-10-09):

- **chch, Caution**, "Use Caution When Hiking Bluff Trail on Lookout Mountain": "Please exercise caution when hiking the section of Bluff Trail, between the Cravens House Trail and the base of the metal staircase below Point Park, as a territorial barred owl may be present. We appreciate your vigilance and your patience as we work on a solution." ← **chosen hook**
- **havo, Park Closure**, "Halemaʻumaʻu Trail and Part of Byron Ledge Trail Closed Due to Safety Risks": "…temporarily closed due to continued inflation and increased seismicity at the summit of Kīlauea volcano. The closure is a total of 1.3 miles."
- **olym, Danger**, rabid bat: "…the bat swooped down onto an unidentified woman and was temporarily caught in her hair."
- **yell, Caution**, "Stay Away From Bull Elk": "Bull elk are fast and unpredictable this time of year and can seriously injure people. If an elk charges, run."
- **lake, Danger**, heat closures: "This emergency trail closure is necessary to prevent loss of life and/or serious bodily injury to the public."
- **ruca, Park Closure**, "Parking Lot Closed October 27-28, 2026". Good as the boring counterweight.

---

## 4. Post outline (what `POST.md` follows)

**Update after real results (2026-10-10):** title now leads with numbers: **"627 park alerts, one printed card: distilling a 397B model into a 4B one for $1.60"**. Backups: "A 4B model caught 28 of 33 trail closures its base model missed half of" / "$1.60 to teach a 4B model to read every national park alert". The owl alert stays as the body's cold open, but it's in TRAIN, so the test example is the Ocmulgee boardwalk alert, and the honesty example is Yockanookany ("closed to equestrians", where the LoRA got a point it didn't deserve). Prose is ~2,740 words, plus tables and code.

Original title candidates:
- A. **"A territorial barred owl may be present": distilling 627 park alerts into one card you take outside** ← preferred
- B. 627 park alerts, one index card: I taught a {{STUDENT_SIZE}} model to read them so you can go hike
- C. The rangers already labeled the data: a {{STUDENT_SIZE}} model, 627 NPS alerts, and one printable trail card

Sections (≈ words):
1. Cold open (150): owl alert blockquote → "real, posted for Lookout Mountain" → 627 alerts / 28,760 words / mostly parking lots → you need about three → hero GIF.
2. TL;DR box (70).
3. **What I Built** (300): the card, who it's for, "the app shuts up", KPI = minutes not spent. One line acknowledging the close-the-app crowd and what we add (a measurable claim).
4. **Demo** (80): live URL, video, GIF, card screenshot.
5. **Code** (40): `{% github %}`, license, test count.
6. **How I Built It** (750)
   - Architecture ASCII.
   - "The rangers already labeled the data" (held-out category).
   - Distillation on Tinker + results table + "the row that matters" + before/after example on the owl alert + training cost.
   - Temporal: weekly workflow, DEMO_KEY, retries, kill-and-resume timestamp table.
   - Dashboard (BoardUI) in two sentences.
7. **What went wrong** (250): label noise, 13 Danger alerts, parking-lot no_go, 429 during writing, ML failure placeholder.
8. **Why Does Open Innovation Matter?** (250): paper is the most offline format, location privacy, cost of a tiny model, swapping models with one env var, owning the fine-tune. Honest caveat.
9. **Field test** (bonus, 150, user fills in).
10. **My Agent Session** (150): Entire checkpoints, a "why does this code exist" example, DevRelay embed.
11. **Prize Categories** (120): one proof sentence each, plus a "Not claiming" line.
12. Closing question + team credits.
13. Hidden placeholder checklist.
