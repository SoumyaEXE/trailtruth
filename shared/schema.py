"""Canonical TrailTruth schema. Mirror any change in web/lib/types.ts."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

HazardType = Literal[
    "closure", "wildlife", "weather", "fire", "water", "geologic",
    "construction", "air_quality", "road", "facility", "other",
]
Decision = Literal["go", "caution", "no_go"]
NpsCategory = Literal["Danger", "Caution", "Park Closure", "Information"]

CATEGORY_TO_DECISION: dict[str, Decision] = {
    "Information": "go",
    "Caution": "caution",
    "Danger": "no_go",
    "Park Closure": "no_go",
}


class TrailVerdict(BaseModel):
    hazard_type: HazardType
    severity: int = Field(ge=1, le=3)
    trails_affected: list[str] = Field(default_factory=list)
    is_closed: bool
    decision: Decision
    reason: str = Field(max_length=200)


class ProcessedAlert(BaseModel):
    id: str
    park_code: str
    park_name: str = ""
    title: str
    description: str
    url: str = ""
    nps_category: str
    last_indexed: str = ""
    verdict: TrailVerdict
    model: str
    latency_ms: int = 0


class CardPark(BaseModel):
    park_code: str
    park_name: str
    decision: Decision
    headline: str
    closed_trails: list[str] = Field(default_factory=list)
    watch_for: list[str] = Field(default_factory=list)
    alert_ids: list[str] = Field(default_factory=list)


class TrailCard(BaseModel):
    id: str
    generated_at: str
    week_of: str
    parks: list[CardPark]
    overall: Decision
    workflow_id: str
    model: str


SYSTEM_PROMPT = (
    "You are TrailTruth. Read one U.S. National Park Service alert and reply with ONLY a JSON object, "
    "no prose, with keys: hazard_type (one of closure, wildlife, weather, fire, water, geologic, construction, "
    "air_quality, road, facility, other), severity (1 info, 2 caution, 3 danger), trails_affected (list of trail "
    "or area names, may be empty), is_closed (true if any trail/area/road is closed), decision (go, caution, no_go "
    "for a hiker planning a visit to the affected area), reason (<= 20 words)."
)


def user_prompt(title: str, description: str) -> str:
    return f"ALERT TITLE: {title}\nALERT TEXT: {description}"
