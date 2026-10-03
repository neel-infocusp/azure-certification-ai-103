import asyncio
import inspect
import logging
import time
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import Auth
from app.config import Settings, get_settings
from app.main import create_app
from app.routers import chat, sessions
from app.services.llm_service import LlmService
from app.services.stats import StatsCounter
from tests.conftest import FakeClient

DELAY = 0.3  # seconds each fake model call takes


@pytest.fixture
async def aclient(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    """An HTTP client that talks to the app on the test's own event loop (so calls overlap)."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def new_session(aclient: httpx.AsyncClient) -> str:
    return (await aclient.post("/api/sessions")).json()["session_id"]


# ---------- everything is async ----------


@pytest.mark.parametrize(
    "handler",
    [
        chat.chat,
        chat.chat_stream,
        sessions.create_session,
        sessions.delete_session,
        sessions.get_memory,
    ],
)
def test_route_handlers_are_coroutines(handler: Any) -> None:
    assert inspect.iscoroutinefunction(handler)


def test_the_service_talks_to_the_model_with_await() -> None:
    assert inspect.iscoroutinefunction(LlmService.chat)
    assert inspect.isasyncgenfunction(LlmService.stream_chat)
    assert inspect.iscoroutinefunction(LlmService.list_input_items)


# ---------- lifespan: create at startup, close at shutdown ----------


class FakeAsyncOpenAI:
    instances: list["FakeAsyncOpenAI"] = []

    def __init__(self, base_url: str, api_key: Any) -> None:
        self.base_url = base_url
        self.api_key = api_key
        self.close_calls = 0
        FakeAsyncOpenAI.instances.append(self)

    async def close(self) -> None:
        self.close_calls += 1


class FakeAuth(Auth):
    def __init__(self) -> None:
        super().__init__(api_key="token-provider")
        self.close_calls = 0

    async def close(self) -> None:
        self.close_calls += 1


@pytest.fixture
def lifecycle(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    """Start the real lifespan with a fake client and fake sign-in, and record what happens."""
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://my-resource.openai.azure.com/openai/v1/")
    monkeypatch.setenv("MODEL_DEPLOYMENT", "gpt-test")
    monkeypatch.delenv("AZURE_OPENAI_API_KEY", raising=False)
    get_settings.cache_clear()

    auth = FakeAuth()
    FakeAsyncOpenAI.instances.clear()
    monkeypatch.setattr("app.main.build_auth", lambda settings: auth)
    monkeypatch.setattr("app.main.AsyncOpenAI", FakeAsyncOpenAI)
    yield SimpleNamespace(auth=auth, clients=FakeAsyncOpenAI.instances)
    get_settings.cache_clear()


def test_startup_creates_one_client_and_shutdown_closes_everything(
    lifecycle: SimpleNamespace,
) -> None:
    app = create_app()

    with TestClient(app):
        assert len(lifecycle.clients) == 1
        client = lifecycle.clients[0]
        assert client.base_url == "https://my-resource.openai.azure.com/openai/v1/"
        assert client.api_key == "token-provider"
        assert isinstance(app.state.llm, LlmService)
        # still open while the app is serving requests
        assert client.close_calls == 0
        assert lifecycle.auth.close_calls == 0

    assert lifecycle.clients[0].close_calls == 1
    assert lifecycle.auth.close_calls == 1


def test_shutdown_closes_the_sign_in_even_if_closing_the_client_fails(
    lifecycle: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    class BrokenClient(FakeAsyncOpenAI):
        async def close(self) -> None:
            raise RuntimeError("close failed")

    monkeypatch.setattr("app.main.AsyncOpenAI", BrokenClient)

    with pytest.raises(RuntimeError, match="close failed"):
        with TestClient(create_app()):
            pass

    # The failure is surfaced, and the sign-in was still closed.
    assert lifecycle.auth.close_calls == 1


def test_missing_configuration_stops_the_app_with_a_clear_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("AZURE_OPENAI_ENDPOINT", raising=False)
    monkeypatch.delenv("MODEL_DEPLOYMENT", raising=False)
    # Ignore any real backend/.env so the settings are genuinely incomplete.
    monkeypatch.setattr("app.main.get_settings", lambda: Settings(_env_file=None))

    with pytest.raises(RuntimeError, match="Missing configuration: AZURE_OPENAI_ENDPOINT"):
        with TestClient(create_app()):
            pass


def test_shutdown_is_logged(lifecycle: SimpleNamespace, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="app.main"):
        with TestClient(create_app()):
            pass

    assert any("closing the model client" in record.message for record in caplog.records)


# ---------- stats ----------


def test_stats_start_at_zero(client: TestClient) -> None:
    assert client.get("/api/stats").json() == {
        "in_flight": 0,
        "total_requests": 0,
        "avg_latency_ms": None,
    }


def test_stats_count_finished_chat_and_stream_requests(
    client: TestClient, session_id: str
) -> None:
    client.post("/api/chat", json={"message": "one", "session_id": session_id})
    client.post("/api/chat/stream", json={"message": "two", "session_id": session_id})

    body = client.get("/api/stats").json()

    assert body["in_flight"] == 0
    assert body["total_requests"] == 2
    assert body["avg_latency_ms"] >= 0


def test_failed_requests_are_counted_but_not_averaged(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    fake_client.responses.error = RuntimeError("boom")
    client.post("/api/chat", json={"message": "will fail", "session_id": session_id})

    body = client.get("/api/stats").json()

    assert body["total_requests"] == 1
    assert body["in_flight"] == 0
    assert body["avg_latency_ms"] is None


def test_stats_counter_tracks_success_and_failure() -> None:
    counter = StatsCounter()

    with counter.track() as call:
        assert counter.in_flight == 1
        call.succeeded = True
    with pytest.raises(ValueError):
        with counter.track():
            raise ValueError("fails")

    assert (counter.in_flight, counter.total_requests) == (0, 2)
    assert counter.avg_latency_ms is not None


# ---------- real concurrency ----------


@pytest.mark.anyio
async def test_in_flight_rises_while_requests_run_and_falls_afterwards(
    aclient: httpx.AsyncClient, fake_client: FakeClient
) -> None:
    fake_client.responses.delay = DELAY
    ids = [await new_session(aclient) for _ in range(2)]

    async def ask(session_id: str) -> int:
        return (await aclient.post("/api/chat", json={"message": "hi", "session_id": session_id})).status_code

    tasks = [asyncio.create_task(ask(sid)) for sid in ids]
    await asyncio.sleep(DELAY / 3)  # both are waiting on the model now
    busy = (await aclient.get("/api/stats")).json()
    statuses = await asyncio.gather(*tasks)
    idle = (await aclient.get("/api/stats")).json()

    assert statuses == [200, 200]
    assert busy["in_flight"] == 2
    assert idle["in_flight"] == 0
    assert idle["total_requests"] == 2


@pytest.mark.anyio
async def test_requests_overlap_instead_of_queueing(
    aclient: httpx.AsyncClient, fake_client: FakeClient
) -> None:
    """Three calls of 0.3 s each finish in about 0.3 s, not 0.9 s, so nothing blocks the loop."""
    fake_client.responses.delay = DELAY
    ids = [await new_session(aclient) for _ in range(3)]

    started = time.perf_counter()
    responses = await asyncio.gather(
        *(aclient.post("/api/chat", json={"message": "hi", "session_id": sid}) for sid in ids)
    )
    elapsed = time.perf_counter() - started

    assert [r.status_code for r in responses] == [200, 200, 200]
    assert elapsed < DELAY * 2  # sequential would be at least DELAY * 3


@pytest.mark.anyio
async def test_streams_overlap_too(aclient: httpx.AsyncClient, fake_client: FakeClient) -> None:
    fake_client.responses.delay = 0.1  # 4 events per stream, so ~0.4 s each
    ids = [await new_session(aclient) for _ in range(3)]

    async def stream(session_id: str) -> str:
        response = await aclient.post(
            "/api/chat/stream", json={"message": "hi", "session_id": session_id}
        )
        return response.text

    started = time.perf_counter()
    bodies = await asyncio.gather(*(stream(sid) for sid in ids))
    elapsed = time.perf_counter() - started

    assert all("event: completed" in body for body in bodies)
    assert elapsed < 0.4 * 2  # sequential would be at least 1.2 s


@pytest.mark.anyio
async def test_other_requests_are_served_while_a_slow_answer_is_pending(
    aclient: httpx.AsyncClient, fake_client: FakeClient
) -> None:
    fake_client.responses.delay = 0.5
    sid = await new_session(aclient)
    slow = asyncio.create_task(aclient.post("/api/chat", json={"message": "hi", "session_id": sid}))
    await asyncio.sleep(0.05)

    started = time.perf_counter()
    health = await aclient.get("/api/health")
    fast = time.perf_counter() - started
    await slow

    assert health.status_code == 200
    assert fast < 0.25  # answered long before the slow model call finished
