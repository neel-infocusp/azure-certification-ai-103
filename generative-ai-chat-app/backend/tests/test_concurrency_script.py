from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI

from scripts.concurrency_check import Result, main, measure, summarise
from tests.conftest import FakeClient


@pytest.fixture
async def aclient(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


def test_summary_of_overlapping_requests() -> None:
    results = [Result(i, 200, 1.0) for i in range(1, 4)]

    summary = summarise(results, wall_seconds=1.1)

    assert summary.succeeded == 3
    assert summary.sum_seconds == pytest.approx(3.0)
    assert summary.overlap_factor == pytest.approx(3.0 / 1.1)
    assert summary.overlapped is True
    assert summary.verdict.startswith("OK")


def test_summary_of_requests_served_one_after_another() -> None:
    results = [Result(i, 200, 1.0) for i in range(1, 4)]

    summary = summarise(results, wall_seconds=3.1)

    assert summary.overlapped is False
    assert summary.verdict.startswith("PROBLEM")


def test_summary_is_inconclusive_when_requests_fail() -> None:
    results = [Result(1, 200, 1.0), Result(2, 429, 0.2, "rate_limited"), Result(3, None, 0.0, "x")]

    summary = summarise(results, wall_seconds=1.0)

    assert summary.succeeded == 1
    assert summary.overlapped is False
    assert summary.verdict.startswith("INCONCLUSIVE")


@pytest.mark.anyio
async def test_measure_against_the_app_shows_overlap(
    aclient: httpx.AsyncClient, fake_client: FakeClient
) -> None:
    fake_client.responses.delay = 0.3

    results, wall = await measure(aclient, n=3)
    summary = summarise(results, wall)

    assert [r.status for r in results] == [200, 200, 200]
    assert summary.overlapped is True
    assert wall < 0.3 * 2


@pytest.mark.anyio
async def test_measure_with_streaming(aclient: httpx.AsyncClient, fake_client: FakeClient) -> None:
    fake_client.responses.delay = 0.1

    results, wall = await measure(aclient, n=3, stream=True)

    assert [r.status for r in results] == [200, 200, 200]
    assert summarise(results, wall).overlapped is True


@pytest.mark.anyio
async def test_measure_reports_model_errors(
    aclient: httpx.AsyncClient, fake_client: FakeClient
) -> None:
    fake_client.responses.error = RuntimeError("boom")

    results, wall = await measure(aclient, n=2)

    assert [r.status for r in results] == [502, 502]
    assert results[0].detail == "upstream_error"
    assert summarise(results, wall).verdict.startswith("INCONCLUSIVE")


def test_script_exits_with_2_when_the_backend_is_down(capsys: pytest.CaptureFixture[str]) -> None:
    code = main(["--n", "2", "--base-url", "http://127.0.0.1:9", "--timeout", "2"])

    assert code == 2
    assert "Cannot reach the backend" in capsys.readouterr().err
