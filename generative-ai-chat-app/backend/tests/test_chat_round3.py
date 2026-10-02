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


def _chat(client: TestClient, session_id: str, message: str = "hi"):
    return client.post("/api/chat", json={"message": message, "session_id": session_id})


def test_chat_returns_reply_and_inspector(client: TestClient, session_id: str) -> None:
    response = _chat(client, session_id, "Tell me about the ELIZA chatbot.")

    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Hello from the fake model."

    inspector = body["inspector"]
    assert inspector["api"] == "responses"
    assert inspector["request"] == {
        "model": "gpt-test",
        "instructions": "Test system prompt.",
        "input": "Tell me about the ELIZA chatbot.",
        "previous_response_id": None,
        "stream": False,
    }
    assert inspector["response"] == {"id": "resp_1", "status": "completed"}
    assert inspector["usage"] == {
        "input_tokens": 38,
        "output_tokens": 410,
        "total_tokens": 448,
        "reasoning_tokens": 64,
        "cached_tokens": 0,
    }
    assert inspector["metrics"]["latency_ms"] >= 0
    assert inspector["memory"] == {
        "mode": "previous_response_id",
        "response_chain": ["resp_1"],
        "transcript": [
            {"role": "user", "content": "Tell me about the ELIZA chatbot."},
            {"role": "assistant", "content": "Hello from the fake model."},
        ],
    }
    assert inspector["raw"]["id"] == "resp_1"


def test_first_message_sends_no_previous_response_id(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    _chat(client, session_id, "hello there")

    assert fake_client.responses.calls == [
        {"model": "gpt-test", "instructions": "Test system prompt.", "input": "hello there"}
    ]


def test_follow_up_sends_the_previous_response_id(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    _chat(client, session_id, "Tell me about the ELIZA chatbot.")
    second = _chat(client, session_id, "How does it compare to modern LLMs?")

    assert fake_client.responses.calls[1]["previous_response_id"] == "resp_1"
    inspector = second.json()["inspector"]
    assert inspector["request"]["previous_response_id"] == "resp_1"
    assert inspector["memory"]["response_chain"] == ["resp_1", "resp_2"]
    assert [m["content"] for m in inspector["memory"]["transcript"]] == [
        "Tell me about the ELIZA chatbot.",
        "Hello from the fake model.",
        "How does it compare to modern LLMs?",
        "Hello from the fake model.",
    ]


def test_third_message_points_at_the_latest_response(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    for text in ("one", "two", "three"):
        _chat(client, session_id, text)

    assert [c.get("previous_response_id") for c in fake_client.responses.calls] == [
        None,
        "resp_1",
        "resp_2",
    ]


def test_sessions_do_not_share_memory(client: TestClient, fake_client: FakeClient) -> None:
    first = client.post("/api/sessions").json()["session_id"]
    second = client.post("/api/sessions").json()["session_id"]

    _chat(client, first, "in session one")
    _chat(client, second, "in session two")

    assert "previous_response_id" not in fake_client.responses.calls[1]


def test_unknown_session_is_a_404(client: TestClient, fake_client: FakeClient) -> None:
    response = _chat(client, "s_does_not_exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "session_not_found"
    assert fake_client.responses.calls == []


def test_failed_turn_is_not_remembered(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    fake_client.responses.error = _status_error(openai.RateLimitError, 429)
    assert _chat(client, session_id, "will fail").status_code == 429

    fake_client.responses.error = None
    ok = _chat(client, session_id, "will work").json()["inspector"]

    assert "previous_response_id" not in fake_client.responses.calls[-1]
    assert ok["memory"]["response_chain"] == ["resp_2"]
    assert [m["content"] for m in ok["memory"]["transcript"]] == [
        "will work",
        "Hello from the fake model.",
    ]


def test_missing_usage_details_become_null(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    fake_client.responses.result = make_response(usage=None)

    body = _chat(client, session_id).json()

    assert body["inspector"]["usage"] == {
        "input_tokens": None,
        "output_tokens": None,
        "total_tokens": None,
        "reasoning_tokens": None,
        "cached_tokens": None,
    }


def test_empty_output_text_gives_empty_reply(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    fake_client.responses.result = make_response(text="", status="incomplete")

    body = _chat(client, session_id).json()

    assert body["reply"] == ""
    assert body["inspector"]["response"]["status"] == "incomplete"


def test_failed_response_becomes_upstream_error(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    class _Error:
        message = "content filter triggered"

    fake_client.responses.result = make_response(status="failed", error=_Error())

    response = _chat(client, session_id)

    assert response.status_code == 502
    body = response.json()["error"]
    assert body["code"] == "upstream_error"
    assert "content filter triggered" in body["message"]


@pytest.mark.parametrize("message", ["", "   ", "x" * 4001])
def test_invalid_message_is_a_400_with_error_shape(
    client: TestClient, session_id: str, message: str
) -> None:
    response = _chat(client, session_id, message)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bad_request"


def test_missing_session_id_is_a_400(client: TestClient) -> None:
    response = client.post("/api/chat", json={"message": "hi"})

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
    session_id: str,
    error: Exception,
    status: int,
    code: str,
) -> None:
    fake_client.responses.error = error

    response = _chat(client, session_id)

    assert response.status_code == status
    body = response.json()
    assert body["error"]["code"] == code
    assert body["error"]["message"]
