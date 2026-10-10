"""Shared helpers for the TrailTruth ML pipeline (paths, gold labels, JSON parsing, pricing, Tinker setup)."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pydantic import ValidationError  # noqa: E402

from shared.schema import CATEGORY_TO_DECISION, SYSTEM_PROMPT, TrailVerdict, user_prompt  # noqa: E402

DATA = ROOT / "data"
RAW = DATA / "raw"
LABELED = DATA / "labeled"
SPLITS = DATA / "splits"
RESULTS = ROOT / "ml" / "results"

# ---------------------------------------------------------------------------------------------
# Model choice (verified against ServiceClient().get_server_capabilities() on 2026-10-10).
# Llama-3.2-1B/3B, Qwen3-4B-Instruct-2507 and Qwen3-235B-A22B-Instruct-2507 were retired from
# Tinker on 2026-06-12; the docs' recommended replacements are Qwen3.5-4B / Qwen3.5-397B-A17B
# (non-thinking mode). Same tokenizer + chat template family for teacher and student.
# ---------------------------------------------------------------------------------------------
TEACHER_MODEL = os.environ.get("TRAILTRUTH_TEACHER", "Qwen/Qwen3.5-397B-A17B")
STUDENT_MODEL = os.environ.get("TRAILTRUTH_STUDENT", "Qwen/Qwen3.5-4B")
RENDERER_NAME = os.environ.get("TRAILTRUTH_RENDERER", "qwen3_5_disable_thinking")

# $/1M tokens, snapshot of https://tinker-docs.thinkingmachines.ai/tinker/models.json (2026-10-10)
PRICING = {
    "Qwen/Qwen3.5-397B-A17B": {"prefill": 1.65, "sample": 7.50, "train": 6.60},
    "Qwen/Qwen3.5-4B": {"prefill": 0.33, "sample": 1.005, "train": 0.737},
    "Qwen/Qwen3.5-9B": {"prefill": 0.30, "sample": 0.807, "train": 1.463},
    "Qwen/Qwen3-8B": {"prefill": 0.195, "sample": 0.60, "train": 0.44},
    "deepseek-ai/DeepSeek-V3.1": {"prefill": 1.695, "sample": 4.215, "train": 3.718},
}


def price_of(model: str) -> dict[str, float]:
    return PRICING.get(model.split(":")[0], {"prefill": 0.0, "sample": 0.0, "train": 0.0})


def sample_cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    p = price_of(model)
    return (prompt_tokens * p["prefill"] + completion_tokens * p["sample"]) / 1e6


# Teacher-only guidance ("prompt distillation"): the teacher gets SYSTEM_PROMPT + these rules;
# the student is trained/evaluated with the bare SYSTEM_PROMPT and must internalise them.
TEACHER_GUIDE = """
Rules:
- decision: no_go if a trail, trailhead, area, island, beach, road or the whole park in the alert is closed, or there is an active danger (fire, eruption, flood, aggressive wildlife attacking, toxic water you would contact). caution if hikers can still go but must take care or plan around it (wildlife present, weather, construction delays, partial/lane closures, only buildings/visitor centers/parking/campgrounds/restrooms closed). go if the alert is purely informational (hours, fees, permits, events, policies) and nothing on the ground is closed or hazardous.
- severity: 1 info, 2 caution, 3 danger; keep it consistent with decision (go=1, caution=2, no_go=3).
- hazard_type: the main cause. closure only if no more specific cause is given; construction for repairs/restoration/work; road for road/traffic issues; facility for buildings, visitor centers, parking, campgrounds, restrooms, water systems; water for floods, rivers, algae, water quality; geologic for volcano, rockfall, landslide, glacier; air_quality for smoke/haze.
- trails_affected: exact proper names of trails, roads, areas or facilities named in the alert (e.g. "Bluff Trail", "Glacier Point Road"); [] if none are named. Never invent names.
- is_closed: true only if something is actually closed now or during the stated dates.
- reason: one plain sentence, at most 20 words, telling a hiker what matters.
Output the JSON object only."""

TEACHER_SYSTEM_PROMPT = SYSTEM_PROMPT + "\n" + TEACHER_GUIDE.strip()


def messages_for(title: str, description: str, system: str = SYSTEM_PROMPT) -> list[dict]:
    return [{"role": "system", "content": system}, {"role": "user", "content": user_prompt(title, description)}]


# ------------------------------------------------------------------------------------- env / io
def load_dotenv(path: Path = ROOT / ".env") -> None:
    """Minimal .env loader. Never prints values; does not override existing env vars."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip().removeprefix("export ").strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def require_tinker_key() -> None:
    load_dotenv()
    if not os.environ.get("TINKER_API_KEY"):
        raise SystemExit(
            "TINKER_API_KEY is not set. Put it in the repo-root .env (TINKER_API_KEY=...) or export it, "
            "then rerun. (Get a key at https://tinker-console.thinkingmachines.ai)"
        )


def utf8_stdout() -> None:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass  # tolerate a torn last line from an interrupted run
    return out


