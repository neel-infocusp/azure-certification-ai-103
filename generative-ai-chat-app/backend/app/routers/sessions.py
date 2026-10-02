from fastapi import APIRouter, Depends, Response, status

from app.schemas import MemoryResponse, SessionCreated, TranscriptMessage
from app.services.llm_service import LlmService, get_llm_service
from app.services.session_store import SessionStore, get_session_store

router = APIRouter(prefix="/api/sessions")


@router.post("", response_model=SessionCreated, status_code=status.HTTP_201_CREATED)
def create_session(store: SessionStore = Depends(get_session_store)) -> SessionCreated:
    """Start a new conversation with empty memory."""
    return SessionCreated(session_id=store.create().session_id)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: str, store: SessionStore = Depends(get_session_store)
) -> Response:
    """Forget a conversation (New chat). Deleting an unknown session is not an error."""
    store.delete(session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{session_id}/memory", response_model=MemoryResponse)
def get_memory(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
    llm: LlmService = Depends(get_llm_service),
) -> MemoryResponse:
    """What this conversation remembers: our transcript, the response chain, server items."""
    session = store.get(session_id)
    last_id = session.last_response_id

    items: list[dict] | None = None
    note: str | None = None
    if last_id:
        items, note = llm.list_input_items(last_id)
    else:
        note = "No response yet, so there is nothing stored on the server."

    return MemoryResponse(
        last_response_id=last_id,
        response_chain=session.response_chain,
        transcript=[TranscriptMessage(**m) for m in session.transcript],
        server_items=items,
        server_items_note=note,
    )
