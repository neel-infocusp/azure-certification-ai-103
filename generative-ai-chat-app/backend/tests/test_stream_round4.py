import json
from types import SimpleNamespace
from typing import Any

import httpx
import openai
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.services.llm_service import LlmService
from app.services.sse import format_sse
from tests.conftest import FakeClient, delta_event, make_response


def parse_sse(body: str) -> list[tuple[str, Any]]:
    """Turn an SSE body into [(event, data), ...]."""
    frames = []
    for block in body.strip().split("\n\n"):
        lines = block.split("\n")
        assert lines[0].startswith("event: ") and lines[1].startswith("data: "), block
        frames.append((lines[0][len("event: "):], json.loads(lines[1][len("data: "):])))
    return frames


def stream(client: TestClient, session_id: str, message: str = "hi") -> list[tuple[str, Any]]:
    response = client.post("/api/chat/stream", json={"message": message, "session_id": session_id})
    assert response.status_code == 200
    return parse_sse(response.text)


def names(frames: list[tuple[str, Any]]) -> list[str]:
    return [name for name, _ in frames]


def _status_error(cls: type[openai.APIStatusError], status: int) -> openai.APIStatusError:
    request = httpx.Request("POST", "https://example.test/responses")
    return cls("upstream said no", response=httpx.Response(status, request=request), body=None)


def test_format_sse_is_a_single_data_line() -> None:
    frame = format_sse("delta", {"text": "line one\nline two"})

    assert frame == 'event: delta\ndata: {"text": "line one\\nline two"}\n\n'


def test_stream_has_the_right_headers(client: TestClient, session_id: str) -> None:
    response = client.post("/api/chat/stream", json={"message": "hi", "session_id": session_id})

    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache"


def test_events_come_in_order_meta_deltas_completed(client: TestClient, session_id: str) -> None:
    frames = stream(client, session_id, "Tell me about the ELIZA chatbot.")

    assert names(frames)[0] == "meta"
    assert names(frames)[-1] == "completed"
    assert names(frames).count("delta") == 2
    # the deltas appear in order between meta and completed
    first_delta = names(frames).index("delta")
    assert 0 < first_delta < len(frames) - 1

    meta = frames[0][1]
    assert meta["turn_id"].startswith("t_")
    assert meta["request"] == {
        "model": "gpt-test",
        "instructions": "Test system prompt.",
        "input": "Tell me about the ELIZA chatbot.",
        "previous_response_id": None,
        "stream": True,
    }


def test_deltas_add_up_to_the_final_reply(client: TestClient, session_id: str) -> None:
    frames = stream(client, session_id)

    text = "".join(data["text"] for name, data in frames if name == "delta")
    completed = frames[-1][1]
    assert text == "Hello from the fake model."
    assert completed["reply"] == text


def test_completed_carries_usage_metrics_and_memory(client: TestClient, session_id: str) -> None:
    inspector = stream(client, session_id, "hello")[-1][1]["inspector"]

    assert inspector["api"] == "responses"
    assert inspector["request"]["stream"] is True
    assert inspector["response"] == {"id": "resp_1", "status": "completed"}
    assert inspector["usage"]["input_tokens"] == 38
    assert inspector["usage"]["output_tokens"] == 410
    assert inspector["metrics"]["latency_ms"] >= 0
    assert inspector["metrics"]["ttft_ms"] >= 0
    assert inspector["metrics"]["chunk_count"] == 2
    assert inspector["memory"]["mode"] == "previous_response_id"
    assert inspector["memory"]["response_chain"] == ["resp_1"]
    assert inspector["memory"]["transcript"] == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "Hello from the fake model."},
    ]


