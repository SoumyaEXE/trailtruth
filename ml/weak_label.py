"""Deterministic heuristic labeler (no keys, no network). Also the `heuristic` provider in ml.infer.

    python ml/weak_label.py      -> data/labeled/heuristic.jsonl
"""
from __future__ import annotations

import re
import sys
import time
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shared.schema import TrailVerdict  # noqa: E402

# Ordered: first match wins (specific hazards before generic construction/road/facility/closure).
_HAZARDS: list[tuple[str, re.Pattern]] = [
    ("fire", re.compile(r"\b(wildfire|fire|burn(ing)?|prescribed burn|fire restrictions?|red flag)\b", re.I)),
    ("air_quality", re.compile(r"\b(smoke|air quality|haze|ozone)\b", re.I)),
    ("geologic", re.compile(r"\b(volcan\w*|eruption|lava|rock ?fall|rockslide|landslide|mudslide|sinkhole|glacier|"
                            r"earthquake|unstable (cliff|slope)|erosion|vog|sulfur dioxide|crater)\b", re.I)),
    ("wildlife", re.compile(r"\b(bears?|owls?|bison|elk|moose|wolf|wolves|cougar|mountain lion|rattlesnakes?|snakes?|"
                            r"rabies|rabid|bats?|wildlife|animals?|ticks?|alligators?|sharks?|bees?|wasps?|nesting|"
                            r"rut|coyotes?|deer|birds?|turtles?|seals?|sea lions?)\b", re.I)),
    ("water", re.compile(r"\b(flood\w*|high water|algae|algal|cyanobacteria|water quality|boil water|drinking water|"
                         r"water (shut ?off|outage|system)|rip currents?|river levels?|e\.? ?coli|bacteria)\b", re.I)),
    ("weather", re.compile(r"\b(storms?|hurricane|tropical|snow|ice|icy|winter|weather|heat|hot|wind|lightning|"
                           r"rain|freez\w*|cold|tornado|monsoon)\b", re.I)),
    ("construction", re.compile(r"\b(construction|repairs?|rehabilitation|restoration|renovation|maintenance|"
                                r"project|preservation work|paving|improvements?)\b", re.I)),
    ("road", re.compile(r"\b(road|roads|highway|hwy|parkway|lanes?|traffic|drive|route|vehicles?|bridge|"
                        r"scenic drive|pass)\b", re.I)),
    ("facility", re.compile(r"\b(visitor (center|centre)|museum|restrooms?|parking|campgrounds?|bookstore|store|"
                            r"building|house|elevator|shuttle|ferry|dock|boat ramp|pavilion|amphitheater|"
                            r"dump station|wifi|cell|phone|entrance station)\b", re.I)),
]
_CLOSED = re.compile(r"\b(closed|closure|closures|closing|closes|close|shut ?down|out of service)\b", re.I)
_REOPEN_ONLY = re.compile(r"\b(re-?opened|now open|is open)\b", re.I)
_DANGER = re.compile(r"\b(danger\w*|hazard\w*|warning|toxic|rabies|eruption|evacuat\w*|life[- ]threatening|"
                     r"aggressive|attack\w*|unsafe|deadly|fatal)\b", re.I)
_CAUTION = re.compile(r"\b(caution|careful|be aware|watch for|alert|advisory|expect delays?|delays?|"
                      r"limited|reduced|partial)\b", re.I)
_PARTIAL = re.compile(r"\b(partial(ly)?|portion|section of|lane closures?|single lane|some)\b", re.I)
_FACILITY_ONLY = re.compile(r"\b(visitor (center|centre)|museum|restrooms?|parking( lot| area)?|campgrounds?|"
                            r"bookstore|store|building|house|elevator|dump station|observation deck|gallery|"
                            r"pavilion|office)\b", re.I)
_AREA = re.compile(r"\b(trails?|trailhead|road|highway|area|island|beach|canyon|summit|backcountry|"
                   r"park (is )?closed|loop|path|pass|drive|parkway)\b", re.I)
