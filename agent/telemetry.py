"""Optional Sentry AI-agent tracing. Everything here is a no-op unless SENTRY_DSN is set.

Span conventions follow Sentry's AI Agent Monitoring (sentry_sdk.consts.OP / SPANDATA):
  gen_ai.invoke_agent  "invoke_agent TrailTruth"   - one per classify_alert activity attempt
  gen_ai.chat          "chat <model>"              - one per model call (model, tokens, latency, cost)
  gen_ai.execute_tool  "execute_tool fetch_alerts" - NPS fetches
"""
from __future__ import annotations

import contextlib
import os
import time

from shared.schema import SYSTEM_PROMPT, user_prompt

_enabled = False

# USD per 1M tokens (input, output), rough public list prices; heuristic is free.
PRICES = {
    "heuristic": (0.0, 0.0),
    "tinker": (0.04, 0.12),
    "openai": (0.0, 0.0),  # local Ollama / llama.cpp
}


def init_sentry(component: str) -> bool:
    global _enabled
    dsn = os.environ.get("SENTRY_DSN")
    if not dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "1.0")),
        send_default_pii=False,
        environment=os.environ.get("SENTRY_ENVIRONMENT", "dev"),
        release=os.environ.get("SENTRY_RELEASE", "trailtruth@0.1.0"),
        server_name=f"trailtruth-{component}",
    )
    sentry_sdk.set_tag("component", component)
    _enabled = True
    return True


def _tokens(text: str) -> int:
    return max(1, len(text) // 4)  # cheap estimate; real providers can override via span.finish_with


class _NullSpan:
    def finish_with(self, *a, **k):
        pass


class _ModelSpan:
    def __init__(self, span, provider: str, prompt: str):
        self.span, self.provider, self.prompt = span, provider, prompt

    def finish_with(self, model_name: str, latency_ms: int, output: str,
                    input_tokens: int | None = None, output_tokens: int | None = None):
        from sentry_sdk.consts import SPANDATA

        it = input_tokens or _tokens(self.prompt)
        ot = output_tokens or _tokens(output)
        pin, pout = PRICES.get(self.provider, (0.0, 0.0))
        cost = (it * pin + ot * pout) / 1_000_000
        s = self.span
        s.set_data(SPANDATA.GEN_AI_RESPONSE_MODEL, model_name)
        s.set_data(SPANDATA.GEN_AI_USAGE_INPUT_TOKENS, it)
        s.set_data(SPANDATA.GEN_AI_USAGE_OUTPUT_TOKENS, ot)
        s.set_data(SPANDATA.GEN_AI_USAGE_TOTAL_TOKENS, it + ot)
        s.set_data(SPANDATA.GEN_AI_RESPONSE_TEXT, output[:2000])
        s.set_data("trailtruth.model_latency_ms", int(latency_ms))
        s.set_data("trailtruth.cost_usd", round(cost, 8))


@contextlib.contextmanager
def model_span(model: str, provider: str, title: str, description: str):
    if not _enabled:
        yield _NullSpan()
        return
    import sentry_sdk
    from sentry_sdk.consts import OP, SPANDATA

    prompt = SYSTEM_PROMPT + "\n" + user_prompt(title, description)
    outer = contextlib.nullcontext()
    if sentry_sdk.get_current_span() is None:  # activity thread with no transaction yet
        outer = sentry_sdk.start_transaction(op=OP.GEN_AI_INVOKE_AGENT, name="invoke_agent TrailTruth")
    with outer as tx:
        if tx is not None:
            tx.set_data(SPANDATA.GEN_AI_AGENT_NAME, "TrailTruth")
            tx.set_data(SPANDATA.GEN_AI_OPERATION_NAME, "invoke_agent")
        with sentry_sdk.start_span(op=OP.GEN_AI_CHAT, name=f"chat {model}") as span:
            span.set_data(SPANDATA.GEN_AI_OPERATION_NAME, "chat")
            span.set_data(SPANDATA.GEN_AI_REQUEST_MODEL, model)
            span.set_data(SPANDATA.GEN_AI_PROVIDER_NAME, provider)
            span.set_data(SPANDATA.GEN_AI_REQUEST_MESSAGES,
                          [{"role": "system", "content": SYSTEM_PROMPT},
                           {"role": "user", "content": user_prompt(title, description)[:2000]}])
            t0 = time.perf_counter()
            ms = _ModelSpan(span, provider, prompt)
            yield ms
            span.set_data("trailtruth.wall_ms", int((time.perf_counter() - t0) * 1000))


@contextlib.contextmanager
def activity_span(op_name: str, name: str, **data):
    """Transaction per activity attempt (gen_ai.invoke_agent / gen_ai.execute_tool)."""
    if not _enabled:
        yield None
        return
    import sentry_sdk
    from sentry_sdk.consts import SPANDATA

    with sentry_sdk.start_transaction(op=op_name, name=name) as tx:
        tx.set_data(SPANDATA.GEN_AI_AGENT_NAME, "TrailTruth")
        for k, v in data.items():
            tx.set_data(k, v)
        yield tx
