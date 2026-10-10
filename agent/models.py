"""Activity / workflow I/O types (pydantic, serialized by temporalio.contrib.pydantic)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from shared.schema import ProcessedAlert, TrailCard

StepStatus = Literal["pending", "running", "retrying", "completed", "failed"]


class FetchResult(BaseModel):
    park: str
    park_name: str
    alerts: list[dict[str, Any]]
    source: str            # cache | nps-live | stale-cache (...) | snapshot (NPS 429 ...)
    attempt: int = 1


class ClassifyInput(BaseModel):
    workflow_id: str
    alert: dict[str, Any]
    park_name: str


class ClassifyResult(BaseModel):
    alert: ProcessedAlert
    attempt: int = 1
    fallback: bool = False  # true when the model kept failing and the heuristic answered


class ComposeInput(BaseModel):
    parks: list[str]
    park_names: dict[str, str]
    alerts: list[ProcessedAlert]
    workflow_id: str
    generated_at: str
    failed_parks: list[str] = Field(default_factory=list)


class PublishResult(BaseModel):
    card_id: str
    path: str
    attempt: int = 1


class Step(BaseModel):
    name: str
    status: StepStatus = "pending"
    attempt: int = 0
    started_at: str | None = None
    ended_at: str | None = None
    error: str | None = None
    detail: str | None = None   # e.g. "source=nps-live" / "7/12 alerts"


class Progress(BaseModel):
    workflow_id: str
    parks: list[str]
    status: str = "running"
    started_at: str
    steps: list[Step] = Field(default_factory=list)
    card: TrailCard | None = None
