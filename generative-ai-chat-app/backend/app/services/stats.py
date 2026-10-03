import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from fastapi import Request


@dataclass
class Call:
    """Handle for one tracked model call. Set `succeeded` once the answer is complete."""

    succeeded: bool = False


class StatsCounter:
    """Counts model calls: how many are running now, how many finished, how long they took.

    Only ever touched from the event loop thread, so plain integers are safe (no lock).
    Averages cover successful calls only, so a stopped or failed call does not skew them.
    """

    def __init__(self) -> None:
        self.in_flight = 0
        self.total_requests = 0
        self._successes = 0
        self._latency_total_ms = 0.0

    @contextmanager
    def track(self) -> Iterator[Call]:
        call = Call()
        started = time.perf_counter()
        self.in_flight += 1
        try:
            yield call
        finally:
            self.in_flight -= 1
            self.total_requests += 1
            if call.succeeded:
                self._successes += 1
                self._latency_total_ms += (time.perf_counter() - started) * 1000

    @property
    def avg_latency_ms(self) -> int | None:
        if self._successes == 0:
            return None
        return round(self._latency_total_ms / self._successes)


def get_stats(request: Request) -> StatsCounter:
    """FastAPI dependency: the one counter shared by the whole app."""
    return request.app.state.stats
