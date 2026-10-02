import time
from typing import Any

from app.schemas import Usage


class Stopwatch:
    """Measures wall-clock time around a model call."""

    def __init__(self) -> None:
        self._start = time.perf_counter()

    def elapsed_ms(self) -> int:
        return round((time.perf_counter() - self._start) * 1000)


def normalise_chat_usage(usage: Any) -> Usage:
    """Map Chat Completions usage (prompt/completion tokens) to our shared shape.

    Missing or unreported fields stay None so the UI can show a dash.
    """
    if usage is None:
        return Usage()
    prompt_details = getattr(usage, "prompt_tokens_details", None)
    completion_details = getattr(usage, "completion_tokens_details", None)
    return Usage(
        input_tokens=getattr(usage, "prompt_tokens", None),
        output_tokens=getattr(usage, "completion_tokens", None),
        total_tokens=getattr(usage, "total_tokens", None),
        reasoning_tokens=getattr(completion_details, "reasoning_tokens", None),
        cached_tokens=getattr(prompt_details, "cached_tokens", None),
    )
