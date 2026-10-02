import httpx
import openai
import pytest
from azure.core.exceptions import ClientAuthenticationError
from fastapi.testclient import TestClient

from tests.conftest import FakeClient, make_completion


def _status_error(cls: type[openai.APIStatusError], status: int) -> openai.APIStatusError:
    request = httpx.Request("POST", "https://example.test/chat")
    response = httpx.Response(status, request=request)
    return cls("upstream said no", response=response, body=None)


def test_chat_returns_reply_and_inspector(client: TestClient, fake_client: FakeClient) -> None:
    response = client.post("/api/chat", json={"message": "Tell me about the ELIZA chatbot."})

    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Hello from the fake model."

    inspector = body["inspector"]
    assert inspector["api"] == "chat.completions"
    assert inspector["request"]["model"] == "gpt-test"
    assert inspector["request"]["messages"] == [
        {"role": "system", "content": "Test system prompt."},
        {"role": "user", "content": "Tell me about the ELIZA chatbot."},
    ]
    assert inspector["response"] == {"id": "chatcmpl-test", "finish_reason": "stop"}
    assert inspector["usage"] == {
        "input_tokens": 38,
        "output_tokens": 410,
        "total_tokens": 448,
        "reasoning_tokens": 64,
        "cached_tokens": 0,
    }
    assert inspector["metrics"]["latency_ms"] >= 0
    assert inspector["memory"] == {"mode": "none"}


def test_each_call_is_stateless(client: TestClient, fake_client: FakeClient) -> None:
    client.post("/api/chat", json={"message": "first"})
    client.post("/api/chat", json={"message": "second"})

    second_messages = fake_client.completions.calls[1]["messages"]
    assert [m["role"] for m in second_messages] == ["system", "user"]
    assert second_messages[1]["content"] == "second"


def test_missing_usage_details_become_null(client: TestClient, fake_client: FakeClient) -> None:
    fake_client.completions.result = make_completion(usage=None)

    body = client.post("/api/chat", json={"message": "hi"}).json()

    assert body["inspector"]["usage"] == {
        "input_tokens": None,
        "output_tokens": None,
        "total_tokens": None,
        "reasoning_tokens": None,
        "cached_tokens": None,
    }


@pytest.mark.parametrize("message", ["", "   ", "x" * 4001])
def test_invalid_message_is_a_400_with_error_shape(client: TestClient, message: str) -> None:
    response = client.post("/api/chat", json={"message": message})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bad_request"


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (_status_error(openai.AuthenticationError, 401), 401, "auth_failed"),
        (_status_error(openai.PermissionDeniedError, 403), 403, "auth_failed"),
        (_status_error(openai.NotFoundError, 404), 404, "deployment_not_found"),
        (_status_error(openai.RateLimitError, 429), 429, "rate_limited"),
        (_status_error(openai.InternalServerError, 500), 502, "upstream_error"),
        (ClientAuthenticationError("no az login"), 401, "auth_failed"),
    ],
)
def test_upstream_errors_are_mapped(
    client: TestClient,
    fake_client: FakeClient,
    error: Exception,
    status: int,
    code: str,
) -> None:
    fake_client.completions.error = error

    response = client.post("/api/chat", json={"message": "hi"})

    assert response.status_code == status
    body = response.json()
    assert body["error"]["code"] == code
    assert body["error"]["message"]