_NAMED = re.compile(
    r"((?:[A-Z][\w'ʻ’Ā-ſ\-]*[ \t]){1,5}"
    r"(?:Trail|Trails|Path|Loop|Trace|Towpath|Road|Rd\.|Drive|Highway|Parkway|Pass|Campground|Overlook|Trailhead))\b"
)
_STOP_FIRST = {"The", "A", "An", "Use", "Caution", "Closure", "Closed", "Temporary", "Partial", "When", "Hiking",
               "Please", "Alert", "Update", "Section", "Northbound", "Southbound", "Due", "And", "On", "At", "In",
               "Of", "Eastern", "Western", "Southern", "Northern", "Upper", "Lower", "Seasonal"}


def _trails(text: str) -> list[str]:
    out: list[str] = []
    for m in _NAMED.finditer(text):
        words = m.group(1).split()
        while words and words[0] in _STOP_FIRST:
            words = words[1:]
        name = " ".join(words)
        if len(words) >= 2 and name not in out and not name.lower().startswith("national historic"):
            out.append(name)
    return out[:5]


def heuristic_verdict(title: str, description: str) -> TrailVerdict:
    text = f"{title}. {description}"
    hazard = next((h for h, rx in _HAZARDS if rx.search(title)), None) or \
        next((h for h, rx in _HAZARDS if rx.search(description)), None)
    closed_title = bool(_CLOSED.search(title)) and not _REOPEN_ONLY.search(title)
    closed = closed_title or bool(_CLOSED.search(description) and not _REOPEN_ONLY.search(title))
    if hazard is None:
        hazard = "closure" if closed else "other"
    facility_only = bool(_FACILITY_ONLY.search(title)) and not _AREA.search(title)
    partial = bool(_PARTIAL.search(title))

    if closed_title and not facility_only and not partial:
        severity = 3
    elif _DANGER.search(text) and hazard in ("fire", "geologic", "wildlife", "water", "weather", "air_quality"):
        severity = 3
    elif closed or _CAUTION.search(text) or hazard in ("wildlife", "weather", "fire", "geologic", "water", "air_quality"):
        severity = 2
    else:
        severity = 1
    decision = {1: "go", 2: "caution", 3: "no_go"}[severity]
    trails = _trails(text)

    lead = {"go": "Informational", "caution": "Use caution", "no_go": "Avoid"}[decision]
    where = f" {trails[0]}" if trails else ""
    words = re.sub(r"\s+", " ", title).strip().split()
    reason = f"{lead}{':' if not where else ' -'}{where}: " if where else f"{lead}: "
    reason += " ".join(words[: max(4, 18 - len(reason.split()))])
    reason = " ".join(reason.split()[:20])[:200]
    return TrailVerdict(hazard_type=hazard, severity=severity, trails_affected=trails, is_closed=closed,
                        decision=decision, reason=reason)


def main() -> None:
    from ml.common import LABELED, derive_gold, first_park_code, load_alerts, utf8_stdout, write_jsonl
    from collections import Counter

    utf8_stdout()
    rows = []
    for a in load_alerts():
        t0 = time.perf_counter()
        v = heuristic_verdict(a["title"], a.get("description", ""))
        ms = (time.perf_counter() - t0) * 1000
        rows.append({
            "id": a["id"], "park_code": first_park_code(a), "title": a["title"], "description": a.get("description", ""),
            "nps_category": a.get("category"), **derive_gold(a),
            "verdict": v.model_dump(), "valid": True, "model": "heuristic", "latency_ms": round(ms, 3),
        })
    out = LABELED / "heuristic.jsonl"
    write_jsonl(out, rows)
    agree = sum(r["verdict"]["decision"] == r["gold_decision"] for r in rows) / len(rows)
    print(f"wrote {len(rows)} -> {out}  (decision agreement with gold: {agree:.3f})")
    print("hazards:", dict(Counter(r["verdict"]["hazard_type"] for r in rows)))


if __name__ == "__main__":
    main()