def test_ttft_is_missing_when_nothing_was_streamed(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    fake_client.responses.stream_script = ["FINAL"]

    inspector = stream(client, session_id)[-1][1]["inspector"]

    assert inspector["metrics"]["ttft_ms"] is None
    assert inspector["metrics"]["chunk_count"] == 0


def test_every_upstream_event_is_forwarded_as_raw(client: TestClient, session_id: str) -> None:
    frames = stream(client, session_id)

    raw = [data for name, data in frames if name == "raw"]
    assert [r["type"] for r in raw] == [
        "response.created",
        "response.output_text.delta",
        "response.output_text.delta",
        "response.completed",
    ]
    assert [r["seq"] for r in raw] == [1, 2, 3, 4]
    assert raw[1]["summary"] == "Hello from th"
    assert raw[3]["summary"] == "resp_1 completed"


def test_stream_keeps_memory_across_turns(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    stream(client, session_id, "Tell me about the ELIZA chatbot.")
    second = stream(client, session_id, "How does it compare to modern LLMs?")

    assert fake_client.responses.calls[0].get("previous_response_id") is None
    assert fake_client.responses.calls[1]["previous_response_id"] == "resp_1"
    assert fake_client.responses.calls[1]["stream"] is True
    assert second[-1][1]["inspector"]["memory"]["response_chain"] == ["resp_1", "resp_2"]


def test_stream_and_plain_chat_share_the_same_conversation(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    stream(client, session_id, "first, streamed")
    client.post("/api/chat", json={"message": "second, plain", "session_id": session_id})

    assert fake_client.responses.calls[1]["previous_response_id"] == "resp_1"


def test_unknown_session_is_a_plain_404_before_streaming(
    client: TestClient, fake_client: FakeClient
) -> None:
    response = client.post("/api/chat/stream", json={"message": "hi", "session_id": "s_nope"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "session_not_found"
    assert fake_client.responses.calls == []


def test_invalid_message_is_a_400(client: TestClient, session_id: str) -> None:
    response = client.post("/api/chat/stream", json={"message": "  ", "session_id": session_id})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bad_request"


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (_status_error(openai.AuthenticationError, 401), "auth_failed"),
        (_status_error(openai.NotFoundError, 404), "deployment_not_found"),
        (_status_error(openai.RateLimitError, 429), "rate_limited"),
    ],
)
def test_failure_to_start_the_stream_is_an_error_event(
    client: TestClient, fake_client: FakeClient, session_id: str, error: Exception, code: str
) -> None:
    fake_client.responses.error = error

    frames = stream(client, session_id)

    assert names(frames) == ["meta", "error"]
    assert frames[-1][1]["code"] == code
    assert frames[-1][1]["message"]


def test_failure_mid_stream_gives_an_error_and_is_not_remembered(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    fake_client.responses.stream_script = [
        delta_event("partial "),
        _status_error(openai.InternalServerError, 500),
    ]

    frames = stream(client, session_id, "will break")

    assert names(frames)[-1] == "error"
    assert "completed" not in names(frames)
    assert any(name == "delta" for name in names(frames))

    memory = client.get(f"/api/sessions/{session_id}/memory").json()
    assert memory["response_chain"] == []
    assert memory["transcript"] == []


def test_failed_event_becomes_an_error_with_the_reason(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    failed = SimpleNamespace(
        type="response.failed",
        response=SimpleNamespace(error=SimpleNamespace(message="content filter triggered")),
    )
    fake_client.responses.stream_script = [delta_event("x"), failed]

    frames = stream(client, session_id)

    assert names(frames)[-1] == "error"
    assert "content filter triggered" in frames[-1][1]["message"]
    assert client.get(f"/api/sessions/{session_id}/memory").json()["response_chain"] == []


def test_stream_that_ends_without_completion_is_an_error(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    fake_client.responses.stream_script = [delta_event("cut "), delta_event("off")]

    frames = stream(client, session_id)

    assert names(frames)[-1] == "error"
    assert "ended before" in frames[-1][1]["message"]
    assert client.get(f"/api/sessions/{session_id}/memory").json()["response_chain"] == []


def test_incomplete_response_is_still_remembered(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    final = make_response(text="cut short", status="incomplete")
    final.id = "resp_inc"
    fake_client.responses.stream_script = [
        delta_event("cut short"),
        SimpleNamespace(type="response.incomplete", response=final),
    ]

    inspector = stream(client, session_id)[-1][1]["inspector"]

    assert inspector["response"] == {"id": "resp_inc", "status": "incomplete"}
    assert inspector["memory"]["response_chain"] == ["resp_inc"]


def test_session_deleted_while_streaming_is_reported_in_band(
    client: TestClient, fake_client: FakeClient, store, session_id: str
) -> None:
    # The session disappears (New chat) before the answer finishes.
    original_create = fake_client.responses.create

    def create_then_delete(**kwargs: Any) -> Any:
        result = original_create(**kwargs)
        store.delete(session_id)
        return result

    fake_client.responses.create = create_then_delete  # type: ignore[method-assign]

    frames = stream(client, session_id)

    assert names(frames)[-1] == "error"
    assert frames[-1][1]["code"] == "session_not_found"


def test_stopping_early_closes_the_upstream_stream(
    fake_client: FakeClient, settings: Settings
) -> None:
    service = LlmService(fake_client, settings)  # type: ignore[arg-type]
    events = service.stream_chat("hi")

    assert next(events).event == "meta"
    assert next(events).event == "raw"
    events.close()  # what happens when the client disconnects

    assert fake_client.responses.streams[0].closed is True


def test_stream_is_closed_after_normal_completion(
    fake_client: FakeClient, settings: Settings
) -> None:
    service = LlmService(fake_client, settings)  # type: ignore[arg-type]

    list(service.stream_chat("hi"))

    assert fake_client.responses.streams[0].closed is True
