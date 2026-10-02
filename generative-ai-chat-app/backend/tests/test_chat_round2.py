import httpx
import openai
import pytest
from azure.core.exceptions import ClientAuthenticationError
from fastapi.testclient import TestClient

from tests.conftest import FakeClient, make_response


def _status_error(cls: type[openai.APIStatusError], status: int) -> openai.APIStatusError:
    request = httpx.Request("POST", "https://example.test/responses")
    response = httpx.Response(status, request=request)
    return cls("upstream said no", response=response, body=None)


def test_chat_returns_reply_and_inspector(client: TestClient, fake_client: FakeClient) -> None:
    response = client.post("/api/chat", json={"message": "Tell me about the ELIZA chatbot."})

    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Hello from the fake model."

    inspector = body["inspector"]
    assert inspector["api"] == "responses"
    assert inspector["request"] == {
        "model": "gpt-test",
        "instructions": "Test system prompt.",
        "input": "Tell me about the ELIZA chatbot.",
        "stream": False,
    }
    assert "messages" not in inspector["request"]
    assert inspector["response"] == {"id": "resp_test", "status": "completed"}
    assert inspector["usage"] == {
        "input_tokens": 38,
        "output_tokens": 410,
        "total_tokens": 448,
        "reasoning_tokens": 64,
        "cached_tokens": 0,
    }
    assert inspector["metrics"]["latency_ms"] >= 0
    assert inspector["memory"] == {"mode": "none"}
    assert inspector["raw"]["id"] == "resp_test"


def test_responses_api_is_called_with_instructions_and_input(
    client: TestClient, fake_client: FakeClient
) -> None:
    client.post("/api/chat", json={"message": "hello there"})

    assert fake_client.responses.calls == [
        {"model": "gpt-test", "instructions": "Test system prompt.", "input": "hello there"}
    ]


def test_each_call_is_stateless(client: TestClient, fake_client: FakeClient) -> None:
    client.post("/api/chat", json={"message": "first"})
    client.post("/api/chat", json={"message": "second"})

    second_call = fake_client.responses.calls[1]
    assert second_call["input"] == "second"
    assert "previous_response_id" not in second_call


def test_missing_usage_details_become_null(client: TestClient, fake_client: FakeClient) -> None:
    fake_client.responses.result = make_response(usage=None)

    body = client.post("/api/chat", json={"message": "hi"}).json()

    assert body["inspector"]["usage"] == {
        "input_tokens": None,
        "output_tokens": None,
        "total_tokens": None,
        "reasoning_tokens": None,
        "cached_tokens": None,
    }


def test_empty_output_text_gives_empty_reply(client: TestClient, fake_client: FakeClient) -> None:
    fake_client.responses.result = make_response(text="", status="incomplete")

    body = client.post("/api/chat", json={"message": "hi"}).json()

    assert body["reply"] == ""
    assert body["inspector"]["response"]["status"] == "incomplete"


def test_failed_response_becomes_upstream_error(
    client: TestClient, fake_client: FakeClient
) -> None:
    class _Error:
        message = "content filter triggered"

    fake_client.responses.result = make_response(status="failed", error=_Error())

    response = client.post("/api/chat", json={"message": "hi"})

    assert response.status_code == 502
    body = response.json()["error"]
    assert body["code"] == "upstream_error"
    assert "content filter triggered" in body["message"]


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
    fake_client.responses.error = error

    response = client.post("/api/chat", json={"message": "hi"})

    assert response.status_code == status
    body = response.json()
    assert body["error"]["code"] == code
    assert body["error"]["message"]
