import time
from typing import Any

from app.schemas import Usage


class Stopwatch:
    """Measures wall-clock time around a model call."""

    def __init__(self) -> None:
        self._start = time.perf_counter()

    def elapsed_ms(self) -> int:
        return round((time.perf_counter() - self._start) * 1000)


def normalise_responses_usage(usage: Any) -> Usage:
    """Map Responses API usage to our shared shape.

    Missing or unreported fields stay None so the UI can show a dash.
    """
    if usage is None:
        return Usage()
    input_details = getattr(usage, "input_tokens_details", None)
    output_details = getattr(usage, "output_tokens_details", None)
    return Usage(
        input_tokens=getattr(usage, "input_tokens", None),
        output_tokens=getattr(usage, "output_tokens", None),
        total_tokens=getattr(usage, "total_tokens", None),
        reasoning_tokens=getattr(output_details, "reasoning_tokens", None),
        cached_tokens=getattr(input_details, "cached_tokens", None),
    )
