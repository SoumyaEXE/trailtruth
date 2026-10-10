"""Deterministic keyword classifier - the `heuristic` provider.

Zero keys, zero network. Used for dev/demo and as the fallback when ml/infer.py is
unavailable. It is clearly labelled `heuristic-keywords-v1` everywhere it shows up.
It never sees the NPS `category` (held-out label), same as the real model.
"""
from __future__ import annotations

import re
import time

from shared.schema import TrailVerdict

MODEL_NAME = "heuristic-keywords-v1"

# keyword regex fragments per hazard; scored (title hits x3 + description hits), ties -> earlier rule
HAZARD_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("geologic", (r"volcan\w*", r"seismic\w*", r"earthquakes?", r"eruptions?", r"lava", r"hydrothermal",
                  r"rock ?falls?", r"landslides?", r"sinkholes?", r"kīlauea", r"kilauea", r"glaciers?", r"calving",
                  r"unstable slopes?")),
    ("fire", (r"fires?", r"burn bans?", r"burn restrictions?", r"prescribed burns?", r"wildfires?",
              r"burned areas?")),
    ("wildlife", (r"owls?", r"bears?", r"elk", r"bison", r"moose", r"rabies", r"rabid", r"bats?", r"snakes?",
                  r"rattlesnakes?", r"mountain lions?", r"cougars?", r"wildlife", r"animals?", r"alligators?",
                  r"sharks?", r"ticks?", r"bees", r"wasps?", r"coyotes?", r"deer", r"jellyfish")),
    ("air_quality", (r"air quality", r"vog", r"tephra", r"volcanic ash", r"sulfur dioxide", r"haze", r"smoke")),
    ("water", (r"cyanobacteria", r"algae", r"algal", r"floods?", r"flooding", r"high water", r"boil water",
               r"water quality", r"drinking water", r"water shut ?offs?", r"rip currents?", r"surf", r"tides?",
               r"creek crossings?", r"river crossings?", r"swift water")),
    ("weather", (r"weather", r"storms?", r"snow", r"ice", r"icy", r"heat", r"hurricanes?", r"winter", r"winds?",
                 r"lightning", r"cold", r"freezing")),
    ("construction", (r"construction", r"repairs?", r"rehabilitation", r"projects?", r"replacement",
                      r"maintenance", r"paving", r"shoulder work", r"tree removal", r"improvements?")),
    ("road", (r"roads?", r"highway", r"drive", r"parkway", r"traffic", r"route", r"lanes?", r"vehicles?", r"pass")),
    ("facility", (r"visitor centers?", r"campgrounds?", r"restrooms?", r"parking", r"boat ramps?", r"bridges?",
                  r"boardwalks?", r"lodges?", r"museums?", r"permits?", r"reservations?", r"tickets?", r"fees?",
                  r"shuttles?", r"cashless")),
]
_HZ_RE = {hz: re.compile(r"\b(?:" + "|".join(words) + r")\b", re.I) for hz, words in HAZARD_RULES}

DANGER_WORDS = ("rabies", "rabid", "explosion", "volcanic unrest", "unrest", "increased seismicity",
                "danger", "life-threatening", "hazardous conditions", "fatal", "evacuat", "do not enter",
                "extreme caution", "wildfire")
CAUTION_WORDS = ("caution", "hazard", "be aware", "beware", "use care", "unpredictable", "irritate", "delays",
                 "be cautious", "warning", "restriction", "advisory", "watch for", "stay at least", "slippery",
                 "do not", "avoid", "limited", "toxic")
OPEN_WORDS = ("is open", "are open", "remains open", "reopen", "now open", "not needed")
TRAIL_RELEVANT = {"closure", "geologic", "fire", "wildlife", "water", "weather", "air_quality"}

_NAME = r"(?:[A-ZĀĒĪŌŪ][\w'ʻ’āēīōū\.-]*|of|the|and)"
_PLACE_RE = re.compile(
    rf"\b((?:{_NAME}\s){{0,4}}?[A-ZĀĒĪŌŪ][\w'ʻ’āēīōū\.-]*\s"
    r"(?:Trail|Trails|Trailhead|Road|Loop|Pass|Highway|Boardwalk|Basin|Campground|Bridge|Area|Beach|Canyon|"
    r"Drive|Overlook|Falls|Lake|Cave|Zone))\b"
)
_STOP_LEAD = {"The", "A", "An", "Please", "Due", "Use", "Caution", "When", "Hiking", "Beginning", "All", "Our",
              "This", "of", "the", "and", "to", "on", "at", "Closed", "Temporary", "Part", "Road", "Beyond",
              "Past", "Between", "From", "Near", "Open", "Visit", "See"}
_DROP_ALWAYS = {"of", "the", "and", "to", "on", "at", "The", "Please", "Due", "Use", "Part", "Road", "Beyond",
                "Past", "Open"}
