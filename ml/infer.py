"""TrailTruth inference - one function the backend imports.

    import sys; sys.path.insert(0, REPO_ROOT)
    from ml.infer import classify, classify_batch
    verdict, latency_ms, model_name = classify(title, description)

Provider (env TRAILTRUTH_MODEL_PROVIDER):
  tinker     Tinker SamplingClient on the saved LoRA weights. Needs TINKER_API_KEY and
             TRAILTRUTH_TINKER_MODEL_PATH (defaults to ml/results/model_path.txt).
             TRAILTRUTH_TINKER_BASE_MODEL=<hf id> samples a base model instead (e.g. the teacher).
  openai     Any OpenAI-compatible server (Ollama / llama.cpp / vLLM): TRAILTRUTH_BASE_URL
             (e.g. http://localhost:11434/v1), TRAILTRUTH_MODEL, optional TRAILTRUTH_API_KEY.
  heuristic  Deterministic keyword rules, zero keys (dev/demo fallback; clearly labeled).
  (unset)    auto: tinker if a key + model path are available, else heuristic.

Errors talking to a provider raise (so Temporal activities retry). If a model returns invalid JSON
twice, we fall back to the heuristic verdict and say so in model_name.
Heavy deps (tinker, tinker_cookbook, transformers) are imported lazily, only for provider=tinker.
"""
from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from shared.schema import SYSTEM_PROMPT, TrailVerdict, user_prompt  # noqa: E402

LORA_MODEL_NAME = "qwen3.5-4b-trailtruth-lora"
_lock = threading.Lock()
_tinker_state: dict = {}


def _load_env() -> None:
    from ml.common import load_dotenv

    load_dotenv()


def _parse(text: str):
    from ml.common import parse_verdict

    return parse_verdict(text)


def _heuristic(title: str, description: str) -> TrailVerdict:
    from ml.weak_label import heuristic_verdict

    return heuristic_verdict(title, description)


def _provider() -> str:
    p = (os.environ.get("TRAILTRUTH_MODEL_PROVIDER") or "").strip().lower()
    if p:
        return p
    has_path = bool(os.environ.get("TRAILTRUTH_TINKER_MODEL_PATH")) or (_ROOT / "ml/results/model_path.txt").exists()
    return "tinker" if os.environ.get("TINKER_API_KEY") and has_path else "heuristic"


# ------------------------------------------------------------------------------------- tinker
def _tinker():
    with _lock:
        if _tinker_state:
            return _tinker_state
        if not os.environ.get("TINKER_API_KEY"):
            raise RuntimeError("provider=tinker but TINKER_API_KEY is not set")
        import tinker

        from ml.common import STUDENT_MODEL, make_renderer

        base = os.environ.get("TRAILTRUTH_TINKER_BASE_MODEL")
        service = tinker.ServiceClient()
        if base:
            sc = service.create_sampling_client(base_model=base)
            name, renderer_model = base.split("/")[-1], base
        else:
            path = os.environ.get("TRAILTRUTH_TINKER_MODEL_PATH")
            mp_file = _ROOT / "ml/results/model_path.txt"
            if not path and mp_file.exists():
                path = mp_file.read_text().strip()
            if not path:
                raise RuntimeError("provider=tinker needs TRAILTRUTH_TINKER_MODEL_PATH or ml/results/model_path.txt")
            sc = service.create_sampling_client(model_path=path)
            name, renderer_model = LORA_MODEL_NAME, STUDENT_MODEL
        _tok, renderer = make_renderer(renderer_model)
        _tinker_state.update(service=service, sc=sc, renderer=renderer, name=name, tinker=tinker)
        return _tinker_state


def _tinker_submit(title: str, description: str, temperature: float = 0.0):
    st = _tinker()
    renderer, tinker = st["renderer"], st["tinker"]
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_prompt(title, description)}]
    prompt = renderer.build_generation_prompt(msgs)
    params = tinker.SamplingParams(max_tokens=256, temperature=temperature, seed=0,
                                   stop=renderer.get_stop_sequences())
    return st["sc"].sample(prompt=prompt, num_samples=1, sampling_params=params)


def _tinker_text(future) -> str:
    st = _tinker()
    seq = future.result().sequences[0]
    msg, _ = st["renderer"].parse_response(list(seq.tokens))
    c = msg.get("content")
    return c if isinstance(c, str) else "".join(p.get("text", "") for p in (c or []) if isinstance(p, dict))


# ------------------------------------------------------------------------------------- openai
def _openai_text(title: str, description: str, temperature: float = 0.0) -> tuple[str, str]:
    import httpx

    base = os.environ.get("TRAILTRUTH_BASE_URL", "http://localhost:11434/v1").rstrip("/")
    model = os.environ.get("TRAILTRUTH_MODEL", "trailtruth")
    headers = {}
    if os.environ.get("TRAILTRUTH_API_KEY"):
        headers["Authorization"] = f"Bearer {os.environ['TRAILTRUTH_API_KEY']}"
    r = httpx.post(f"{base}/chat/completions", headers=headers, timeout=60, json={
        "model": model, "temperature": temperature, "max_tokens": 256,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                     {"role": "user", "content": user_prompt(title, description)}],
    })
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"] or "", model


# ------------------------------------------------------------------------------------- public
def classify(title: str, description: str) -> tuple[TrailVerdict, int, str]:
    """Classify one NPS alert -> (TrailVerdict, latency_ms, model_name)."""
    _load_env()
    provider = _provider()
    if provider == "tinker":
        _tinker()  # one-time client/tokenizer setup (~10-25 s cold) is not counted as model latency
    t0 = time.perf_counter()
    if provider == "heuristic":
        v = _heuristic(title, description)
        return v, int((time.perf_counter() - t0) * 1000), "heuristic"
    for attempt in range(2):
        temp = 0.0 if attempt == 0 else 0.7
        if provider == "tinker":
            text, name = _tinker_text(_tinker_submit(title, description, temp)), _tinker()["name"]
        elif provider == "openai":
            text, name = _openai_text(title, description, temp)
        else:
            raise ValueError(f"unknown TRAILTRUTH_MODEL_PROVIDER={provider!r} (tinker|openai|heuristic)")
        v, _err = _parse(text)
        if v is not None:
            return v, int((time.perf_counter() - t0) * 1000), name
    return _heuristic(title, description), int((time.perf_counter() - t0) * 1000), f"heuristic (fallback from {name})"


def classify_batch(items: list[tuple[str, str]], max_workers: int = 16) -> list[tuple[TrailVerdict, int, str]]:
    """Classify many alerts concurrently (Tinker requests are pipelined; others use a thread pool)."""
    _load_env()
    if _provider() == "tinker":
        st = _tinker()
        out = []
        t0 = time.perf_counter()
        futures = [_tinker_submit(t, d) for t, d in items]
        for (t, d), f in zip(items, futures):
            v, _ = _parse(_tinker_text(f))
            ms = int((time.perf_counter() - t0) * 1000)
            out.append((v, ms, st["name"]) if v is not None else classify(t, d))
        return out
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        return list(ex.map(lambda td: classify(*td), items))


if __name__ == "__main__":  # quick manual check: python ml/infer.py
    v, ms, name = classify(
        "Use Caution When Hiking Bluff Trail on Lookout Mountain",
        "Please exercise caution when hiking the section of Bluff Trail ... as a territorial barred owl may be present.",
    )
    print(name, ms, "ms", v.model_dump_json())
