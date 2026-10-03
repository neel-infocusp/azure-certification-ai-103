"""Check that the backend serves several chat requests at the same time.

It starts N conversations, sends one message in each, all at once, and compares

    wall time  = how long the whole batch took
    sum        = what the individual requests would take one after the other

If the backend really is async, the wall time is close to the slowest single request and
the overlap factor (sum / wall) approaches N. If something blocks the event loop, the
requests queue up and the factor stays near 1.

Run it while the backend is running (this calls the real model, so keep N small):

    python scripts/concurrency_check.py --n 3
    python scripts/concurrency_check.py --n 3 --stream
"""

import argparse
import asyncio
import sys
import time
from dataclasses import dataclass

import httpx

DEFAULT_MESSAGE = "In two sentences, what is the Turing test?"
# Below this the batch did not meaningfully overlap (a lone request would give 1.0).
MIN_OVERLAP_FACTOR = 1.5


@dataclass
class Result:
    index: int
    status: int | None  # None = no HTTP response (connection problem)
    seconds: float
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.status == 200


@dataclass
class Summary:
    requested: int
    succeeded: int
    wall_seconds: float
    sum_seconds: float
    overlap_factor: float
    overlapped: bool
    verdict: str


async def _one_request(
    client: httpx.AsyncClient, index: int, message: str, stream: bool
) -> Result:
    """One conversation: create a session, then time a single chat request."""
    try:
        session = await client.post("/api/sessions")
        session.raise_for_status()
        body = {"message": message, "session_id": session.json()["session_id"]}

        started = time.perf_counter()
        if stream:
            async with client.stream("POST", "/api/chat/stream", json=body) as response:
                text = "".join([chunk async for chunk in response.aiter_text()])
            status = response.status_code
            detail = "" if "event: completed" in text or status != 200 else "no completed event"
            if status == 200 and "event: error" in text:
                status, detail = 502, "error event in the stream"
        else:
            response = await client.post("/api/chat", json=body)
            status, detail = response.status_code, ""
        seconds = time.perf_counter() - started

        if status != 200 and not detail:
            error = response.json().get("error", {}) if not stream else {}
            detail = error.get("code", "") or f"HTTP {status}"
        return Result(index, status, seconds, detail)
    except httpx.HTTPError as exc:
        return Result(index, None, 0.0, f"{type(exc).__name__}: {exc}")


async def measure(
    client: httpx.AsyncClient, n: int, message: str = DEFAULT_MESSAGE, stream: bool = False
) -> tuple[list[Result], float]:
    """Send N chat requests at once. Returns the per-request results and the wall time."""
    started = time.perf_counter()
    results = await asyncio.gather(*(_one_request(client, i + 1, message, stream) for i in range(n)))
    return list(results), time.perf_counter() - started


def summarise(results: list[Result], wall_seconds: float) -> Summary:
    ok = [r for r in results if r.ok]
    sum_seconds = sum(r.seconds for r in ok)
    factor = sum_seconds / wall_seconds if wall_seconds > 0 else 0.0

    if len(ok) < 2:
        verdict = "INCONCLUSIVE: fewer than two requests succeeded (rate limit or errors?)."
        overlapped = False
    elif factor >= MIN_OVERLAP_FACTOR:
        verdict = f"OK: the requests overlapped (about {factor:.1f} at a time)."
        overlapped = True
    else:
        verdict = "PROBLEM: the requests were mostly served one after another."
        overlapped = False
    return Summary(len(results), len(ok), wall_seconds, sum_seconds, factor, overlapped, verdict)


def print_report(results: list[Result], summary: Summary) -> None:
    print(f"{'request':<9}{'status':<8}{'seconds':>8}  note")
    for r in results:
        status = "-" if r.status is None else str(r.status)
        print(f"{r.index:<9}{status:<8}{r.seconds:>8.2f}  {r.detail}")
    print()
    print(f"wall time (whole batch)           : {summary.wall_seconds:6.2f} s")
    print(f"sum of the individual requests    : {summary.sum_seconds:6.2f} s")
    print(f"overlap factor (sum / wall time)  : {summary.overlap_factor:6.2f}")
    print(f"succeeded                         : {summary.succeeded} of {summary.requested}")
    print(summary.verdict)


async def _run(args: argparse.Namespace) -> int:
    async with httpx.AsyncClient(base_url=args.base_url, timeout=args.timeout) as client:
        try:
            (await client.get("/api/health")).raise_for_status()
        except httpx.HTTPError:
            print(f"Cannot reach the backend at {args.base_url}. Is it running?", file=sys.stderr)
            return 2
        results, wall = await measure(client, args.n, args.message, args.stream)
    summary = summarise(results, wall)
    print_report(results, summary)
    return 0 if summary.overlapped else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--n", type=int, default=3, help="requests to send at once (default 3)")
    parser.add_argument("--base-url", default="http://localhost:8000", help="backend address")
    parser.add_argument("--message", default=DEFAULT_MESSAGE, help="message each request sends")
    parser.add_argument("--stream", action="store_true", help="use /api/chat/stream")
    parser.add_argument("--timeout", type=float, default=120.0, help="seconds per request")
    args = parser.parse_args(argv)
    if args.n < 2:
        parser.error("--n must be at least 2 to compare anything")
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