_CLOSED_TITLE_RE = re.compile(
    r"\b(clos(ed|ure|ures|ing)|shut\s?down|inaccessible|no (public )?access|washed out)\b", re.I)
_CLOSED_DESC_RE = re.compile(
    r"\b((is|are|will be|remains?|been|be|temporarily|currently|now|fully)\s+(temporarily\s+)?closed\b"
    r"|closed (to|until|due|for|beyond|past|at|between|from|through)\b|closure of|no (public )?access"
    r"|washed out)", re.I)
_TRAILISH = ("Trail", "Trails", "Trailhead", "Basin", "Area", "Zone", "Boardwalk", "Canyon", "Beach", "Loop",
             "Overlook", "Falls", "Cave")
_ROADISH = ("Road", "Highway", "Drive", "Pass", "Bridge", "Route", "Parkway", "Campground")
_ROAD_TITLE_RE = re.compile(
    r"\b(road|highway|drive|route|bridge|lane|parking|campground|visitor center|boat ramp)s?\b", re.I)
_FACILITY_TITLE_RE = re.compile(r"\b(campground|visitor center|restroom|boat ramp|parking)s?\b", re.I)


def _hazard(title: str, description: str) -> str:
    best, best_score = "other", 0
    for hz, rx in _HZ_RE.items():  # dict keeps HAZARD_RULES order -> ties go to the earlier rule
        score = 3 * len(rx.findall(title)) + len(rx.findall(description))
        if score > best_score:
            best, best_score = hz, score
    return best


def extract_places(text: str, limit: int = 5) -> list[str]:
    out: list[str] = []
    for m in _PLACE_RE.finditer(text):
        name = re.split(r"[.;:]\s+", m.group(1).strip())[-1]
        words = name.split()
        while words and words[0] in _STOP_LEAD and len(words) > 2:
            words = words[1:]
        while words and words[0] in _DROP_ALWAYS:
            words = words[1:]
        name = " ".join(words)
        if len(words) < 2 or name.lower() in (o.lower() for o in out):
            continue
        out.append(name)
        if len(out) >= limit:
            break
    return out


def _reason(title: str, description: str) -> str:
    sent = re.split(r"(?<=[.!?])\s+", description.strip())[0] if description.strip() else title
    words = sent.split()
    if len(words) > 20:
        words = words[:19] + [words[19].rstrip(",.;:") + "…"]
    return " ".join(words)[:200] or title[:200]


def heuristic_verdict(title: str, description: str) -> TrailVerdict:
    text = f"{title}. {description}"
    low = text.lower()
    title_low = title.lower()
    hazard = _hazard(title, description)
    closed_in_title = bool(_CLOSED_TITLE_RE.search(title))
    is_closed = closed_in_title or bool(_CLOSED_DESC_RE.search(description))
    if any(w in title_low for w in OPEN_WORDS) and not closed_in_title:
        is_closed = False
    trails = extract_places(text)
    title_places = extract_places(title)
    generic_title = not title_places
    trailish = [t for t in (trails if generic_title else title_places) if t.split()[-1] in _TRAILISH]
    roadish = [t for t in (title_places or trails) if t.split()[-1] in _ROADISH]
    trail_closed = is_closed and bool(trailish or (generic_title and "trail" in title_low))
    road_closed = is_closed and not trail_closed and (bool(roadish) or bool(_ROAD_TITLE_RE.search(title)))

    if road_closed and hazard in ("other", "weather", "water", "wildlife", "air_quality", "facility"):
        hazard = "facility" if _FACILITY_TITLE_RE.search(title) else "road"
    if (is_closed and hazard == "other") or (trail_closed and hazard in ("construction", "road", "facility")):
        hazard = "closure"

    danger = any(w in low for w in DANGER_WORDS)
    caution = any(w in low for w in CAUTION_WORDS)

    if danger or trail_closed or (is_closed and not road_closed and hazard in TRAIL_RELEVANT):
        decision, severity = "no_go", 3
    elif is_closed or caution or hazard in ("wildlife", "air_quality", "water", "weather", "fire", "geologic"):
        decision, severity = "caution", 2
    else:
        decision, severity = "go", 1
    return TrailVerdict(
        hazard_type=hazard,  # type: ignore[arg-type]
        severity=severity,
        trails_affected=trails,
        is_closed=is_closed,
        decision=decision,  # type: ignore[arg-type]
        reason=_reason(title, description),
    )


def classify(title: str, description: str) -> tuple[TrailVerdict, int, str]:
    """Same signature as ml.infer.classify."""
    t0 = time.perf_counter()
    v = heuristic_verdict(title, description)
    return v, max(1, int((time.perf_counter() - t0) * 1000)), MODEL_NAME
