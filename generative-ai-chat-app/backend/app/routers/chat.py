from fastapi import APIRouter, Depends

from app.schemas import ChatRequest, ChatResponse, MemoryView, TranscriptMessage
from app.services.llm_service import LlmService, get_llm_service
from app.services.session_store import ChatSession, SessionStore, get_session_store

router = APIRouter(prefix="/api")


def memory_view(session: ChatSession) -> MemoryView:
    return MemoryView(
        mode="previous_response_id",
        response_chain=session.response_chain,
        transcript=[TranscriptMessage(**m) for m in session.transcript],
    )


@router.post("/chat", response_model=ChatResponse)
def chat(
    request: ChatRequest,
    llm: LlmService = Depends(get_llm_service),
    store: SessionStore = Depends(get_session_store),
) -> ChatResponse:
    """One message in, one reply out. The session's last response ID gives the model memory."""
    session = store.get(request.session_id)
    result = llm.chat(request.message, previous_response_id=session.last_response_id)

    # Only a successful answer is stored, so our copy never drifts from the server's memory.
    session = store.add_turn(
        request.session_id, request.message, result.reply, result.inspector.response.id or ""
    )
    result.inspector.memory = memory_view(session)
    return result
