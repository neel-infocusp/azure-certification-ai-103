from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.services.llm_service import LlmService, get_llm_service


def make_completion(
    text: str = "Hello from the fake model.",
    finish_reason: str = "stop",
    usage: Any = "default",
) -> SimpleNamespace:
    if usage == "default":
        usage = SimpleNamespace(
            prompt_tokens=38,
            completion_tokens=410,
            total_tokens=448,
            prompt_tokens_details=SimpleNamespace(cached_tokens=0),
            completion_tokens_details=SimpleNamespace(reasoning_tokens=64),
        )
    return SimpleNamespace(
        id="chatcmpl-test",
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=text), finish_reason=finish_reason
            )
        ],
        usage=usage,
    )


class FakeCompletions:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.result: Any = make_completion()
        self.error: Exception | None = None

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.result


class FakeClient:
    def __init__(self) -> None:
        self.completions = FakeCompletions()
        self.chat = SimpleNamespace(completions=self.completions)


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
def client(settings: Settings, fake_client: FakeClient) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_llm_service] = lambda: LlmService(fake_client, settings)
    return TestClient(app)
