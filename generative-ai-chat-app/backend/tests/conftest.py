import asyncio
import copy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.services.llm_service import LlmService, get_llm_service
from app.services.session_store import SessionStore, get_session_store


@pytest.fixture
def anyio_backend() -> str:
    """Run `@pytest.mark.anyio` tests on asyncio only (trio is not installed)."""
    return "asyncio"


class FakeResponse:
    """Mimics the parts of an SDK Response object that our code reads."""

    def __init__(
        self,
        output_text: str,
        status: str,
        usage: Any,
        error: Any = None,
    ) -> None:
        self.id = "resp_test"
        self.output_text = output_text
        self.status = status
        self.usage = usage
        self.error = error

    def model_dump(self, mode: str = "python") -> dict[str, Any]:
        return {"id": self.id, "status": self.status, "output_text": self.output_text}


def make_response(
    text: str = "Hello from the fake model.",
    status: str = "completed",
    usage: Any = "default",
    error: Any = None,
) -> FakeResponse:
    if usage == "default":
        usage = SimpleNamespace(
            input_tokens=38,
            output_tokens=410,
            total_tokens=448,
            input_tokens_details=SimpleNamespace(cached_tokens=0),
            output_tokens_details=SimpleNamespace(reasoning_tokens=64),
        )
    return FakeResponse(text, status, usage, error)


class FakeInputItems:
    """Fake `client.responses.input_items` (awaitable, like the async SDK)."""

    def __init__(self) -> None:
        self.requested: list[str] = []
        self.items: list[dict[str, Any]] = [{"type": "message", "role": "user"}]
        self.error: Exception | None = None

    async def list(self, response_id: str) -> Any:
        self.requested.append(response_id)
        if self.error:
            raise self.error
        data = [SimpleNamespace(model_dump=lambda mode="python", i=i: i) for i in self.items]
        return SimpleNamespace(data=data)


def delta_event(text: str) -> SimpleNamespace:
    return SimpleNamespace(type="response.output_text.delta", delta=text)


def completed_event(response: Any) -> SimpleNamespace:
    return SimpleNamespace(type="response.completed", response=response)


class FakeStream:
    """Fake async upstream stream.

    Iterates over `items` with `async for`; an Exception item is raised when reached.
    `delay` seconds pass before each item, so tests can make a stream slow.
    """

    def __init__(self, items: list[Any], delay: float = 0.0) -> None:
        self._items = items
        self._delay = delay
        self.closed = False

    def __aiter__(self) -> Any:
        return self._iterate()

    async def _iterate(self) -> Any:
        for item in self._items:
            if self._delay:
                await asyncio.sleep(self._delay)
            if isinstance(item, Exception):
                raise item
            yield item

    async def close(self) -> None:
        self.closed = True


class FakeResponses:
    """Fake `client.responses`: every call returns a copy of `result` with a fresh id.

    With stream=True it returns a FakeStream. By default that streams the text of `result`
    in two chunks and then a completed event; set `stream_script` to script it yourself
    (the script may use the placeholder string "FINAL" for the completed event).
    `delay` makes each call (or each streamed item) take that many seconds.
    """

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.result: Any = make_response()
        self.error: Exception | None = None
        self.input_items = FakeInputItems()
        self.stream_script: list[Any] | None = None
        self.streams: list[FakeStream] = []
        self.delay = 0.0

    def _fresh(self) -> Any:
        response = copy.copy(self.result)
        response.id = f"resp_{len(self.calls)}"
        return response

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        response = self._fresh()
        if not kwargs.get("stream"):
            if self.delay:
                await asyncio.sleep(self.delay)
            return response

        if self.stream_script is None:
            text = response.output_text
            half = len(text) // 2
            script: list[Any] = [
                SimpleNamespace(type="response.created", response=response),
                delta_event(text[:half]),
                delta_event(text[half:]),
                "FINAL",
            ]
        else:
            script = list(self.stream_script)
        items = [completed_event(response) if item == "FINAL" else item for item in script]
        stream = FakeStream(items, delay=self.delay)
        self.streams.append(stream)
        return stream


class FakeClient:
    def __init__(self) -> None:
        self.responses = FakeResponses()


@pytest.fixture
def settings() -> Settings:
    return Settings(
        azure_openai_endpoint="https://my-resource.openai.azure.com/openai/v1/",
        model_deployment="gpt-test",
        system_prompt="Test system prompt.",
        _env_file=None,
    )


@pytest.fixture
def fake_client() -> FakeClient:
    return FakeClient()


@pytest.fixture
def store() -> SessionStore:
    return SessionStore()


@pytest.fixture
def app(settings: Settings, fake_client: FakeClient, store: SessionStore) -> FastAPI:
    """The real app, with the model client and session store replaced by fakes."""
    application = create_app()
    application.dependency_overrides[get_settings] = lambda: settings
    application.dependency_overrides[get_llm_service] = lambda: LlmService(fake_client, settings)  # type: ignore[arg-type]
    application.dependency_overrides[get_session_store] = lambda: store
    return application


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture
def session_id(client: TestClient) -> str:
    return client.post("/api/sessions").json()["session_id"]
