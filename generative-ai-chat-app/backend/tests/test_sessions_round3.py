from fastapi.testclient import TestClient

from app.services.session_store import SessionStore
from tests.conftest import FakeClient


def _chat(client: TestClient, session_id: str, message: str = "hi") -> None:
    client.post("/api/chat", json={"message": message, "session_id": session_id})


def test_create_session_returns_an_id(client: TestClient) -> None:
    response = client.post("/api/sessions")

    assert response.status_code == 201
    assert response.json()["session_id"].startswith("s_")


def test_each_session_gets_a_different_id(client: TestClient) -> None:
    ids = {client.post("/api/sessions").json()["session_id"] for _ in range(5)}

    assert len(ids) == 5


def test_delete_resets_memory(client: TestClient, session_id: str) -> None:
    _chat(client, session_id)

    assert client.delete(f"/api/sessions/{session_id}").status_code == 204

    after = client.post("/api/chat", json={"message": "hi", "session_id": session_id})
    assert after.status_code == 404
    assert after.json()["error"]["code"] == "session_not_found"


def test_deleting_an_unknown_session_is_not_an_error(client: TestClient) -> None:
    assert client.delete("/api/sessions/s_nope").status_code == 204


def test_memory_of_an_empty_session(client: TestClient, session_id: str) -> None:
    body = client.get(f"/api/sessions/{session_id}/memory").json()

    assert body["mode"] == "previous_response_id"
    assert body["last_response_id"] is None
    assert body["response_chain"] == []
    assert body["transcript"] == []
    assert body["server_items"] is None
    assert body["server_items_note"]


def test_memory_shows_chain_transcript_and_server_items(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    _chat(client, session_id, "first")
    _chat(client, session_id, "second")

    body = client.get(f"/api/sessions/{session_id}/memory").json()

    assert body["last_response_id"] == "resp_2"
    assert body["response_chain"] == ["resp_1", "resp_2"]
    assert [m["role"] for m in body["transcript"]] == ["user", "assistant", "user", "assistant"]
    assert body["server_items"] == [{"type": "message", "role": "user"}]
    assert body["server_items_note"] is None
    assert fake_client.responses.input_items.requested == ["resp_2"]


def test_memory_tolerates_unsupported_server_items(
    client: TestClient, fake_client: FakeClient, session_id: str
) -> None:
    _chat(client, session_id)
    fake_client.responses.input_items.error = RuntimeError("not supported")

    response = client.get(f"/api/sessions/{session_id}/memory")

    assert response.status_code == 200
    body = response.json()
    assert body["server_items"] is None
    assert body["server_items_note"]
    assert body["response_chain"] == ["resp_1"]


def test_memory_of_unknown_session_is_a_404(client: TestClient) -> None:
    response = client.get("/api/sessions/s_nope/memory")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "session_not_found"


def test_store_drops_the_oldest_session_past_the_cap() -> None:
    store = SessionStore(max_sessions=2)
    first = store.create()
    second = store.create()
    third = store.create()

    assert store.get(second.session_id) is second
    assert store.get(third.session_id) is third
    try:
        store.get(first.session_id)
    except Exception as exc:  # noqa: BLE001
        assert getattr(exc, "code", None) == "session_not_found"
    else:
        raise AssertionError("oldest session should have been evicted")


def test_store_keeps_recently_used_sessions() -> None:
    store = SessionStore(max_sessions=2)
    first = store.create()
    second = store.create()
    store.get(first.session_id)  # touch: now `second` is the oldest
    third = store.create()

    assert store.get(first.session_id) is first
    assert store.get(third.session_id) is third
    assert second.session_id not in store._sessions