def write_jsonl(path: Path, rows: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def load_alerts() -> list[dict]:
    p = RAW / "alerts.json"
    if not p.exists():
        raise SystemExit("data/raw/alerts.json missing - run: python ml/fetch_alerts.py")
    return json.loads(p.read_text(encoding="utf-8"))["data"]


def load_parks() -> dict[str, dict]:
    p = RAW / "parks.json"
    return json.loads(p.read_text(encoding="utf-8")).get("data", {}) if p.exists() else {}


def first_park_code(alert: dict) -> str:
    for c in (alert.get("parkCode") or "").split(","):
        c = c.strip().lower().rsplit("/", 1)[-1]
        if c:
            return c
    return ""


# ----------------------------------------------------------------------------------- gold label
# NPS `category` is the real human label. One documented adjustment (see ml/README.md):
# a "Park Closure" whose TITLE is about facilities only (parking lot, visitor center, bookstore,
# museum, campground, lane closure ...) and names no trail/road/area is NOT a no-go for a hiker
# -> gold "caution". Everything else follows CATEGORY_TO_DECISION verbatim. We report accuracy
# against both the adjusted gold (primary) and the raw category mapping.
_FACILITY = re.compile(
    r"\b(parking|lot|visitor (center|centre)|welcome center|bookstore|book store|store|museum|gallery|"
    r"house|building|restroom|bathroom|dump station|campground|camping|pavilion|observation deck|deck|"
    r"dock|boat ramp|ferry|office|elevator|amphitheater|cafe|restaurant|gift shop|lane closures?|"
    r"single lane|bag policy|shuttle|tour)\b",
    re.I,
)
_AREA = re.compile(
    r"\b(trails?|trailhead|path|towpath|loop|trace|road|rd\.?|highway|hwy|drive|dr\.|parkway|pass|area|"
    r"island|key|beach|canyon|summit|volcano|crater|backcountry|section|park (is |will be )?closed|"
    r"park closed|park closure|site closed|site closure|closures? due|weather|hurricane|fire|bridge|"
    r"river|falls|overlook|garden|rookery|meadow|wilderness)\b",
    re.I,
)


def is_facility_only(title: str) -> bool:
    return bool(_FACILITY.search(title)) and not _AREA.search(title)


def derive_gold(alert: dict) -> dict[str, Any]:
    cat = alert.get("category") or alert.get("nps_category") or "Information"
    raw = CATEGORY_TO_DECISION.get(cat, "go")
    gold, flags = raw, []
    title = alert.get("title") or ""
    if cat == "Park Closure" and is_facility_only(title):
        gold = "caution"
        flags.append("facility_only_closure")
    if cat in ("Information", "Caution") and re.search(r"\bclos(ed|ure|ures|ing|es)\b", title, re.I):
        flags.append("non_closure_category_mentions_closed")  # kept as-is (human label), just flagged
    return {"gold_decision": gold, "gold_decision_raw": raw, "gold_flags": flags,
            "gold_is_closed_cat": cat == "Park Closure"}


# ---------------------------------------------------------------------------------- JSON parsing
_JSON_OBJ = re.compile(r"\{.*\}", re.S)


def parse_verdict(text: str) -> tuple[TrailVerdict | None, str | None]:
    """Strictly-ish parse model text into a TrailVerdict. Returns (verdict, error)."""
    if text is None:
        return None, "empty"
    t = text.strip()
    t = re.sub(r"^<think>.*?</think>", "", t, flags=re.S).strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t).strip()
    m = _JSON_OBJ.search(t)
    if not m:
        return None, "no_json_object"
    try:
        obj = json.loads(m.group(0))
    except json.JSONDecodeError as e:
        return None, f"json_error: {e.msg}"
    if not isinstance(obj, dict):
        return None, "not_object"
    try:
        return TrailVerdict.model_validate(obj), None
    except ValidationError as e:
        return None, "schema_error: " + "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()[:3])


def verdict_json(v: TrailVerdict) -> str:
    """Canonical compact JSON used as the SFT target (stable key order)."""
    return json.dumps(v.model_dump(), ensure_ascii=False, separators=(", ", ": "))


# ------------------------------------------------------------------------------------- tinker
def make_renderer(model: str):
    """Cookbook tokenizer + renderer for a Tinker model (non-thinking Qwen3.5 chat template)."""
    from tinker_cookbook import renderers
    from tinker_cookbook.tokenizer_utils import get_tokenizer

    tok = get_tokenizer(model)
    return tok, renderers.get_renderer(RENDERER_NAME, tok, model_name=model)


def percentile(xs: list[float], q: float) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def add_spend(stage: str, entry: dict) -> None:
    """Accumulate token / $ estimates per stage into ml/results/spend.json."""
    RESULTS.mkdir(parents=True, exist_ok=True)
    p = RESULTS / "spend.json"
    data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"stages": {}}
    data["stages"][stage] = entry
    data["total_est_usd"] = round(sum(s.get("est_usd", 0.0) for s in data["stages"].values()), 4)
    data["note"] = "Estimates from token counts x Tinker list prices (models.json snapshot 2026-10-10); not an invoice."
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
