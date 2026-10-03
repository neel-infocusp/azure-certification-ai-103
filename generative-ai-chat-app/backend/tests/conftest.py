import copy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.services.llm_service import LlmService, get_llm_service
from app.services.session_store import SessionStore, get_session_store


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
    """Fake `client.responses.input_items`."""

    def __init__(self) -> None:
        self.requested: list[str] = []
        self.items: list[dict[str, Any]] = [{"type": "message", "role": "user"}]
        self.error: Exception | None = None

    def list(self, response_id: str) -> Any:
        self.requested.append(response_id)
        if self.error:
            raise self.error
        data = [SimpleNamespace(model_dump=lambda mode="python", i=i: i) for i in self.items]
        return SimpleNamespace(data=data)


class FakeResponses:
    """Fake `client.responses`: every call returns a copy of `result` with a fresh id."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.result: Any = make_response()
        self.error: Exception | None = None
        self.input_items = FakeInputItems()

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        response = copy.copy(self.result)
        response.id = f"resp_{len(self.calls)}"
        return response


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
def client(settings: Settings, fake_client: FakeClient, store: SessionStore) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_llm_service] = lambda: LlmService(fake_client, settings)
    app.dependency_overrides[get_session_store] = lambda: store
    return TestClient(app)


@pytest.fixture
def session_id(client: TestClient) -> str:
    return client.post("/api/sessions").json()["session_id"]
