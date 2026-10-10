"""Deterministic aggregation: ProcessedAlert[] -> TrailCard. No model calls, no I/O.

Used by the `compose_card` activity, by refresh.py (park summaries) and by make_fixtures.py,
so the card you see in fixtures is exactly what the workflow produces.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

from shared.schema import CardPark, ProcessedAlert, TrailCard

RANK = {"go": 0, "caution": 1, "no_go": 2}
_TRAILISH = ("Trail", "Trails", "Trailhead", "Boardwalk", "Basin", "Area", "Zone", "Canyon", "Beach", "Loop",
             "Overlook", "Falls", "Cave", "Lake")
_ROADISH = ("Road", "Roads", "Highway", "Drive", "Pass", "Bridge", "Route", "Parkway", "Campground", "Lot",
            "Entrance")
_WATCH_PRIORITY = ["wildlife", "geologic", "fire", "water", "air_quality", "weather", "closure", "other",
                   "construction", "road", "facility"]


def worst(decisions) -> str:
    ds = list(decisions)
    return max(ds, key=lambda d: RANK[d]) if ds else "go"


def week_of(today: date | None = None) -> str:
    """The Saturday of the current week (the trip the card is for)."""
    today = today or datetime.now(timezone.utc).date()
    return (today + timedelta(days=(5 - today.weekday()) % 7)).isoformat()


def _short(text: str, n: int = 9) -> str:
    text = re.sub(r"\s+", " ", text).strip().rstrip(".")
    words = text.split()
    return " ".join(words[:n]) + ("…" if len(words) > n else "")


def _hiker_decision(a: ProcessedAlert) -> str:
    """Worst-decision rule, from a hiker's point of view: a no_go that is only a road/facility closure
    (no trail or area named) makes the park 'caution', not 'no_go' - you can still hike, just drive around."""
    v = a.verdict
    if v.decision == "no_go" and v.is_closed and v.hazard_type in ("road", "construction", "facility") and \
            not any(t.split()[-1] in _TRAILISH for t in v.trails_affected if t):
        return "caution"
    return v.decision


def compose_park(park_code: str, park_name: str, alerts: list[ProcessedAlert]) -> CardPark:
    alerts = sorted(alerts, key=lambda a: (-RANK[a.verdict.decision], -a.verdict.severity, a.title))
    decision = worst(_hiker_decision(a) for a in alerts)

    closed: list[str] = []
    roads: list[str] = []

    def add(lst: list[str], name: str) -> None:
        if name.lower() not in (x.lower() for x in lst + closed + roads):
            lst.append(name)

    for a in alerts:
        if not a.verdict.is_closed:
            continue
        names = [t for t in a.verdict.trails_affected
                 if t and "/" not in t and not any(w in t for w in ("Closures", "Updates", "Alerts"))]
        trail_names = [t for t in names if t.split()[-1] in _TRAILISH]
        road_names = [t for t in names if t.split()[-1] in _ROADISH]
        other = [t for t in names if t not in trail_names and t not in road_names and len(t.split()) <= 5]
        if a.verdict.decision == "no_go":
            for t in trail_names:
                add(closed, t)
            if a.verdict.hazard_type in ("road", "construction", "facility") and not trail_names:
                for t in road_names or other[:1]:
                    add(roads, t)
            else:
                for t in road_names:
                    add(roads, t)
                if not trail_names and other and a.verdict.hazard_type not in ("road", "facility"):
                    add(closed, other[0])  # e.g. "Keanakākoʻi area"
        elif a.verdict.hazard_type in ("road", "construction", "facility") and (road_names or names):
            add(roads, (road_names or names)[0])

    def prio(a: ProcessedAlert) -> int:
        return _WATCH_PRIORITY.index(a.verdict.hazard_type) if a.verdict.hazard_type in _WATCH_PRIORITY else 99

    watch: list[str] = []
    for a in sorted(alerts, key=prio):
        if a.verdict.is_closed and a.verdict.hazard_type in ("road", "construction", "facility"):
            continue  # summarized as one "Closed roads" line below
        if a.verdict.decision == "caution" or (a.verdict.decision == "no_go" and not a.verdict.is_closed):
            item = _short(a.title)
            if item.lower() not in (w.lower() for w in watch):
                watch.append(item)
    watch = watch[:3]
    if roads:
        watch.append("Closed: " + ", ".join(roads[:3]))
    closed = closed[:6]

    if not alerts:
        headline = "Go — no active alerts"
    elif decision == "go":
        headline = "Go — nothing trail-relevant this week"
    elif decision == "caution":
        first = next((w for w in watch if not w.startswith("Closed: ")), None)
        if first:
            headline = f"Go with care — {first}"
        elif roads:
            headline = "Go — trails open; closed: " + " & ".join(roads[:2])
        else:
            headline = "Go with care — check conditions"
    else:
        open_alerts = [a for a in alerts if a.verdict.decision != "no_go"]
        # A park with a few closed trails is still visitable: the park-level call is
        # caution, and the no_go applies to the named trails (listed in closed_trails).
        if closed and (open_alerts or len(closed) <= 2):
            decision = "caution"
            headline = "Go, but skip " + " & ".join(closed[:2])
        elif roads and not closed:
            decision = "caution"
            headline = "Go — trails open; closed: " + " & ".join(roads[:2])
        else:
            nogo = next(a for a in alerts if a.verdict.decision == "no_go")
            headline = "No-go — " + _short(nogo.title, 8)
            watch = [w for w in watch if w != _short(nogo.title)]
    return CardPark(
        park_code=park_code,
        park_name=park_name,
        decision=decision,  # type: ignore[arg-type]
        headline=headline,
        closed_trails=closed,
        watch_for=watch,
        alert_ids=[a.id for a in alerts],
    )


def compose_card(parks: list[str], park_names: dict[str, str], alerts: list[ProcessedAlert],
                 workflow_id: str, generated_at: str | None = None,
                 failed_parks: list[str] | None = None) -> TrailCard:
    by_park: dict[str, list[ProcessedAlert]] = {p: [] for p in parks}
    for a in alerts:
        by_park.setdefault(a.park_code, []).append(a)
    failed = set(failed_parks or [])
    cps = [compose_park(p, park_names.get(p, p.upper()), by_park.get(p, [])) if p not in failed else
           CardPark(park_code=p, park_name=park_names.get(p, p.upper()), decision="caution",
                    headline="Check before you go — NPS alerts unavailable this week")
           for p in parks]
    models = sorted({a.model for a in alerts}) or ["none"]
    gen = generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    wk = week_of(date.fromisoformat(gen[:10]))
    return TrailCard(
        id=f"card_{wk}_{'-'.join(parks)}",
        generated_at=gen,
        week_of=wk,
        parks=cps,
        overall=worst(cp.decision for cp in cps),  # type: ignore[arg-type]
        workflow_id=workflow_id,
        model=", ".join(models),
    )
