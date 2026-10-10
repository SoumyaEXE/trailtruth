"""Model dispatch: ml.infer.classify (tinker / openai providers) with a heuristic fallback.

Contract: classify(title, description) -> (TrailVerdict, latency_ms, model_name).
Every call is wrapped in a Sentry gen_ai span (no-op without SENTRY_DSN).
"""
from __future__ import annotations

import logging
import os

from agent import heuristic
from agent.telemetry import model_span
from shared.schema import ProcessedAlert, TrailVerdict

log = logging.getLogger("trailtruth.model")

_ml_classify = None
_ml_error: str | None = None


def _tinker_model_path() -> str | None:
    from agent.config import ROOT

    p = os.environ.get("TRAILTRUTH_TINKER_MODEL_PATH")
    f = ROOT / "ml" / "results" / "model_path.txt"
    if not p and f.exists():
        p = f.read_text(encoding="utf-8").strip()
    return p or None


def provider() -> str:
    """Explicit TRAILTRUTH_MODEL_PROVIDER wins; otherwise tinker if TINKER_API_KEY + a LoRA path exist."""
    p = (os.environ.get("TRAILTRUTH_MODEL_PROVIDER") or "").strip().lower()
    if p:
        return p
    return "tinker" if os.environ.get("TINKER_API_KEY") and _tinker_model_path() else "heuristic"


def describe() -> dict:
    """For /api/health and worker logs. Never includes keys; the tinker:// path is shortened."""
    prov = provider()
    out = {"provider": prov, "explicit": bool(os.environ.get("TRAILTRUTH_MODEL_PROVIDER"))}
    if prov == "tinker":
        mp = _tinker_model_path() or ""
        out["model"] = "qwen3.5-4b-trailtruth-lora"
        out["model_path"] = (mp[:16] + "…" + mp[-12:]) if len(mp) > 32 else mp
        out["ml_infer"] = _load_ml() is not None
        if _ml_error:
            out["ml_infer_error"] = _ml_error[:200]
    elif prov == "openai":
        out["model"] = os.environ.get("TRAILTRUTH_MODEL", "trailtruth")
    else:
        out["model"] = heuristic.MODEL_NAME
    return out


def warmup() -> float:
    """Pay the Tinker cold start (client + tokenizer, 10-25 s) once, up front."""
    import time as _t

    t0 = _t.perf_counter()
    if provider() == "tinker" and _load_ml() is not None:
        from ml import infer

        infer._load_env()
        infer._tinker()
    return _t.perf_counter() - t0


def classify_batch(items: list[tuple[str, str]]) -> list[tuple[TrailVerdict, int, str]]:
    if provider() != "heuristic" and _load_ml() is not None:
        from ml.infer import classify_batch as ml_batch

        return ml_batch(items)
    return [heuristic.classify(t, d) for t, d in items]


def _load_ml():
    global _ml_classify, _ml_error
    if _ml_classify is not None or _ml_error is not None:
        return _ml_classify
    try:
        from ml.infer import classify as ml_classify  # provided by the ML agent

        _ml_classify = ml_classify
    except Exception as e:  # missing module, missing deps, missing keys...
        _ml_error = f"{type(e).__name__}: {e}"
        log.warning("ml.infer unavailable (%s) - using heuristic provider", _ml_error)
    return _ml_classify


def classify(title: str, description: str) -> tuple[TrailVerdict, int, str]:
    fn = heuristic.classify if provider() == "heuristic" else (_load_ml() or heuristic.classify)
    name_guess = heuristic.MODEL_NAME if fn is heuristic.classify else describe().get("model", provider())
    with model_span(name_guess, provider(), title, description) as span:
        verdict, latency_ms, model_name = fn(title, description)
        if not isinstance(verdict, TrailVerdict):  # tolerate dict returns
            verdict = TrailVerdict.model_validate(verdict)
        span.finish_with(model_name, latency_ms, verdict.model_dump_json())
    return verdict, int(latency_ms), model_name


def to_processed(raw: dict, verdict: TrailVerdict, latency_ms: int, model_name: str,
                 park_names: dict[str, str]) -> ProcessedAlert:
    park = (raw.get("parkCode") or "").split(",")[0].strip().lower()
    return ProcessedAlert(
        id=raw["id"],
        park_code=park,
        park_name=park_names.get(park, park.upper()),
        title=(raw.get("title") or "").strip(),
        description=(raw.get("description") or "").strip(),
        url=raw.get("url") or "",
        nps_category=raw.get("category") or "Information",
        last_indexed=(raw.get("lastIndexedDate") or "")[:10],
        verdict=verdict,
        model=model_name,
        latency_ms=int(latency_ms),
    )
